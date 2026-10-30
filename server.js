const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');


function cleanPhone(p) {
  if (!p) return '';
  let digits = String(p).replace(/\D/g, '');
  if (digits.startsWith('20')) digits = digits.substring(2);
  if (digits.startsWith('0')) digits = digits.substring(1);
  return digits;
}

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

// Database Layer (Supabase PostgreSQL with fallback to local db.json)
const dbLayer = require('./db_supabase');
const getDB = dbLayer.getDB;
const saveDB = dbLayer.saveDB;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check endpoint to verify live connection & database host
app.get('/api/health', async (req, res) => {
  let dbOk = false;
  let errorMsg = null;
  let candidateCount = 0;
  try {
    const p = dbLayer.getPool();
    if (p) {
      const q = await p.query('SELECT COUNT(*) FROM mofa_candidates');
      dbOk = true;
      candidateCount = parseInt(q.rows[0].count, 10);
      dbLayer.setConnected(true);
    }
  } catch (err) {
    errorMsg = err.message;
    dbLayer.setConnected(false);
  }

  res.json({
    status: dbOk ? 'ok' : 'degraded',
    connected: dbOk,
    candidatesCount: candidateCount,
    error: errorMsg,
    database: 'aws-1-eu-central-1 (New Clean Supabase)',
    hasCustomEnvUrl: !!process.env.DATABASE_URL,
    timestamp: new Date().toISOString()
  });
});

// Synchronize with Supabase Cloud for serverless environments (Vercel)
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/') && req.path !== '/api/health') {
    await dbLayer.syncFromSupabase();
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Arabic Day Names mapping

// Arabic string normalization helper
function normalizeArabic(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\s\-_]+/g, ' ')
    .trim()
    .toLowerCase();
}

const dayNamesAr = {
  0: 'الأحد',
  1: 'الإثنين',
  2: 'الثلاثاء',
  3: 'الأربعاء',
  4: 'الخميس',
  5: 'الجمعة',
  6: 'السبت'
};

const monthNamesAr = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

function formatDateDisplay(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const dayName = dayNamesAr[d.getDay()];
    const day = d.getDate();
    const month = monthNamesAr[d.getMonth()];
    const year = d.getFullYear();
    return `${dayName} ${day} ${month} ${year}`;
  } catch (e) {
    return dateStr;
  }
}

function formatTime12(time24) {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'م' : 'ص';
  const hour12 = h % 12 || 12;
  const minute = String(m).padStart(2, '0');
  return `${hour12}:${minute} ${period}`;
}

// ==========================================
// 1. AUTHENTICATION APIS
// ==========================================

app.post('/api/auth/login', (req, res) => {
  const { username, password, committeeId, role } = req.body;
  const db = getDB();

  const cleanUser = String(username || '').trim().toLowerCase();
  const cleanPass = String(password || '').trim();

  if (!cleanPass) {
    return res.status(400).json({ success: false, message: 'يرجى إدخال كلمة المرور' });
  }

  let user = null;

  // 1. Find by explicit username if provided
  if (cleanUser) {
    user = (db.users || []).find(u => 
      u.username.toLowerCase() === cleanUser || 
      (u.committeeSlug && u.committeeSlug.toLowerCase() === cleanUser) ||
      (u.committeeId && u.committeeId.toLowerCase() === cleanUser)
    );
  } 
  // 2. Or by committeeId
  else if (committeeId) {
    user = (db.users || []).find(u => u.committeeId === committeeId);
  } 
  // 3. Or by role admin
  else if (role === 'admin') {
    user = (db.users || []).find(u => u.role === 'admin');
  }

  if (!user) {
    return res.status(401).json({ success: false, message: 'اسم المستخدم غير صحيح أو غير مسجل' });
  }

  // Strict Password Verification
  if (user.password !== cleanPass) {
    return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة، يرجى إعادة المحاولة' });
  }

  // Find committee info if committee head
  let committee = null;
  if (user.committeeId) {
    committee = (db.committees || []).find(c => c.id === user.committeeId);
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      committeeId: user.committeeId,
      committeeName: user.committeeName,
      committeeSlug: user.committeeSlug,
      committee: committee
    }
  });
});

// ==========================================
// 2. COMMITTEES APIS
// ==========================================

app.get('/api/committees', (req, res) => {
  const db = getDB();
  
  // Calculate live stats for each committee
  const committeesWithStats = db.committees.map(comm => {
    const candidates = db.candidates.filter(c => c.assignedCommitteeId === comm.id);
    const total = candidates.length;
    const booked = candidates.filter(c => c.bookingStatus === 'booked' || c.bookingStatus === 'completed').length;
    const completed = candidates.filter(c => c.interviewStatus === 'completed' || (c.evaluation && c.evaluation.score !== null)).length;
    const absent = candidates.filter(c => c.bookingStatus === 'absent' || (c.evaluation && c.evaluation.attendanceStatus === 'absent')).length;
    const pendingBooking = candidates.filter(c => c.bookingStatus === 'pending' || !c.slotId).length;
    
    // Average rating
    const rated = candidates.filter(c => c.evaluation && typeof c.evaluation.score === 'number');
    const avgScore = rated.length > 0 ? (rated.reduce((sum, c) => sum + c.evaluation.score, 0) / rated.length).toFixed(1) : null;

    // Available slots
    const availableSlots = db.slots.filter(s => s.committeeId === comm.id && s.status === 'available').length;
    const totalSlots = db.slots.filter(s => s.committeeId === comm.id).length;

    return {
      ...comm,
      stats: {
        total,
        booked,
        completed,
        absent,
        pendingBooking,
        avgScore,
        ratedCount: rated.length,
        availableSlots,
        totalSlots
      }
    };
  });

  res.json({ success: true, committees: committeesWithStats });
});

app.get('/api/committees/:slug', (req, res) => {
  const db = getDB();
  const comm = db.committees.find(c => c.slug === req.params.slug || c.id === req.params.slug);
  if (!comm) {
    return res.status(404).json({ success: false, message: 'اللجنة غير موجودة' });
  }

  // Calculate stats
  const candidates = db.candidates.filter(c => c.assignedCommitteeId === comm.id);
  const total = candidates.length;
  const booked = candidates.filter(c => c.bookingStatus === 'booked' || c.bookingStatus === 'completed').length;
  const completed = candidates.filter(c => c.interviewStatus === 'completed' || (c.evaluation && c.evaluation.score !== null)).length;
  const absent = candidates.filter(c => c.bookingStatus === 'absent' || (c.evaluation && c.evaluation.attendanceStatus === 'absent')).length;
  const pendingBooking = candidates.filter(c => c.bookingStatus === 'pending' || !c.slotId).length;

  const rated = candidates.filter(c => c.evaluation && typeof c.evaluation.score === 'number');
  const avgScore = rated.length > 0 ? (rated.reduce((sum, c) => sum + c.evaluation.score, 0) / rated.length).toFixed(1) : null;

  const availableSlots = db.slots.filter(s => s.committeeId === comm.id && s.status === 'available').length;
  const totalSlots = db.slots.filter(s => s.committeeId === comm.id).length;
  const secondary = db.secondaryPreferences ? (db.secondaryPreferences[comm.id] || []) : [];

  res.json({
    success: true,
    committee: {
      ...comm,
      stats: {
        total,
        booked,
        completed,
        absent,
        pendingBooking,
        avgScore,
        ratedCount: rated.length,
        availableSlots,
        totalSlots
      }
    },
    secondaryCandidates: secondary
  });
});

// ==========================================
// 3. CANDIDATES APIS
// ==========================================

// Add candidate manually
app.post('/api/candidates', async (req, res) => {
  const db = getDB();
  const {
    arabicName,
    fullName,
    phone,
    email,
    university,
    faculty,
    grade,
    committeeId,
    trackPreference,
    englishLevel,
    notes
  } = req.body;

  if (!arabicName || !phone || !committeeId) {
    return res.status(400).json({ success: false, message: 'يرجى إدخال اسم المرشح ورقم الهاتف وتحديد القطاع/اللجنة' });
  }

  const comm = db.committees.find(c => c.id === committeeId);
  if (!comm) {
    return res.status(400).json({ success: false, message: 'اللجنة المحددة غير صالحة' });
  }

  const newNum = db.candidates.length + 1;
  const newCandidate = {
    id: `c_${newNum}_${Date.now().toString(36)}`,
    num: newNum,
    arabicName: arabicName.trim(),
    fullName: (fullName || '').trim(),
    university: university || 'جامعة السويس',
    priority: 1,
    faculty: (faculty || '').trim(),
    grade: grade || 'الفرقة الأولى',
    phone: phone.trim(),
    email: (email || '').trim(),
    firstPreference: comm.name,
    originalCommitteeId: comm.id,
    assignedCommitteeId: comm.id,
    allPreferences: comm.name,
    trackPreference: trackPreference || 'الأكاديمي',
    englishLevel: englishLevel || 'متوسط',
    pastActivities: '',
    activitiesDetails: '',
    reasonsForSectors: '',
    motivation: notes || 'تمت الإضافة يدوياً من لوحة التحكم',
    skills: '',
    topSkill: '',
    attendanceCommitment: 'نعم',
    referralSource: 'إضافة يدوية مباشرة',
    submissionTime: new Date().toISOString(),
    bookingStatus: 'pending',
    slotId: null,
    slotInfo: null,
    interviewStatus: 'pending',
    evaluation: {
      attended: false,
      attendanceStatus: 'pending',
      score: null,
      communicationScore: null,
      knowledgeScore: null,
      commitmentScore: null,
      englishScore: null,
      notes: notes || '',
      decision: 'pending',
      interviewerName: '',
      evaluatedAt: null
    },
    transferHistory: []
  };

  db.candidates.push(newCandidate);
  await saveDB(db);

  res.json({
    success: true,
    message: `تمت إضافة المرشح ${newCandidate.arabicName} إلى لجنة ${comm.name} بنجاح!`,
    candidate: newCandidate
  });
});

app.get('/api/candidates', (req, res) => {
  const db = getDB();
  const { committeeId, search, status, university, priority, track } = req.query;

  let list = db.candidates;

  // Filter by committee
  if (committeeId && committeeId !== 'all') {
    list = list.filter(c => c.assignedCommitteeId === committeeId);
  }

  // Search filter
  if (search) {
    const q = search.trim().toLowerCase();
    list = list.filter(c => 
      c.arabicName.toLowerCase().includes(q) ||
      c.fullName.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.faculty.toLowerCase().includes(q) ||
      c.university.toLowerCase().includes(q)
    );
  }

  // Status filter
  if (status && status !== 'all') {
    if (status === 'pending') {
      list = list.filter(c => c.bookingStatus === 'pending' || !c.slotId);
    } else if (status === 'booked') {
      list = list.filter(c => c.bookingStatus === 'booked');
    } else if (status === 'completed') {
      list = list.filter(c => c.interviewStatus === 'completed' || (c.evaluation && c.evaluation.score !== null));
    } else if (status === 'absent') {
      list = list.filter(c => c.bookingStatus === 'absent' || (c.evaluation && c.evaluation.attendanceStatus === 'absent'));
    }
  }

  // University filter
  if (university && university !== 'all') {
    list = list.filter(c => c.university.includes(university));
  }

  // Priority filter
  if (priority && priority !== 'all') {
    list = list.filter(c => String(c.priority) === String(priority));
  }

  // Track filter
  if (track && track !== 'all') {
    list = list.filter(c => c.trackPreference.includes(track));
  }

  res.json({ success: true, count: list.length, candidates: list });
});

app.get('/api/candidates/:id', (req, res) => {
  const db = getDB();
  const cand = db.candidates.find(c => c.id === req.params.id);
  if (!cand) {
    return res.status(404).json({ success: false, message: 'المرشح غير موجود' });
  }

  // Attach slot details if booked
  let slot = null;
  if (cand.slotId) {
    slot = db.slots.find(s => s.id === cand.slotId);
  }

  res.json({ success: true, candidate: { ...cand, slot } });
});

// Update candidate interview evaluation & notes
app.put('/api/candidates/:id/evaluation', async (req, res) => {
  const db = getDB();
  const cand = db.candidates.find(c => c.id === req.params.id);
  if (!cand) {
    return res.status(404).json({ success: false, message: 'المرشح غير موجود' });
  }

  const {
    attendanceStatus, // 'attended' | 'absent' | 'excused'
    score, // 1 to 10
    communicationScore,
    knowledgeScore,
    commitmentScore,
    englishScore,
    notes,
    decision, // 'accepted' | 'reserve' | 'rejected' | 'transferred' | 'pending'
    interviewerName,
    roleType, // 'delegate' | 'member'
    subDepartment // 'hr' | 'media' | 'academic'
  } = req.body;

  cand.evaluation = {
    attended: attendanceStatus === 'attended',
    attendanceStatus: attendanceStatus || 'attended',
    score: score !== undefined && score !== '' && score !== null ? parseFloat(score) : null,
    communicationScore: communicationScore ? parseFloat(communicationScore) : null,
    knowledgeScore: knowledgeScore ? parseFloat(knowledgeScore) : null,
    commitmentScore: commitmentScore ? parseFloat(commitmentScore) : null,
    englishScore: englishScore ? parseFloat(englishScore) : null,
    notes: notes || '',
    decision: decision || 'pending',
    interviewerName: interviewerName || 'مدير اللجنة',
    evaluatedAt: new Date().toISOString()
  };

  if (decision === 'accepted') {
    cand.roleType = roleType || cand.roleType || 'delegate';
    if (cand.roleType === 'member') {
      cand.subDepartment = subDepartment || cand.subDepartment || 'academic';
    } else {
      cand.subDepartment = null;
    }
    if (!cand.delegatePassword) {
      cand.delegatePassword = '1234';
    }
  } else if (decision === 'rejected') {
    cand.roleType = null;
    cand.subDepartment = null;
  }

  if (attendanceStatus === 'attended') {
    cand.interviewStatus = 'completed';
    cand.bookingStatus = 'completed';
  } else if (attendanceStatus === 'absent') {
    cand.interviewStatus = 'absent';
    cand.bookingStatus = 'absent';
  } else if (attendanceStatus === 'excused') {
    cand.interviewStatus = 'excused';
    cand.bookingStatus = 'pending'; // Allow rebooking
  }

  await saveDB(db);
  res.json({ success: true, message: 'تم حفظ التقييم بنجاح', candidate: cand });
});

// Update member/delegate role, sub-department, or continuous evaluation
// PUT /api/candidates/:id (Update Candidate / Delegate / Member Details by Sector Head)
app.put('/api/candidates/:id', async (req, res) => {
  const db = getDB();
  const cand = (db.candidates || []).find(c => c.id === req.params.id);
  if (!cand) return res.status(404).json({ success: false, message: 'المرشح أو العضو غير موجود' });

  const { email, phone, faculty, university } = req.body;

  // Name is strictly constant and protected (never overwritten)
  if (email && email.trim()) {
    cand.email = email.trim();
  }
  if (phone && phone.trim()) {
    cand.phone = phone.trim();
  }
  if (faculty !== undefined) {
    cand.faculty = faculty;
  }
  if (university !== undefined) {
    cand.university = university;
  }

  // Update corresponding quizSubmissions candidateEmail & candidatePhone
  if (db.quizSubmissions) {
    db.quizSubmissions.forEach(sub => {
      if (sub.candidateId === cand.id) {
        if (cand.email) sub.candidateEmail = cand.email;
        if (cand.phone) sub.candidatePhone = cand.phone;
      }
    });
  }

  await saveDB(db);
  res.json({ success: true, message: 'تم تحديث البريد الإلكتروني وبيانات الاتصال بنجاح مع ثبات الاسم والسجلات', candidate: cand });
});

app.put('/api/candidates/:id/role', async (req, res) => {
  const db = getDB();
  const cand = db.candidates.find(c => c.id === req.params.id);
  if (!cand) {
    return res.status(404).json({ success: false, message: 'المرشح غير موجود' });
  }

  const { roleType, subDepartment, memberScore, memberNotes } = req.body;
  if (roleType) {
    cand.roleType = roleType;
    if (roleType === 'delegate') {
      cand.subDepartment = null;
    } else if (roleType === 'member') {
      cand.subDepartment = subDepartment || cand.subDepartment || 'academic';
    }
  } else if (subDepartment !== undefined) {
    cand.subDepartment = subDepartment;
  }

  if (memberScore !== undefined || memberNotes !== undefined) {
    if (!cand.memberEvaluation) cand.memberEvaluation = {};
    if (memberScore !== undefined && memberScore !== '') {
      cand.memberEvaluation.score = parseFloat(memberScore);
    }
    if (memberNotes !== undefined) {
      cand.memberEvaluation.notes = memberNotes;
    }
    cand.memberEvaluation.updatedAt = new Date().toISOString();
  }

  await saveDB(db);
  res.json({ success: true, message: 'تم تحديث بيانات العضو بنجاح', candidate: cand });
});

// Transfer candidate to another committee
app.post('/api/candidates/:id/transfer', async (req, res) => {
  const db = getDB();
  const cand = db.candidates.find(c => c.id === req.params.id);
  if (!cand) {
    return res.status(404).json({ success: false, message: 'المرشح غير موجود' });
  }

  const { targetCommitteeId, reason, transferredBy } = req.body;
  if (!targetCommitteeId) {
    return res.status(400).json({ success: false, message: 'يرجى اختيار اللجنة المحول إليها' });
  }

  const oldComm = db.committees.find(c => c.id === cand.assignedCommitteeId);
  const newComm = db.committees.find(c => c.id === targetCommitteeId);

  if (!newComm) {
    return res.status(400).json({ success: false, message: 'اللجنة المحول إليها غير صالحة' });
  }

  // Free up previous slot only if it is in the future
  if (cand.slotId) {
    const slot = db.slots.find(s => s.id === cand.slotId);
    if (slot) {
      let isFuture = true;
      if (slot.date) {
        const timePart = slot.startTime24 || '00:00';
        const slotDate = new Date(`${slot.date}T${timePart}:00`);
        if (!isNaN(slotDate.getTime()) && slotDate < new Date()) {
          isFuture = false;
        }
      }
      if (isFuture) {
        slot.status = 'available';
        slot.candidateId = null;
        slot.candidateName = null;
        slot.candidatePhone = null;
      }
    }
  }

  const transferRecord = {
    id: `transfer_${Date.now()}`,
    candidateId: cand.id,
    candidateName: cand.arabicName,
    fromCommitteeId: cand.assignedCommitteeId,
    fromCommitteeName: oldComm ? oldComm.name : cand.assignedCommitteeId,
    toCommitteeId: targetCommitteeId,
    toCommitteeName: newComm.name,
    reason: reason || 'تحويل بناءً على تقييم المقابلة والتوافق الأكاديمي',
    transferredBy: transferredBy || 'مدير اللجنة',
    timestamp: new Date().toISOString()
  };

  cand.assignedCommitteeId = targetCommitteeId;
  cand.bookingStatus = 'pending';
  cand.slotId = null;
  cand.slotInfo = null;
  cand.transferHistory.push(transferRecord);
  
  // Also add note in evaluation
  if (!cand.evaluation.notes) {
    cand.evaluation.notes = '';
  }
  cand.evaluation.notes += ` [تم التحويل من ${oldComm ? oldComm.shortName : ''} إلى ${newComm.shortName}: ${reason || ''}]`;
  cand.evaluation.decision = 'transferred';

  // Audit log
  db.transferAuditLogs.push(transferRecord);

  await saveDB(db);
  res.json({
    success: true,
    message: `تم تحويل المرشح ${cand.arabicName} إلى ${newComm.name} بنجاح`,
    candidate: cand
  });
});

// Manual slot assignment or change by Committee Head
app.post('/api/candidates/:id/assign-slot', async (req, res) => {
  const db = getDB();
  const cand = db.candidates.find(c => c.id === req.params.id);
  if (!cand) {
    return res.status(404).json({ success: false, message: 'المرشح غير موجود' });
  }

  const { slotId } = req.body;
  if (!slotId) {
    return res.status(400).json({ success: false, message: 'يرجى تحديد الموعد' });
  }

  const targetSlot = db.slots.find(s => s.id === slotId);
  if (!targetSlot) {
    return res.status(404).json({ success: false, message: 'الموعد المحدد غير موجود' });
  }

  if (targetSlot.status === 'booked' && targetSlot.candidateId !== cand.id) {
    return res.status(400).json({ success: false, message: 'هذا الموعد محجوز لمرشح آخر' });
  }

  // If candidate already had another slot, free it
  if (cand.slotId && cand.slotId !== slotId) {
    const oldSlot = db.slots.find(s => s.id === cand.slotId);
    if (oldSlot) {
      oldSlot.status = 'available';
      oldSlot.candidateId = null;
      oldSlot.candidateName = null;
      oldSlot.candidatePhone = null;
    }
  }

  // Assign target slot
  targetSlot.status = 'booked';
  targetSlot.candidateId = cand.id;
  targetSlot.candidateName = cand.arabicName;
  targetSlot.candidatePhone = cand.phone;

  cand.slotId = targetSlot.id;
  cand.bookingStatus = 'booked';
  cand.slotInfo = {
    date: targetSlot.date,
    dateDisplay: targetSlot.dateDisplay,
    timeDisplay: targetSlot.timeDisplay,
    type: targetSlot.type,
    locationOrLink: targetSlot.locationOrLink
  };

  await saveDB(db);
  res.json({
    success: true,
    message: `تم تعيين موعد المقابلة بنجاح: ${targetSlot.dateDisplay} (${targetSlot.timeDisplay})`,
    candidate: cand,
    slot: targetSlot
  });
});

// Cancel a candidate's booking
app.delete('/api/candidates/:id/booking', async (req, res) => {
  const db = getDB();
  const cand = db.candidates.find(c => c.id === req.params.id);
  if (!cand) {
    return res.status(404).json({ success: false, message: 'المرشح غير موجود' });
  }

  if (cand.slotId) {
    const slot = db.slots.find(s => s.id === cand.slotId);
    if (slot) {
      if (slot.date) {
        const timePart = slot.startTime24 || '00:00';
        const slotDate = new Date(`${slot.date}T${timePart}:00`);
        if (!isNaN(slotDate.getTime()) && slotDate < new Date()) {
          return res.status(400).json({
            success: false,
            message: 'عذراً، لقد انقضى موعد هذه المقابلة بالفعل ولا يمكن تعديله أو إلغاؤه ذاتياً. يرجى مراجعة إدارة القطاع.'
          });
        }
      }
      slot.status = 'available';
      slot.candidateId = null;
      slot.candidateName = null;
      slot.candidatePhone = null;
    }
  }

  cand.slotId = null;
  cand.slotInfo = null;
  cand.bookingStatus = 'pending';
  cand.interviewStatus = 'pending';

  await saveDB(db);
  res.json({ success: true, message: 'تم إلغاء حجز الموعد بنجاح وأصبح الموعد متاحاً مجدداً' });
});

// ==========================================
// 4. INTERVIEW SLOTS & SCHEDULING APIS
// ==========================================

app.get('/api/slots', (req, res) => {
  const db = getDB();
  const { committeeId, date, type, status } = req.query;

  let list = db.slots;
  if (committeeId && committeeId !== 'all') {
    list = list.filter(s => s.committeeId === committeeId);
  }
  if (date) {
    list = list.filter(s => s.date === date);
  }
  if (type && type !== 'all') {
    list = list.filter(s => s.type === type);
  }
  if (status && status !== 'all') {
    list = list.filter(s => s.status === status);
  }

  res.json({ success: true, count: list.length, slots: list });
});

// Batch Slot Generation (The user's key requirement)
app.post('/api/slots/batch', async (req, res) => {
  const db = getDB();
  const {
    committeeId,
    date, // 'YYYY-MM-DD'
    startTime, // 'HH:MM' e.g. '14:00'
    endTime, // 'HH:MM' e.g. '18:00'
    durationMinutes, // e.g. 15
    breakMinutes, // e.g. 0 or 5
    type, // 'online' | 'offline'
    locationOrLink,
    notes
  } = req.body;

  if (!committeeId || !date || !startTime || !endTime || !durationMinutes || !type) {
    return res.status(400).json({ success: false, message: 'يرجى استكمال جميع البيانات المطلوبة لإنشاء المواعيد' });
  }

  const duration = parseInt(durationMinutes, 10);
  const pause = parseInt(breakMinutes || 0, 10);

  if (duration <= 0) {
    return res.status(400).json({ success: false, message: 'مدة المقابلة يجب أن تكون أكبر من صفر' });
  }

  // Parse start and end time
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);

  let current = new Date(`${date}T${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00`);
  const end = new Date(`${date}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`);

  if (current >= end) {
    return res.status(400).json({ success: false, message: 'وقت نهاية المقابلات يجب أن يكون بعد وقت البداية' });
  }

  const dateDisplay = formatDateDisplay(date);
  const dObj = new Date(date + 'T00:00:00');
  const dayNameAr = dayNamesAr[dObj.getDay()];

  const batchId = `batch_${Date.now()}`;
  const newSlots = [];
  let counter = db.slots.length + 1;

  while (current < end) {
    const slotEnd = new Date(current.getTime() + duration * 60000);
    if (slotEnd > end) {
      break; // Slot exceeds window
    }

    const start24 = `${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`;
    const end24 = `${String(slotEnd.getHours()).padStart(2, '0')}:${String(slotEnd.getMinutes()).padStart(2, '0')}`;

    const slot = {
      id: `slot_${counter++}_${Date.now().toString(36)}`,
      batchId: batchId,
      committeeId: committeeId,
      date: date,
      dayNameAr: dayNameAr,
      dateDisplay: dateDisplay,
      startTime24: start24,
      endTime24: end24,
      timeDisplay: `${formatTime12(start24)} - ${formatTime12(end24)}`,
      durationMinutes: duration,
      type: type, // 'online' | 'offline'
      locationOrLink: locationOrLink || (type === 'online' ? 'رابط Google Meet / Zoom' : 'مقر الكلية'),
      status: 'available',
      candidateId: null,
      candidateName: null,
      candidatePhone: null,
      notes: notes || ''
    };

    newSlots.push(slot);
    current = new Date(slotEnd.getTime() + pause * 60000);
  }

  if (newSlots.length === 0) {
    return res.status(400).json({ success: false, message: 'لم يتم توليد أي مواعيد. تحقق من أن نافذة الوقت كافية لمدة المقابلة الواحدة' });
  }

  // Save batch metadata
  const batchMeta = {
    id: batchId,
    committeeId: committeeId,
    date: date,
    dayNameAr: dayNameAr,
    dateDisplay: dateDisplay,
    startTime: startTime,
    endTime: endTime,
    durationMinutes: duration,
    breakMinutes: pause,
    type: type,
    locationOrLink: locationOrLink || '',
    notes: notes || '',
    totalSlots: newSlots.length,
    createdAt: new Date().toISOString()
  };

  db.slotBatches.push(batchMeta);
  db.slots.push(...newSlots);

  await saveDB(db);

  res.json({
    success: true,
    message: `تم تقسيم وتوليد ${newSlots.length} موعد مقابلة بنجاح ليوم ${dateDisplay}`,
    slotsCount: newSlots.length,
    slots: newSlots,
    batch: batchMeta
  });
});

// Delete an available slot
app.delete('/api/slots/:id', async (req, res) => {
  const db = getDB();
  const idx = db.slots.findIndex(s => s.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'الموعد غير موجود' });
  }

  const slot = db.slots[idx];
  if (slot.status === 'booked') {
    return res.status(400).json({ success: false, message: 'لا يمكن حذف موعد محجوز لمرشح. يرجى إلغاء الحجز أولاً' });
  }

  db.slots.splice(idx, 1);
  await saveDB(db);
  res.json({ success: true, message: 'تم حذف الموعد بنجاح' });
});

// Toggle lock slot
app.put('/api/slots/:id/toggle-lock', async (req, res) => {
  const db = getDB();
  const slot = db.slots.find(s => s.id === req.params.id);
  if (!slot) {
    return res.status(404).json({ success: false, message: 'الموعد غير موجود' });
  }

  if (slot.status === 'booked') {
    return res.status(400).json({ success: false, message: 'الموعد محجوز بالفعل' });
  }

  slot.status = slot.status === 'locked' ? 'available' : 'locked';
  await saveDB(db);

  res.json({
    success: true,
    message: slot.status === 'locked' ? 'تم قفل الموعد مؤقتاً' : 'تم فتح الموعد للحجز',
    slot
  });
});

// ==========================================
// 5. PUBLIC CANDIDATE BOOKING APIS
// ==========================================

// Get public info for candidate booking page
app.get('/api/public/committee/:slug', (req, res) => {
  const db = getDB();
  const comm = db.committees.find(c => c.slug === req.params.slug || c.id === req.params.slug);
  if (!comm) {
    return res.status(404).json({ success: false, message: 'اللجنة غير موجودة' });
  }

  // Get candidates in this committee who haven't booked or are booked
  const candidates = db.candidates
    .filter(c => c.assignedCommitteeId === comm.id)
    .map(c => {
      let sInfo = c.slotInfo;
      let isPast = false;
      if (c.slotId) {
        const s = db.slots.find(slot => slot.id === c.slotId);
        if (s) {
          sInfo = {
            date: s.date,
            dayNameAr: s.dayNameAr,
            dateDisplay: s.dateDisplay,
            timeDisplay: s.timeDisplay,
            startTime24: s.startTime24,
            endTime24: s.endTime24,
            type: s.type,
            locationOrLink: s.locationOrLink
          };
          if (s.date) {
            const timePart = s.startTime24 || '00:00';
            const sDate = new Date(`${s.date}T${timePart}:00`);
            if (!isNaN(sDate.getTime()) && sDate < new Date()) {
              isPast = true;
            }
          }
        }
      }
      return {
        id: c.id,
        num: c.num,
        arabicName: c.arabicName,
        fullName: c.fullName,
        university: c.university,
        faculty: c.faculty,
        grade: c.grade,
        phone: c.phone,
        bookingStatus: c.bookingStatus,
        slotId: c.slotId,
        slotInfo: sInfo ? { ...sInfo, isPast } : null
      };
    });

  res.json({
    success: true,
    committee: {
      id: comm.id,
      name: comm.name,
      shortName: comm.shortName,
      slug: comm.slug,
      color: comm.color,
      badge: comm.badge,
      icon: comm.icon,
      description: comm.description
    },
    candidates: candidates
  });
});

// Get slots available for public booking in a committee
app.get('/api/public/slots/:slug', (req, res) => {
  const db = getDB();
  const comm = db.committees.find(c => c.slug === req.params.slug || c.id === req.params.slug);
  if (!comm) {
    return res.status(404).json({ success: false, message: 'اللجنة غير موجودة' });
  }

  // Slots for this committee
  const slots = db.slots
    .filter(s => s.committeeId === comm.id && s.status !== 'locked')
    .map(s => ({
      id: s.id,
      date: s.date,
      dayNameAr: s.dayNameAr,
      dateDisplay: s.dateDisplay,
      startTime24: s.startTime24,
      endTime24: s.endTime24,
      timeDisplay: s.timeDisplay,
      durationMinutes: s.durationMinutes,
      type: s.type,
      locationOrLink: s.locationOrLink,
      status: s.status, // 'available' | 'booked'
      isAvailable: s.status === 'available',
      candidateName: s.status === 'booked' ? (s.candidateName ? s.candidateName.split(' ')[0] + ' ' + (s.candidateName.split(' ')[1] || '') : 'محجوز') : null
    }));

  // Group slots by date for intuitive UI
  const grouped = {};
  slots.forEach(s => {
    if (!grouped[s.date]) {
      grouped[s.date] = {
        date: s.date,
        dayNameAr: s.dayNameAr,
        dateDisplay: s.dateDisplay,
        onlineCount: 0,
        offlineCount: 0,
        availableCount: 0,
        slots: []
      };
    }
    grouped[s.date].slots.push(s);
    if (s.isAvailable) grouped[s.date].availableCount++;
    if (s.type === 'online') grouped[s.date].onlineCount++;
    if (s.type === 'offline') grouped[s.date].offlineCount++;
  });

  res.json({
    success: true,
    committeeName: comm.name,
    totalSlots: slots.length,
    availableSlots: slots.filter(s => s.isAvailable).length,
    days: Object.values(grouped),
    allSlots: slots
  });
});

// Candidate Booking Execution
app.post('/api/public/book', async (req, res) => {
  const db = getDB();
  const { candidateId, slotId, phone } = req.body;

  if (!candidateId || !slotId) {
    return res.status(400).json({ success: false, message: 'يرجى اختيار اسم المرشح والموعد المراد حجزه' });
  }

  const cand = db.candidates.find(c => c.id === candidateId);
  if (!cand) {
    return res.status(404).json({ success: false, message: 'لم يتم العثور على بيانات المرشح' });
  }

  // Optional phone security check: if phone provided, verify last 4 digits
  if (phone) {
    const cleanCandPhone = cand.phone.replace(/\D/g, '');
    const cleanInputPhone = String(phone).replace(/\D/g, '');
    if (!cleanCandPhone.endsWith(cleanInputPhone) && !cleanInputPhone.endsWith(cleanCandPhone)) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف غير متطابق مع بيانات المرشح المسجلة' });
    }
  }

  const slot = db.slots.find(s => s.id === slotId);
  if (!slot) {
    return res.status(404).json({ success: false, message: 'الموعد المحدد غير موجود' });
  }

  // Ensure candidate can only book slots within their assigned committee
  if (slot.committeeId !== cand.assignedCommitteeId) {
    return res.status(400).json({ success: false, message: 'هذا الموعد يتبع قطاعاً آخر غير المسجل به المرشح' });
  }

  if (slot.status !== 'available' && slot.candidateId !== cand.id) {
    return res.status(400).json({ success: false, message: 'عذراً، هذا الموعد تم حجزه للتو من قِبل مرشح آخر. يرجى اختيار موعد آخر' });
  }

  // Already booked in this exact slot
  if (cand.slotId === slotId) {
    const comm = db.committees.find(c => c.id === cand.assignedCommitteeId);
    return res.json({
      success: true,
      message: 'أنت مسجل بالفعل في هذا الموعد المحدد',
      bookingDetails: {
        candidateName: cand.arabicName,
        committeeName: comm ? comm.name : cand.firstPreference,
        dateDisplay: slot.dateDisplay,
        timeDisplay: slot.timeDisplay,
        type: slot.type === 'online' ? 'أونلاين (Online)' : 'أوفلاين (حضوري)',
        locationOrLink: slot.locationOrLink,
        notes: slot.notes
      }
    });
  }

  // Free candidate's prior slot if rescheduling
  if (cand.slotId && cand.slotId !== slotId) {
    const oldSlot = db.slots.find(s => s.id === cand.slotId);
    if (oldSlot) {
      // Check if previous slot time has already passed
      let isPast = false;
      if (oldSlot.date) {
        const timePart = oldSlot.startTime24 || '00:00';
        const oldSlotDateTime = new Date(`${oldSlot.date}T${timePart}:00`);
        if (!isNaN(oldSlotDateTime.getTime()) && oldSlotDateTime < new Date()) {
          isPast = true;
        }
      }
      if (isPast) {
        return res.status(400).json({
          success: false,
          message: 'عذراً، لقد انقضى موعد مقابلتك السابق بالفعل ولا يمكن تعديله ذاتياً. يرجى مراجعة إدارة القطاع.'
        });
      }

      oldSlot.status = 'available';
      oldSlot.candidateId = null;
      oldSlot.candidateName = null;
      oldSlot.candidatePhone = null;
    }
  }

  // Reserve the slot
  slot.status = 'booked';
  slot.candidateId = cand.id;
  slot.candidateName = cand.arabicName;
  slot.candidatePhone = cand.phone;

  // Update candidate
  cand.slotId = slot.id;
  cand.bookingStatus = 'booked';
  cand.slotInfo = {
    date: slot.date,
    dayNameAr: slot.dayNameAr,
    dateDisplay: slot.dateDisplay,
    timeDisplay: slot.timeDisplay,
    startTime24: slot.startTime24,
    endTime24: slot.endTime24,
    type: slot.type,
    locationOrLink: slot.locationOrLink
  };

  const comm = db.committees.find(c => c.id === cand.assignedCommitteeId);

  await saveDB(db);

  res.json({
    success: true,
    message: `تهانينا يا ${cand.arabicName}، تم تأكيد حجز موعد المقابلة بنجاح!`,
    bookingDetails: {
      candidateName: cand.arabicName,
      committeeName: comm ? comm.name : cand.firstPreference,
      dateDisplay: slot.dateDisplay,
      timeDisplay: slot.timeDisplay,
      type: slot.type === 'online' ? 'أونلاين (Online)' : 'أوفلاين (حضوري)',
      locationOrLink: slot.locationOrLink,
      notes: slot.notes
    }
  });
});

// Candidate lookup by phone or name
app.get('/api/public/search-candidate', (req, res) => {
  const db = getDB();
  const { query, committeeSlug } = req.query;

  if (!query || query.trim().length < 2) {
    return res.json({ success: true, candidates: [] });
  }

  const rawQ = query.trim();
  const q = normalizeArabic(rawQ);
  const cleanPhoneQ = rawQ.replace(/\D/g, '');
  let list = db.candidates;

  if (committeeSlug && committeeSlug !== 'all') {
    const comm = db.committees.find(c => c.slug === committeeSlug || c.id === committeeSlug);
    if (comm) {
      list = list.filter(c => c.assignedCommitteeId === comm.id);
    }
  }

  const matches = list.filter(c => {
    const nameMatch = normalizeArabic(c.arabicName).includes(q) || normalizeArabic(c.fullName).includes(q);
    const phoneMatch = cleanPhoneQ.length >= 3 && c.phone && c.phone.replace(/\D/g, '').includes(cleanPhoneQ);
    return nameMatch || phoneMatch;
  }).slice(0, 15).map(c => {
    const comm = db.committees.find(cm => cm.id === c.assignedCommitteeId);
    return {
      id: c.id,
      num: c.num,
      arabicName: c.arabicName,
      phone: c.phone,
      university: c.university,
      faculty: c.faculty,
      grade: c.grade,
      assignedCommitteeId: c.assignedCommitteeId,
      assignedCommitteeName: comm ? comm.name : c.firstPreference,
      bookingStatus: c.bookingStatus,
      slotInfo: c.slotInfo
    };
  });

  res.json({ success: true, candidates: matches });
});

// ==========================================
// 6. GLOBAL STATS & AUDIT LOGS
// ==========================================

app.get('/api/stats/overview', (req, res) => {
  const db = getDB();
  
  const totalCandidates = db.candidates.length;
  const bookedCandidates = db.candidates.filter(c => c.bookingStatus === 'booked' || c.bookingStatus === 'completed').length;
  const completedInterviews = db.candidates.filter(c => c.interviewStatus === 'completed' || (c.evaluation && c.evaluation.score !== null)).length;
  const absentCount = db.candidates.filter(c => c.bookingStatus === 'absent' || (c.evaluation && c.evaluation.attendanceStatus === 'absent')).length;
  const pendingBooking = totalCandidates - bookedCandidates;

  const totalSlots = db.slots.length;
  const availableSlots = db.slots.filter(s => s.status === 'available').length;
  const bookedSlots = db.slots.filter(s => s.status === 'booked').length;

  const ratedCandidates = db.candidates.filter(c => c.evaluation && typeof c.evaluation.score === 'number');
  const globalAvgRating = ratedCandidates.length > 0 
    ? (ratedCandidates.reduce((sum, c) => sum + c.evaluation.score, 0) / ratedCandidates.length).toFixed(1)
    : null;

  // Breakdown by university
  const universityBreakdown = {};
  db.candidates.forEach(c => {
    const u = c.university || 'أخرى';
    universityBreakdown[u] = (universityBreakdown[u] || 0) + 1;
  });

  // Breakdown by track preference
  const trackBreakdown = {};
  db.candidates.forEach(c => {
    const t = c.trackPreference || 'غير محدد';
    trackBreakdown[t] = (trackBreakdown[t] || 0) + 1;
  });

  res.json({
    success: true,
    stats: {
      totalCandidates,
      bookedCandidates,
      completedInterviews,
      absentCount,
      pendingBooking,
      totalSlots,
      availableSlots,
      bookedSlots,
      globalAvgRating,
      ratedCount: ratedCandidates.length,
      universityBreakdown,
      trackBreakdown
    },
    recentTransfers: db.transferAuditLogs.slice(-10).reverse()
  });
});

// ==========================================
// 7. EXPORT TO CSV APIS
// ==========================================

app.get('/api/export/committee/:slug/csv', (req, res) => {
  const db = getDB();
  const comm = db.committees.find(c => c.slug === req.params.slug || c.id === req.params.slug);
  
  let candidates = db.candidates;
  let filename = 'all_candidates.csv';
  
  if (comm) {
    candidates = candidates.filter(c => c.assignedCommitteeId === comm.id);
    filename = `candidates_${comm.slug}.csv`;
  }

  // BOM for Excel Arabic support
  let csv = '\uFEFF';
  csv += 'م,الاسم بالعربي,الاسم بالإنجليزية,الجامعة,الكلية,الفرقة,رقم الهاتف,البريد الإلكتروني,اللجنة الحالية,حالة الحجز,تاريخ المقابلة,وقت المقابلة,نوع المقابلة,المكان أو الرابط,حالة الحضور,التقييم (من 10),قرار اللجنة,ملاحظات المقابلة\n';

  candidates.forEach((c, idx) => {
    const date = c.slotInfo ? c.slotInfo.dateDisplay : 'لم يحجز';
    const time = c.slotInfo ? c.slotInfo.timeDisplay : '';
    const type = c.slotInfo ? (c.slotInfo.type === 'online' ? 'أونلاين' : 'أوفلاين') : '';
    const loc = c.slotInfo ? (c.slotInfo.locationOrLink || '') : '';
    const attendance = c.evaluation ? (c.evaluation.attendanceStatus === 'attended' ? 'حاضر' : (c.evaluation.attendanceStatus === 'absent' ? 'غائب' : 'قيد الانتظار')) : 'قيد الانتظار';
    const score = c.evaluation && c.evaluation.score !== null ? c.evaluation.score : '';
    const decision = c.evaluation && c.evaluation.decision ? c.evaluation.decision : 'معلق';
    const notes = (c.evaluation && c.evaluation.notes ? c.evaluation.notes : '').replace(/"/g, '""');

    csv += `${idx + 1},"${c.arabicName}","${c.fullName}","${c.university}","${c.faculty}","${c.grade}","${c.phone}","${c.email}","${c.firstPreference}","${c.bookingStatus}","${date}","${time}","${type}","${loc}","${attendance}","${score}","${decision}","${notes}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});



// ==========================================
// QUIZZES, ATTENDANCE & GRADEBOOK APIs
// ==========================================

// Get quizzes (filtered by committeeId, or all for General Admin)
app.get('/api/quizzes', (req, res) => {
  const db = getDB();
  let quizzes = db.quizzes || [];
  const { committeeId } = req.query;
  if (committeeId && committeeId !== 'all') {
    quizzes = quizzes.filter(q => q.committeeId === committeeId || q.committeeId === 'all');
  }
  const submissions = db.quizSubmissions || [];
  const enriched = quizzes.map(q => {
    const subs = submissions.filter(s => s.quizId === q.id);
    const avgScore = subs.length > 0 ? (subs.reduce((acc, s) => acc + (s.score || 0), 0) / subs.length).toFixed(1) : 0;
    return {
      ...q,
      submissionsCount: subs.length,
      averageScore: parseFloat(avgScore)
    };
  });
  res.json({ success: true, quizzes: enriched });
});

// Create Quiz
app.post('/api/quizzes', async (req, res) => {
  const db = getDB();
  if (!db.quizzes) db.quizzes = [];
  const {
    title,
    lectureNumber,
    committeeId,
    durationMinutes,
    description,
    questions
  } = req.body;

  if (!title || !committeeId || !questions || !questions.length) {
    return res.status(400).json({ success: false, message: 'يرجى إدخال عنوان الاختبار والأسئلة واللجنة' });
  }

  const committee = db.committees.find(c => c.id === committeeId);
  const totalPoints = questions.reduce((sum, q) => sum + (parseFloat(q.points) || 1), 0);

  const newQuiz = {
    id: 'quiz_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    committeeId,
    committeeName: committee ? committee.name : 'عام لجميع القطاعات',
    title: title.trim(),
    lectureNumber: parseInt(lectureNumber) || (db.quizzes.filter(q => q.committeeId === committeeId).length + 1),
    durationMinutes: parseInt(durationMinutes) || 10,
    description: description || '',
    isOpen: true,
    createdAt: new Date().toISOString(),
    totalPoints,
    questions: questions.map((q, idx) => ({
      id: q.id || 'q_' + (idx + 1),
      type: q.type || 'mcq', // 'mcq' | 'true_false'
      prompt: (q.prompt || '').trim(),
      options: q.type === 'true_false' ? ['صح', 'خطأ'] : (q.options || []),
      correctAnswer: parseInt(q.correctAnswer) || 0,
      points: parseFloat(q.points) || 1
    }))
  };

  db.quizzes.unshift(newQuiz);
  await saveDB(db);
  res.json({ success: true, message: 'تم إنشاء الاختبار بنجاح', quiz: newQuiz });
});

// Update / Toggle Quiz
app.put('/api/quizzes/:id', async (req, res) => {
  const db = getDB();
  if (!db.quizzes) db.quizzes = [];
  const quiz = db.quizzes.find(q => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ success: false, message: 'الاختبار غير موجود' });

  const { title, lectureNumber, durationMinutes, description, isOpen, questions } = req.body;
  if (title !== undefined) quiz.title = title;
  if (lectureNumber !== undefined) quiz.lectureNumber = parseInt(lectureNumber);
  if (durationMinutes !== undefined) quiz.durationMinutes = parseInt(durationMinutes);
  if (description !== undefined) quiz.description = description;
  if (isOpen !== undefined) quiz.isOpen = !!isOpen;
  if (questions && questions.length) {
    quiz.questions = questions.map((q, idx) => ({
      id: q.id || 'q_' + (idx + 1),
      type: q.type || 'mcq',
      prompt: (q.prompt || '').trim(),
      options: q.type === 'true_false' ? ['صح', 'خطأ'] : (q.options || []),
      correctAnswer: parseInt(q.correctAnswer) || 0,
      points: parseFloat(q.points) || 1
    }));
    quiz.totalPoints = quiz.questions.reduce((sum, q) => sum + (parseFloat(q.points) || 1), 0);
  }

  await saveDB(db);
  res.json({ success: true, message: 'تم تحديث الاختبار بنجاح', quiz });
});

// Delete Quiz
app.delete('/api/quizzes/:id', async (req, res) => {
  const db = getDB();
  if (!db.quizzes) db.quizzes = [];
  const idx = db.quizzes.findIndex(q => q.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'الاختبار غير موجود' });

  db.quizzes.splice(idx, 1);
  if (db.quizSubmissions) {
    db.quizSubmissions = db.quizSubmissions.filter(s => s.quizId !== req.params.id);
  }
  await saveDB(db);
  res.json({ success: true, message: 'تم حذف الاختبار' });
});

// Get Quiz Submissions for Head/Admin
app.get('/api/quizzes/:id/submissions', (req, res) => {
  const db = getDB();
  const quiz = (db.quizzes || []).find(q => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ success: false, message: 'الاختبار غير موجود' });
  const rawSubmissions = (db.quizSubmissions || []).filter(s => s.quizId === req.params.id);

  // Enrich submissions with candidate details and lecture evaluations
  const submissions = rawSubmissions.map(s => {
    const cand = (db.candidates || []).find(c => c.id === s.candidateId || c.email === s.candidateEmail);
    const roleType = cand ? (cand.roleType || 'delegate') : 'delegate';
    const subDepartment = cand ? (cand.subDepartment || null) : null;
    const arabicName = cand ? (cand.arabicName || s.candidateName) : s.candidateName;
    const lectureEval = (cand && cand.lectureEvaluations) ? cand.lectureEvaluations[quiz.id] : null;

    return {
      ...s,
      candidateId: cand ? cand.id : s.candidateId,
      candidateName: arabicName,
      roleType,
      subDepartment,
      assignmentStatus: lectureEval ? lectureEval.assignmentStatus : (s.assignmentStatus || 'pending'),
      assignmentScore: lectureEval ? lectureEval.assignmentScore : (s.assignmentScore !== undefined ? s.assignmentScore : null),
      bonusScore: lectureEval ? (lectureEval.bonusScore || 0) : (s.bonusScore || 0),
      bonusReason: lectureEval ? lectureEval.bonusReason : (s.bonusReason || ''),
      assignmentNotes: lectureEval ? lectureEval.notes : (s.assignmentNotes || ''),
      taskDescription: lectureEval ? lectureEval.taskDescription : (s.taskDescription || ''),
      evaluatedAt: lectureEval ? lectureEval.evaluatedAt : (s.evaluatedAt || null)
    };
  });

  res.json({ success: true, quiz, submissions });
});

// PUT /api/candidates/:id/lecture-eval (Evaluate delegate/member lecture assignment & weekly performance)
app.put('/api/candidates/:id/lecture-eval', async (req, res) => {
  const db = getDB();
  const cand = (db.candidates || []).find(c => c.id === req.params.id);
  if (!cand) return res.status(404).json({ success: false, message: 'المرشح غير موجود' });

  const { quizId, lectureNumber, assignmentStatus, assignmentScore, bonusScore, bonusReason, notes, taskDescription } = req.body;
  if (!quizId) return res.status(400).json({ success: false, message: 'معرف الاختبار مطلوب' });

  if (!cand.lectureEvaluations) cand.lectureEvaluations = {};
  const parsedScore = (assignmentScore !== undefined && assignmentScore !== '' && assignmentScore !== null) ? parseFloat(assignmentScore) : null;
  const parsedBonus = (bonusScore !== undefined && bonusScore !== '' && bonusScore !== null) ? parseFloat(bonusScore) : 0;
  const lectNum = parseInt(lectureNumber) || 1;

  cand.lectureEvaluations[quizId] = {
    quizId,
    lectureNumber: lectNum,
    assignmentStatus: assignmentStatus || 'submitted',
    assignmentScore: parsedScore,
    bonusScore: parsedBonus,
    bonusReason: bonusReason || '',
    notes: notes || '',
    taskDescription: taskDescription || '',
    evaluatedAt: new Date().toISOString()
  };

  // If candidate is a committee member, record weekly evaluation & compute monthly cumulative score
  if (cand.roleType === 'member') {
    if (!cand.weeklyEvaluations) cand.weeklyEvaluations = {};
    const weekKey = `week_${lectNum}`;
    cand.weeklyEvaluations[weekKey] = {
      weekKey,
      lectureNumber: lectNum,
      quizId,
      score: parsedScore,
      assignmentStatus: assignmentStatus || 'submitted',
      taskDescription: taskDescription || '',
      notes: notes || '',
      evaluatedAt: new Date().toISOString()
    };

    // Calculate updated cumulative member evaluation score
    const scores = Object.values(cand.weeklyEvaluations)
      .map(w => w.score)
      .filter(s => typeof s === 'number' && !isNaN(s));
    if (scores.length > 0) {
      if (!cand.memberEvaluation) cand.memberEvaluation = {};
      cand.memberEvaluation.score = +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
      cand.memberEvaluation.updatedAt = new Date().toISOString();
      if (notes) cand.memberEvaluation.notes = notes;
    }
  }

  // Also update corresponding quizSubmission in db.quizSubmissions
  if (db.quizSubmissions) {
    const sub = db.quizSubmissions.find(s => s.quizId === quizId && (s.candidateId === cand.id || s.candidateEmail === cand.email));
    if (sub) {
      sub.assignmentStatus = assignmentStatus || 'submitted';
      sub.assignmentScore = parsedScore;
      sub.bonusScore = parsedBonus;
      sub.bonusReason = bonusReason || '';
      sub.assignmentNotes = notes || '';
      sub.taskDescription = taskDescription || '';
      sub.evaluatedAt = new Date().toISOString();
    }
  }

  await saveDB(db);
  res.json({ success: true, message: 'تم حفظ تقييم المحاضرة والأسينمنت بنجاح', candidate: cand });
});

// GET /api/members/monthly-evaluations
app.get('/api/members/monthly-evaluations', (req, res) => {
  const db = getDB();
  const { committeeId } = req.query;

  let members = (db.candidates || []).filter(c => c.evaluation && c.evaluation.decision === 'accepted' && c.roleType === 'member');
  if (committeeId && committeeId !== 'all') {
    members = members.filter(c => c.assignedCommitteeId === committeeId);
  }

  const result = members.map(m => {
    const weekly = m.weeklyEvaluations || {};
    
    // Month 1: Weeks 1, 2, 3, 4
    const m1Weeks = [1, 2, 3, 4].map(w => weekly[`week_${w}`] || null);
    const m1Scores = m1Weeks.filter(w => w && typeof w.score === 'number').map(w => w.score);
    const m1Avg = m1Scores.length > 0 ? +(m1Scores.reduce((a, b) => a + b, 0) / m1Scores.length).toFixed(1) : null;
    
    // Month 2: Weeks 5, 6, 7, 8
    const m2Weeks = [5, 6, 7, 8].map(w => weekly[`week_${w}`] || null);
    const m2Scores = m2Weeks.filter(w => w && typeof w.score === 'number').map(w => w.score);
    const m2Avg = m2Scores.length > 0 ? +(m2Scores.reduce((a, b) => a + b, 0) / m2Scores.length).toFixed(1) : null;

    return {
      id: m.id,
      fullName: m.fullName,
      arabicName: m.arabicName || m.fullName,
      email: m.email,
      phone: m.phone,
      subDepartment: m.subDepartment || 'academic',
      faculty: m.faculty,
      weeklyEvaluations: weekly,
      overallScore: (m.memberEvaluation && typeof m.memberEvaluation.score === 'number') ? m.memberEvaluation.score : null,
      month1Average: m1Avg,
      month2Average: m2Avg,
      month1: {
        weeks: m1Weeks,
        evaluatedCount: m1Scores.length,
        avgScore: m1Avg
      },
      month2: {
        weeks: m2Weeks,
        evaluatedCount: m2Scores.length,
        avgScore: m2Avg
      }
    };
  });

  res.json({ success: true, members: result });
});

// Public: Get Quiz for Taking (WITHOUT correct answers to prevent inspection cheating)
app.get('/api/public/quiz/:id', (req, res) => {
  const db = getDB();
  const quiz = (db.quizzes || []).find(q => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ success: false, message: 'عذراً، هذا الاختبار غير متاح' });

  const safeQuestions = quiz.questions.map(q => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: q.options,
    points: q.points
  }));

  res.json({
    success: true,
    quiz: {
      id: quiz.id,
      committeeId: quiz.committeeId,
      committeeName: quiz.committeeName,
      title: quiz.title,
      lectureNumber: quiz.lectureNumber,
      description: quiz.description,
      durationMinutes: quiz.durationMinutes,
      isOpen: quiz.isOpen,
      totalPoints: quiz.totalPoints,
      questionsCount: safeQuestions.length,
      questions: safeQuestions
    }
  });
});

// Public: Check Delegate Login before Quiz
// Public: Check Delegate Login before Quiz (Supports Email OR Phone login, blocks committee members)
app.post('/api/public/quiz/:id/check-delegate', (req, res) => {
  const db = getDB();
  const quiz = (db.quizzes || []).find(q => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ success: false, message: 'الاختبار غير موجود' });
  if (!quiz.isOpen) return res.status(400).json({ success: false, message: 'الاختبار مغلق حالياً من قِبل إدارة القطاع' });

  const inputEmailOrPhone = (req.body.email || req.body.emailOrPhone || '').trim();
  const password = req.body.password;
  if (!inputEmailOrPhone || !password) {
    return res.status(400).json({ success: false, message: 'البريد الإلكتروني (أو رقم الهاتف) وكلمة المرور مطلوبان' });
  }

  const inputRaw = inputEmailOrPhone;
  const inputLower = inputRaw.toLowerCase();
  const inputPhone = cleanPhone(inputRaw);

  const cand = (db.candidates || []).find(c => {
    const cEmail = (c.email || '').toLowerCase().trim();
    const cPhone = cleanPhone(c.phone);
    return cEmail === inputLower || (inputPhone && cPhone === inputPhone);
  });

  if (!cand) {
    return res.status(404).json({ success: false, message: 'البريد أو رقم الهاتف غير مسجل في المنظومة' });
  }

  // Quizzes are specifically for DELEGATES, not committee members
  if (cand.roleType === 'member') {
    return res.status(403).json({
      success: false,
      message: 'عذراً، هذا الاختبار مخصص للمناديب الأكاديميين فقط. بصفتك عضواً في الهيكل التنظيمي للجنة ليس لديك اختبار.'
    });
  }

  const validPassword = cand.delegatePassword || '1234';
  if (password.trim() !== validPassword && password.trim() !== '1234') {
    return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة (كلمة المرور الموحدة هي 1234)' });
  }

  // Check if already submitted
  const prevSub = (db.quizSubmissions || []).find(s => s.quizId === quiz.id && s.candidateId === cand.id);

  res.json({
    success: true,
    candidate: {
      id: cand.id,
      arabicName: cand.arabicName || cand.fullName,
      fullName: cand.fullName,
      email: cand.email,
      faculty: cand.faculty,
      committeeId: cand.assignedCommitteeId
    },
    alreadySubmitted: !!prevSub,
    previousResult: prevSub ? {
      score: prevSub.score,
      totalPoints: prevSub.totalPoints,
      percentage: prevSub.percentage,
      submittedAt: prevSub.submittedAt
    } : null
  });
});

// Public: Submit Quiz & Record Attendance
app.post('/api/public/quiz/:id/submit', async (req, res) => {
  const db = getDB();
  const quiz = (db.quizzes || []).find(q => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ success: false, message: 'الاختبار غير متاح' });

  const { candidateId, email, password, answers, timeTakenSeconds } = req.body;
  const cleanEmail = (email || '').toLowerCase().trim();
  const cand = db.candidates.find(c => c.id === candidateId || (c.email || '').toLowerCase().trim() === cleanEmail);

  if (!cand) {
    return res.status(404).json({ success: false, message: 'المندوب غير مسجل' });
  }

  if (!db.quizSubmissions) db.quizSubmissions = [];
  const existingSub = db.quizSubmissions.find(s => s.quizId === quiz.id && s.candidateId === cand.id);
  if (existingSub) {
    return res.json({
      success: true,
      alreadySubmitted: true,
      score: existingSub.score,
      totalPoints: existingSub.totalPoints,
      percentage: existingSub.percentage,
      submittedAt: existingSub.submittedAt,
      message: 'تم تسجيل حضورك وإجابتك مسبقاً!'
    });
  }

  let totalScore = 0;
  const review = quiz.questions.map(q => {
    const selected = answers ? answers[q.id] : undefined;
    const isCorrect = selected !== undefined && parseInt(selected) === parseInt(q.correctAnswer);
    const pointsAwarded = isCorrect ? (parseFloat(q.points) || 1) : 0;
    totalScore += pointsAwarded;
    return {
      id: q.id,
      prompt: q.prompt,
      type: q.type,
      options: q.options,
      selectedAnswer: selected !== undefined ? parseInt(selected) : null,
      correctAnswer: q.correctAnswer,
      isCorrect,
      points: q.points,
      pointsAwarded
    };
  });

  const percentage = quiz.totalPoints > 0 ? Math.round((totalScore / quiz.totalPoints) * 100) : 100;
  const now = new Date().toISOString();

  const submission = {
    id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    quizId: quiz.id,
    lectureNumber: quiz.lectureNumber,
    quizTitle: quiz.title,
    committeeId: quiz.committeeId,
    candidateId: cand.id,
    candidateName: cand.arabicName || cand.fullName,
    candidateEmail: cand.email,
    candidatePhone: cand.phone,
    candidateFaculty: cand.faculty,
    answers: answers || {},
    score: totalScore,
    totalPoints: quiz.totalPoints,
    percentage,
    timeTakenSeconds: timeTakenSeconds || 0,
    attendance: true,
    submittedAt: now
  };

  db.quizSubmissions.push(submission);
  await saveDB(db);

  res.json({
    success: true,
    score: totalScore,
    totalPoints: quiz.totalPoints,
    percentage,
    passed: percentage >= 50,
    submittedAt: now,
    timeTakenSeconds,
    review,
    message: 'تهانينا! تم تسليم الاختبار وتسجيل حضورك في المحاضرة بنجاح'
  });
});

// Gradebook Matrix & Attendance Sheet API
app.get('/api/gradebook', (req, res) => {
  const db = getDB();
  const { committeeId } = req.query;

  let candidates = db.candidates.filter(c => c.evaluation && c.evaluation.decision === 'accepted');
  if (committeeId && committeeId !== 'all') {
    candidates = candidates.filter(c => c.assignedCommitteeId === committeeId);
  }

  let quizzes = db.quizzes || [];
  if (committeeId && committeeId !== 'all') {
    quizzes = quizzes.filter(q => q.committeeId === committeeId || q.committeeId === 'all');
  }
  quizzes.sort((a, b) => (a.lectureNumber || 0) - (b.lectureNumber || 0));

  const submissions = db.quizSubmissions || [];

  const rows = candidates.map(cand => {
    const candSubs = submissions.filter(s => s.candidateId === cand.id);
    const quizGrades = {};
    let attendedQuizzesCount = 0;
    let totalScoreSum = 0;
    let totalMaxSum = 0;

    quizzes.forEach(q => {
      const sub = candSubs.find(s => s.quizId === q.id);
      if (sub) {
        quizGrades[q.id] = {
          attended: true,
          score: sub.score,
          totalPoints: sub.totalPoints,
          percentage: sub.percentage,
          submittedAt: sub.submittedAt
        };
        attendedQuizzesCount++;
        totalScoreSum += sub.score;
        totalMaxSum += sub.totalPoints;
      } else {
        quizGrades[q.id] = {
          attended: false,
          score: 0,
          totalPoints: q.totalPoints,
          percentage: 0
        };
      }
    });

    const attendanceRate = quizzes.length > 0 ? Math.round((attendedQuizzesCount / quizzes.length) * 100) : 100;
    const averageScore = totalMaxSum > 0 ? Math.round((totalScoreSum / totalMaxSum) * 100) : 0;

    return {
      id: cand.id,
      candidateId: cand.id,
      arabicName: cand.arabicName || cand.fullName,
      fullName: cand.fullName,
      email: cand.email,
      phone: cand.phone,
      university: cand.university,
      faculty: cand.faculty,
      grade: cand.grade,
      assignedCommitteeId: cand.assignedCommitteeId,
      roleType: cand.roleType || 'delegate',
      subDepartment: cand.subDepartment || null,
      memberEvaluation: cand.memberEvaluation || { score: null, notes: '' },
      interviewScore: cand.evaluation ? cand.evaluation.score : null,
      quizGrades,
      attendedQuizzesCount,
      totalQuizzesCount: quizzes.length,
      attendanceRate,
      averageScore
    };
  });

  res.json({
    success: true,
    quizzes: quizzes.map(q => ({ id: q.id, title: q.title, lectureNumber: q.lectureNumber, totalPoints: q.totalPoints })),
    rows
  });
});

// General Administration Performance Across All 9 Committees
app.get('/api/admin/all-committees-performance', (req, res) => {
  const db = getDB();
  const committees = db.committees || [];
  const candidates = db.candidates || [];
  const quizzes = db.quizzes || [];
  const submissions = db.quizSubmissions || [];

  const summary = committees.map(comm => {
    const commCands = candidates.filter(c => c.assignedCommitteeId === comm.id);
    const accepted = commCands.filter(c => c.evaluation && c.evaluation.decision === 'accepted');
    const delegates = accepted.filter(c => (c.roleType || 'delegate') === 'delegate');
    const members = accepted.filter(c => c.roleType === 'member');
    const hrMembers = members.filter(c => c.subDepartment === 'hr');
    const mediaMembers = members.filter(c => c.subDepartment === 'media');
    const academicMembers = members.filter(c => c.subDepartment === 'academic');

    const commQuizzes = quizzes.filter(q => q.committeeId === comm.id);
    const commSubs = submissions.filter(s => s.committeeId === comm.id);

    const potentialAttendances = delegates.length * commQuizzes.length;
    const actualAttendances = commSubs.length;
    const attendanceRate = potentialAttendances > 0 ? Math.round((actualAttendances / potentialAttendances) * 100) : (commQuizzes.length === 0 ? 100 : 0);

    const averageScore = commSubs.length > 0 ? Math.round(commSubs.reduce((acc, s) => acc + (s.percentage || 0), 0) / commSubs.length) : 0;

    return {
      committeeId: comm.id,
      committeeName: comm.name,
      slug: comm.slug,
      color: comm.color,
      icon: comm.icon,
      totalCandidates: commCands.length,
      acceptedCount: accepted.length,
      delegatesCount: delegates.length,
      membersCount: members.length,
      hrCount: hrMembers.length,
      mediaCount: mediaMembers.length,
      academicCount: academicMembers.length,
      quizzesCount: commQuizzes.length,
      submissionsCount: commSubs.length,
      attendanceRate,
      averageScore
    };
  });

  res.json({ success: true, summary });
});

const PUBLIC_DIR = path.resolve(__dirname, 'public');

// Root redirects directly to login (user requested no landing page)
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Fallback direct routes to HTML files
app.get('/dashboard', (req, res) => {
  res.sendFile('dashboard.html', { root: PUBLIC_DIR });
});

app.get('/login', (req, res) => {
  res.sendFile('login.html', { root: PUBLIC_DIR });
});

app.get('/book/:slug', (req, res) => {
  res.sendFile('book.html', { root: PUBLIC_DIR });
});

app.get('/book', (req, res) => {
  res.sendFile('book.html', { root: PUBLIC_DIR });
});

app.get('/quiz/:id', (req, res) => {
  res.sendFile('quiz.html', { root: PUBLIC_DIR });
});

app.get('/quiz', (req, res) => {
  res.sendFile('quiz.html', { root: PUBLIC_DIR });
});

// Catch-all fallback
app.use((req, res) => {
  res.redirect('/login');
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  نظام مقابلات نموذج محاكاة وزارة الخارجية يعمل بنجاح!`);
  console.log(`  الموقع متاح على: http://localhost:${PORT}`);
  console.log(`  لوحة تحكم اللجان: http://localhost:${PORT}/dashboard`);
  console.log(`  بوابة حجز الطلاب: http://localhost:${PORT}/book`);
  console.log(`=======================================================`);
});
