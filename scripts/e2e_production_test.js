const fs = require('fs');

const PROD_URL = 'https://mfa-123.vercel.app';

async function runE2E() {
  console.log('================================================================');
  console.log('🚀 RUNNING COMPREHENSIVE PRODUCTION READINESS E2E SUITE');
  console.log(`🌐 TARGET: ${PROD_URL}`);
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond, name, details = '') {
    if (cond) {
      passed++;
      console.log(`  ✅ [PASS] ${name} ${details ? '(' + details + ')' : ''}`);
      return true;
    } else {
      failed++;
      console.error(`  ❌ [FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
      return false;
    }
  }

  // -------------------------------------------------------------
  // SUITE 1: Core Pages & Static Asset Availability
  // -------------------------------------------------------------
  console.log('▶️ SUITE 1: Core Pages & Static Asset Availability');
  const pages = [
    { path: '/login.html', minLen: 1000 },
    { path: '/dashboard.html', minLen: 50000 },
    { path: '/profile.html', minLen: 10000 },
    { path: '/book.html', minLen: 5000 },
    { path: '/quiz.html', minLen: 5000 },
    { path: '/verify.html', minLen: 2000 },
    { path: '/js/chart.umd.min.js', minLen: 10000 },
    { path: '/js/qrcode.min.js', minLen: 5000 },
    { path: '/js/xlsx.full.min.js', minLen: 100000 }
  ];

  for (const p of pages) {
    try {
      const res = await fetch(`${PROD_URL}${p.path}`);
      const text = await res.text();
      assert(res.status === 200 && text.length >= p.minLen, `Page: ${p.path}`, `HTTP ${res.status}, ${text.length} bytes`);
    } catch (e) {
      assert(false, `Page: ${p.path}`, `Error: ${e.message}`);
    }
  }

  // -------------------------------------------------------------
  // SUITE 2: Committees Roster & Candidate Structure
  // -------------------------------------------------------------
  console.log('\n▶️ SUITE 2: Committees Roster & Candidate Structure');
  try {
    const res = await fetch(`${PROD_URL}/api/committees`);
    const data = await res.json();
    assert(data.success === true, 'GET /api/committees success flag');
    assert(Array.isArray(data.committees) && data.committees.length >= 5, 'Committees loaded', `Count: ${data.committees?.length}`);

    // Public committee candidate roster
    const commSlug = 'economic';
    const cRes = await fetch(`${PROD_URL}/api/public/committee/${commSlug}`);
    const cData = await cRes.json();
    assert(cData.success === true, `GET /api/public/committee/${commSlug}`);
    assert(Array.isArray(cData.candidates) && cData.candidates.length > 0, `Candidates found in ${commSlug}`, `Count: ${cData.candidates?.length}`);

    // Structure members & Delegates
    const members = cData.candidates.filter(c => c.roleType === 'member');
    const delegates = cData.candidates.filter(c => c.roleType === 'delegate');
    assert(members.length > 0, 'Structure members identified in committee', `Found ${members.length}`);
    assert(delegates.length > 0, 'Delegates identified in committee', `Found ${delegates.length}`);
  } catch (e) {
    assert(false, 'SUITE 2 Error', e.message);
  }

  // -------------------------------------------------------------
  // SUITE 3: Delegate Profile & Real-time Calculations
  // -------------------------------------------------------------
  console.log('\n▶️ SUITE 3: Candidate & Delegate Profile Logic');
  let testDelegateId = 'c_23';
  try {
    const cRes = await fetch(`${PROD_URL}/api/public/committee/economic`);
    const cData = await cRes.json();
    const testDelegate = cData.candidates.find(c => c.roleType === 'delegate') || cData.candidates[0];
    testDelegateId = testDelegate.id;

    // Test both singular and plural endpoints
    const candPluralRes = await fetch(`${PROD_URL}/api/candidates/${testDelegateId}`);
    const candPluralData = await candPluralRes.json();
    assert(candPluralData.success === true, 'GET /api/candidates/:id');

    const candSingularRes = await fetch(`${PROD_URL}/api/candidate/${testDelegateId}`);
    const candSingularData = await candSingularRes.json();
    assert(candSingularData.success === true, 'GET /api/candidate/:id (singular alias)');

    // Test full delegate profile endpoint
    const profRes = await fetch(`${PROD_URL}/api/delegate/my-profile?id=${testDelegateId}`);
    const profData = await profRes.json();
    assert(profData.success === true, 'GET /api/delegate/my-profile?id=...');
    assert(profData.candidate && profData.candidate.diplomaticId, 'Candidate has Diplomatic ID', profData.candidate?.diplomaticId);
    assert(profData.candidate && profData.candidate.cpi && typeof profData.candidate.cpi.score === 'number', 'Continuous Performance Index (CPI) calculated', `Score: ${profData.candidate?.cpi?.score}`);
    assert(profData.candidate && profData.candidate.cpi?.standing, 'Candidate has diplomatic standing tier', profData.candidate?.cpi?.standing);
  } catch (e) {
    assert(false, 'SUITE 3 Error', e.message);
  }

  // -------------------------------------------------------------
  // SUITE 4: Operations Calendar & Multi-Sector Members
  // -------------------------------------------------------------
  console.log('\n▶️ SUITE 4: Operations Calendar & Multi-Sector Members');
  try {
    const calRes = await fetch(`${PROD_URL}/api/operations/calendar?committeeId=economic`);
    const calData = await calRes.json();
    assert(calData.success === true, 'GET /api/operations/calendar?committeeId=economic');
    assert(Array.isArray(calData.assignableMembers) && calData.assignableMembers.length > 0, 'Assignable structure members loaded', `Total: ${calData.assignableMembers.length}`);

    const academic = calData.assignableMembers.filter(m => m.subDepartment === 'academic');
    const hr = calData.assignableMembers.filter(m => m.subDepartment === 'hr');
    const media = calData.assignableMembers.filter(m => m.subDepartment === 'media');

    assert(academic.length > 0, 'Academic cadres available', `Count: ${academic.length}`);
    assert(hr.length > 0, 'HR / Organization cadres available', `Count: ${hr.length}`);
    assert(media.length > 0, 'Media cadres available', `Count: ${media.length}`);
  } catch (e) {
    assert(false, 'SUITE 4 Error', e.message);
  }

  // -------------------------------------------------------------
  // SUITE 5: Session Creation, Multi-Sector Quota & Task Assignment
  // -------------------------------------------------------------
  console.log('\n▶️ SUITE 5: Session Creation, Multi-Sector Quota & Task Assignment');
  let createdSessionId = null;
  let createdTaskIds = [];
  try {
    const calRes = await fetch(`${PROD_URL}/api/operations/calendar?committeeId=economic`);
    const calData = await calRes.json();
    const academicCadre = calData.assignableMembers.find(m => m.subDepartment === 'academic');
    const hrCadre = calData.assignableMembers.find(m => m.subDepartment === 'hr');

    const assignedIds = [academicCadre?.id, hrCadre?.id].filter(Boolean);

    const newSessPayload = {
      date: '2026-11-20',
      time: '15:30',
      title: 'جلسة محاكاة تجريبية: الدبلوماسية الاقتصادية E2E',
      location: 'قاعة المحاكاة الكبرى',
      committeeId: 'economic',
      description: 'جلسة تدريبية لاختبار دورة حياة التكليفات الميدانية بالكامل',
      cadresPlan: { academic: 1, hr: 1, media: 0 },
      cadresSource: 'internal',
      assignedMemberIds: assignedIds
    };

    const sessRes = await fetch(`${PROD_URL}/api/operations/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSessPayload)
    });
    const sessData = await sessRes.json();
    assert(sessData.success === true, 'POST /api/operations/sessions succeeds', sessData.message);
    assert(sessData.session && sessData.session.id, 'Session created with ID', sessData.session?.id);
    createdSessionId = sessData.session?.id;

    assert(sessData.createdTasksCount === assignedIds.length, `Tasks auto-created for assigned members`, `Created: ${sessData.createdTasksCount}`);

    // Verify tasks exist in calendar
    const calUpdated = await fetch(`${PROD_URL}/api/operations/calendar?committeeId=economic`).then(r => r.json());
    const sessionTasks = (calUpdated.tasks || []).filter(t => t.sessionId === createdSessionId);
    assert(sessionTasks.length === assignedIds.length, `Tasks linked to session in calendar`, `Found: ${sessionTasks.length}`);
    createdTaskIds = sessionTasks.map(t => t.id);

    // Verify task lands in member's profile
    if (academicCadre) {
      const memTasksRes = await fetch(`${PROD_URL}/api/members/${academicCadre.id}/tasks`);
      const memTasksData = await memTasksRes.json();
      assert(memTasksData.success === true, `GET /api/members/${academicCadre.id}/tasks`);
      const foundTask = (memTasksData.tasks || []).find(t => t.sessionId === createdSessionId);
      assert(!!foundTask, `Task successfully landed in member account: ${academicCadre.name}`, foundTask?.title);
      assert(foundTask?.status === 'pending', 'Initial task status is pending');
    }

    // Toggle task status (Mark Completed & Evaluate)
    if (createdTaskIds.length > 0) {
      const toggleRes = await fetch(`${PROD_URL}/api/operations/tasks/${createdTaskIds[0]}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      });
      const toggleData = await toggleRes.json();
      assert(toggleData.success === true, 'PUT /api/operations/tasks/:id/status toggles to completed');
      assert(toggleData.task && toggleData.task.status === 'completed', 'Task status is completed');
    }

  } catch (e) {
    assert(false, 'SUITE 5 Error', e.message);
  } finally {
    // Clean up created session
    if (createdSessionId) {
      try {
        const delRes = await fetch(`${PROD_URL}/api/operations/sessions/${createdSessionId}`, { method: 'DELETE' });
        const delData = await delRes.json();
        assert(delData.success === true, 'DELETE /api/operations/sessions/:id clean up test session');
      } catch (e) {
        console.error('Failed to clean up test session:', e.message);
      }
    }
  }

  // -------------------------------------------------------------
  // SUITE 6: Policy Paper Submission Flow
  // -------------------------------------------------------------
  console.log('\n▶️ SUITE 6: Policy Paper Submission Flow');
  try {
    const assignPayload = {
      candidateId: testDelegateId,
      assignmentTitle: 'ورقة موقف تجريبية: إصلاح النظام المالي العالمي',
      notes: 'تم تقديم التحليل الاقتصادي وفقاً لمعايير النموذج الدولي',
      link: 'https://mfa-123.vercel.app/demo-paper.pdf'
    };

    const subRes = await fetch(`${PROD_URL}/api/delegate/submit-assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assignPayload)
    });
    const subData = await subRes.json();
    assert(subData.success === true, 'POST /api/delegate/submit-assignment', subData.message);
    assert(subData.assignment && subData.assignment.title, 'Assignment recorded in database', subData.assignment?.title);

    // Verify candidate profile has the submission
    const prof = await fetch(`${PROD_URL}/api/delegate/my-profile?id=${testDelegateId}`).then(r => r.json());
    assert(prof.success === true, 'Candidate profile retrieved after submission');
  } catch (e) {
    assert(false, 'SUITE 6 Error', e.message);
  }

  // -------------------------------------------------------------
  // SUITE 7: Official Events & QR Pass Generation
  // -------------------------------------------------------------
  console.log('\n▶️ SUITE 7: Official Events & QR Pass Generation');
  try {
    const evRes = await fetch(`${PROD_URL}/api/events?candidateId=${testDelegateId}`);
    const evData = await evRes.json();
    assert(evData.success === true, 'GET /api/events');
    assert(Array.isArray(evData.events) && evData.events.length > 0, 'Active events available for booking', `Count: ${evData.events.length}`);

    const targetEvent = evData.events[0];
    assert(!!targetEvent, 'Target event identified', targetEvent?.title);

    // Book event via POST /api/events/:id/book
    const bookRes = await fetch(`${PROD_URL}/api/events/${targetEvent.id}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateId: testDelegateId
      })
    });
    const bookData = await bookRes.json();
    assert(bookData.success === true || (bookData.message && bookData.message.includes('بالفعل')), 'POST /api/events/:id/book', bookData.message);

    // Verify booked event appears with pass in events list
    const evAfterRes = await fetch(`${PROD_URL}/api/events?candidateId=${testDelegateId}`);
    const evAfterData = await evAfterRes.json();
    const bookedEvt = (evAfterData.events || []).find(e => e.id === targetEvent.id && e.myBooking && e.myBooking.status !== 'cancelled');
    assert(!!bookedEvt, 'Booked event reflects active booking for candidate', bookedEvt?.myBooking?.bookingCode);
    assert(bookedEvt?.myBooking?.qrPayload, 'Event booking generates digital QR pass payload');

    // Clean up / Cancel booking
    const cancelRes = await fetch(`${PROD_URL}/api/events/${targetEvent.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId: testDelegateId })
    });
    const cancelData = await cancelRes.json();
    assert(cancelData.success === true, 'POST /api/events/:id/cancel clean up booking');
  } catch (e) {
    assert(false, 'SUITE 7 Error', e.message);
  }

  // -------------------------------------------------------------
  // SUITE 8: Audit Trail & Governance Log
  // -------------------------------------------------------------
  console.log('\n▶️ SUITE 8: Audit Trail & Activity Governance');
  try {
    const auditRes = await fetch(`${PROD_URL}/api/audit-logs`);
    const auditData = await auditRes.json();
    assert(auditData.success === true, 'GET /api/audit-logs');
    assert(Array.isArray(auditData.logs) && auditData.logs.length > 0, 'Audit logs recorded', `Total logs: ${auditData.logs.length}`);
  } catch (e) {
    assert(false, 'SUITE 8 Error', e.message);
  }

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`🏁 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log(`🎯 PASS RATE: ${Math.round((passed / (passed + failed)) * 100)}%`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runE2E().catch(err => {
  console.error('Fatal E2E runner error:', err);
  process.exit(1);
});
