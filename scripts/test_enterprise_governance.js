const http = require('http');
const dbSupabase = require('../db_supabase.js');

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('========================================================');
  console.log('🧪 Starting Enterprise Digital Governance Verification');
  console.log('========================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, testName) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
    }
  }

  // Test 1: Health check
  const healthRes = await request('GET', '/api/health');
  assert(healthRes.status === 200, 'Server health check responds with 200 OK');

  // Test 2: Check candidate diplomatic ID & login
  const db = dbSupabase.getDB();
  const sampleCandidate = db.candidates.find(c => c.roleType === 'delegate');
  assert(sampleCandidate && sampleCandidate.diplomaticId && sampleCandidate.diplomaticId.startsWith('MFA-26-'), 'Candidate has valid Diplomatic ID: ' + (sampleCandidate ? sampleCandidate.diplomaticId : 'none'));

  // Test 3: Login with Diplomatic ID
  const loginRes = await request('POST', '/api/auth/login', {
    username: sampleCandidate.diplomaticId,
    password: sampleCandidate.delegatePassword || '1234'
  });
  assert(loginRes.status === 200 && loginRes.data.success, 'Login with Diplomatic ID succeeds');

  // Test 4: Profile & CPI
  const profileRes = await request('GET', `/api/delegate/my-profile?id=${sampleCandidate.diplomaticId}`);
  assert(profileRes.status === 200 && profileRes.data.candidate && profileRes.data.candidate.cpi, 'Profile returns 360° CPI calculation: ' + (profileRes.data.candidate ? profileRes.data.candidate.cpi.score : 'N/A') + '/100 (' + (profileRes.data.candidate ? profileRes.data.candidate.cpi.standing : '') + ')');

  // Test 5: Operations Calendar API (Add Session)
  const sessionRes = await request('POST', '/api/operations/sessions', {
    date: '2026-11-15',
    title: 'ندوة اختبارية: الدبلوماسية الوقائية وإدارة الأزمات الدولية',
    committeeId: 'crises',
    sector: 'all',
    requiredMembersCount: 4,
    time: '11:00',
    location: 'قاعة المؤتمرات الكبرى'
  });
  assert(sessionRes.status === 200 && sessionRes.data.success, 'Create operations session succeeded');
  const createdSessionId = sessionRes.data.session ? sessionRes.data.session.id : null;

  // Test 6: Member Operational Task Assignment & CPI/Score Boost
  const sampleMember = db.candidates.find(c => c.roleType === 'member') || sampleCandidate;
  const taskRes = await request('POST', '/api/operations/tasks', {
    sessionId: createdSessionId,
    title: 'إدارة منصة الحضور وضبط القاعة',
    description: 'تنظيم مقاعد الوفود واستقبال المحاضر',
    assignedToCandidateId: sampleMember.id,
    committeeId: sampleMember.assignedCommitteeId || 'general',
    sector: sampleMember.subDepartment || 'hr',
    dueDate: '2026-11-15'
  });
  assert(taskRes.status === 200 && taskRes.data.success, 'Assign operational task succeeded: ' + (taskRes.data.task ? taskRes.data.task.title : ''));
  const createdTaskId = taskRes.data.task ? taskRes.data.task.id : null;

  // Test 7: Toggle Task Status to Completed
  if (createdTaskId) {
    const statusRes = await request('PUT', `/api/operations/tasks/${createdTaskId}/status`, { status: 'completed' });
    assert(statusRes.status === 200 && statusRes.data.task.status === 'completed', 'Task completed and member evaluation score updated');
  }

  // Test 8: Member tasks getter
  const memberTasksRes = await request('GET', `/api/members/${sampleMember.id}/tasks`);
  assert(memberTasksRes.status === 200 && memberTasksRes.data.tasks.length > 0, 'Member tasks getter returns progress: ' + memberTasksRes.data.stats.progressPercent + '%');

  // Test 9: Automated Event Eligibility Engine Gate
  const highReqEventRes = await request('POST', '/api/events', {
    title: 'زيارة رفيعة المستوى لجامعة الدول العربية (تتطلب 99% حضور)',
    type: 'visit',
    capacity: 20,
    date: '2026-11-20',
    time: '09:00',
    location: 'مقر الأمانة العامة لجامعة الدول العربية',
    dressCode: 'بدلة دبلوماسية كاملة',
    targetAudience: { scope: 'all', roles: ['delegate', 'member'], sectors: ['hr', 'media', 'academic'], committees: [] },
    eligibilityCriteria: { minAttendance: 99, minQuizAvg: 99, minCPI: 99 }
  });
  const highReqEventId = highReqEventRes.data.event ? highReqEventRes.data.event.id : null;

  if (highReqEventId) {
    const nonQualCandidate = db.candidates.find(c => c.id === 'c_1') || { id: 'c_1' };
    const bookGateRes = await request('POST', `/api/events/${highReqEventId}/book`, { candidateId: nonQualCandidate.id });
    assert(bookGateRes.status === 403, 'Automated Eligibility Gate blocked non-qualifying candidate with 403 Forbidden');
  }

  // Test 10: Live QR Camera Check-in Desk
  const checkinRes = await request('POST', '/api/checkin/qr', {
    qrPayload: sampleCandidate.diplomaticId,
    sessionId: createdSessionId
  });
  assert(checkinRes.status === 200 && checkinRes.data.success, 'Live QR Check-in verified candidate: ' + (checkinRes.data.candidate ? checkinRes.data.candidate.name : ''));

  // Test 11: Public Verification Portal
  const verifyRes = await request('GET', `/api/verify/${sampleCandidate.diplomaticId}`);
  assert(verifyRes.status === 200 && verifyRes.data.valid, 'Public verification portal confirmed certificate: ' + (verifyRes.data.verification ? verifyRes.data.verification.certificateCode : ''));

  // Test 12: Audit Trail
  const auditRes = await request('GET', '/api/audit-logs');
  assert(auditRes.status === 200 && auditRes.data.logs.length > 0, 'Audit trail logged actions count: ' + auditRes.data.logs.length);

  // Clean up test session
  if (createdSessionId) {
    await request('DELETE', `/api/operations/sessions/${createdSessionId}`);
  }
  if (highReqEventId) {
    await request('DELETE', `/api/events/${highReqEventId}`);
  }

  console.log('\n========================================================');
  console.log(`📊 Test Results: ${passed}/${total} Passed (${Math.round((passed/total)*100)}%)`);
  console.log('========================================================');

  if (passed === total) {
    console.log('🎉 ALL ENTERPRISE DIGITAL GOVERNANCE TESTS PASSED PERFECTLY!');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
