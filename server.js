const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Database Layer (Supabase PostgreSQL with fallback to local db.json)
const dbLayer = require('./db_supabase');
const getDB = dbLayer.getDB;
const saveDB = dbLayer.saveDB;

// Arabic Day Names mapping
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
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
  }

  const db = getDB();
  const cleanUser = String(username).trim().toLowerCase();
  const user = db.users.find(u => u.username.toLowerCase() === cleanUser && u.password === password);

  if (!user) {
    return res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }

  // Find committee info if committee head
  let committee = null;
  if (user.committeeId) {
    committee = db.committees.find(c => c.id === user.committeeId);
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
app.post('/api/candidates', (req, res) => {
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
  saveDB(db);

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
app.put('/api/candidates/:id/evaluation', (req, res) => {
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
    interviewerName
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

  saveDB(db);
  res.json({ success: true, message: 'تم حفظ التقييم بنجاح', candidate: cand });
});

// Transfer candidate to another committee
app.post('/api/candidates/:id/transfer', (req, res) => {
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

  // Free up previous slot if booked
  if (cand.slotId) {
    const slot = db.slots.find(s => s.id === cand.slotId);
    if (slot) {
      slot.status = 'available';
      slot.candidateId = null;
      slot.candidateName = null;
      slot.candidatePhone = null;
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

  saveDB(db);
  res.json({
    success: true,
    message: `تم تحويل المرشح ${cand.arabicName} إلى ${newComm.name} بنجاح`,
    candidate: cand
  });
});

// Manual slot assignment or change by Committee Head
app.post('/api/candidates/:id/assign-slot', (req, res) => {
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

  saveDB(db);
  res.json({
    success: true,
    message: `تم تعيين موعد المقابلة بنجاح: ${targetSlot.dateDisplay} (${targetSlot.timeDisplay})`,
    candidate: cand,
    slot: targetSlot
  });
});

// Cancel a candidate's booking
app.delete('/api/candidates/:id/booking', (req, res) => {
  const db = getDB();
  const cand = db.candidates.find(c => c.id === req.params.id);
  if (!cand) {
    return res.status(404).json({ success: false, message: 'المرشح غير موجود' });
  }

  if (cand.slotId) {
    const slot = db.slots.find(s => s.id === cand.slotId);
    if (slot) {
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

  saveDB(db);
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
app.post('/api/slots/batch', (req, res) => {
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

  saveDB(db);

  res.json({
    success: true,
    message: `تم تقسيم وتوليد ${newSlots.length} موعد مقابلة بنجاح ليوم ${dateDisplay}`,
    slotsCount: newSlots.length,
    slots: newSlots,
    batch: batchMeta
  });
});

// Delete an available slot
app.delete('/api/slots/:id', (req, res) => {
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
  saveDB(db);
  res.json({ success: true, message: 'تم حذف الموعد بنجاح' });
});

// Toggle lock slot
app.put('/api/slots/:id/toggle-lock', (req, res) => {
  const db = getDB();
  const slot = db.slots.find(s => s.id === req.params.id);
  if (!slot) {
    return res.status(404).json({ success: false, message: 'الموعد غير موجود' });
  }

  if (slot.status === 'booked') {
    return res.status(400).json({ success: false, message: 'الموعد محجوز بالفعل' });
  }

  slot.status = slot.status === 'locked' ? 'available' : 'locked';
  saveDB(db);

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
    .map(c => ({
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
      slotInfo: c.slotInfo
    }));

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
app.post('/api/public/book', (req, res) => {
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

  if (slot.status !== 'available' && slot.candidateId !== cand.id) {
    return res.status(400).json({ success: false, message: 'عذراً، هذا الموعد تم حجزه للتو من قِبل مرشح آخر. يرجى اختيار موعد آخر' });
  }

  // Free candidate's prior slot if rescheduling
  if (cand.slotId && cand.slotId !== slotId) {
    const oldSlot = db.slots.find(s => s.id === cand.slotId);
    if (oldSlot) {
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
    type: slot.type,
    locationOrLink: slot.locationOrLink
  };

  const comm = db.committees.find(c => c.id === cand.assignedCommitteeId);

  saveDB(db);

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

  const q = query.trim().toLowerCase();
  let list = db.candidates;

  if (committeeSlug && committeeSlug !== 'all') {
    const comm = db.committees.find(c => c.slug === committeeSlug || c.id === committeeSlug);
    if (comm) {
      list = list.filter(c => c.assignedCommitteeId === comm.id);
    }
  }

  const matches = list.filter(c => 
    c.arabicName.toLowerCase().includes(q) ||
    c.fullName.toLowerCase().includes(q) ||
    c.phone.includes(q)
  ).slice(0, 10).map(c => {
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
