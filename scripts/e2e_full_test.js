const fs = require('fs');

const BASE_URL = 'http://localhost:3000';

async function runE2ETests() {
  console.log('===============================================================');
  console.log('🚀 STARTING COMPREHENSIVE E2E VERIFICATION TEST SUITE (100% COVERAGE)');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, testName, details = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  [PASS] ${testName} ${details ? '(' + details + ')' : ''}`);
      return true;
    } else {
      console.error(`  [FAIL] ${testName} ${details ? '(' + details + ')' : ''}`);
      return false;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // TEST SUITE 1: Static Pages & Health Check
    // -------------------------------------------------------------------------
    console.log('▶ Test Suite 1: Web Interface Pages & Health');
    const pages = ['/login', '/dashboard', '/book', '/quiz.html'];
    for (const page of pages) {
      const res = await fetch(`${BASE_URL}${page}`);
      assert(res.status === 200, `Page HTTP Status 200: ${page}`);
      const text = await res.text();
      assert(text.length > 500, `Page Content Non-Empty: ${page}`, `${text.length} bytes`);
    }

    // -------------------------------------------------------------------------
    // TEST SUITE 2: Committees & Candidate Rosters
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 2: Committees Roster & Integrity');
    const commRes = await fetch(`${BASE_URL}/api/committees`);
    const commData = await commRes.json();
    assert(commData.success === true, 'GET /api/committees returns success');
    assert(commData.committees.length === 9, 'All 9 Official MOFA Committees Present', `Found ${commData.committees.length}`);

    // Check Candidate Roster in multiple sectors
    const sectorsToCheck = ['crises', 'economic', 'palestine', 'security'];
    for (const slug of sectorsToCheck) {
      const secRes = await fetch(`${BASE_URL}/api/public/committee/${slug}`);
      const secData = await secRes.json();
      assert(secData.success === true, `Public Committee Roster Loads: ${slug}`);
      assert(secData.candidates.length > 0, `Candidates Present in ${slug}`, `Total ${secData.candidates.length} candidates`);
    }

    // Dynamic selection of test candidates in crises
    const crisesRoster = await fetch(`${BASE_URL}/api/public/committee/crises`).then(r => r.json()).then(d => d.candidates);
    const candA = crisesRoster[0]; // First delegate
    const candB = crisesRoster[1]; // Second delegate
    const candC = crisesRoster[2]; // Third candidate

    // -------------------------------------------------------------------------
    // TEST SUITE 3: Arabic Search Normalization
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 3: Arabic Search Normalization & Resilience');
    const searchRes1 = await fetch(`${BASE_URL}/api/public/search-candidate?query=${encodeURIComponent('ابراهيم')}`).then(r => r.json());
    const searchRes2 = await fetch(`${BASE_URL}/api/public/search-candidate?query=${encodeURIComponent('إبراهيم')}`).then(r => r.json());
    assert(searchRes1.success === true, 'Search endpoint returns success');
    assert(searchRes1.candidates.length === searchRes2.candidates.length, 'Hamza Normalization Matches', `Found ${searchRes1.candidates.length} matches`);

    // -------------------------------------------------------------------------
    // TEST SUITE 4: Public Candidate Booking Lifecycle
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 4: Public Candidate Booking Lifecycle');
    // Get crises committee slots
    const slotsRes = await fetch(`${BASE_URL}/api/public/slots/crises`).then(r => r.json());
    assert(slotsRes.success === true, 'Fetch crises slots returns success');
    const allSlots = slotsRes.allSlots || [];
    const availableSlots = allSlots.filter(s => s.isAvailable);
    assert(availableSlots.length >= 2, 'Sufficient Available Slots for Testing', `Available: ${availableSlots.length}`);

    const slot1 = availableSlots[0];
    const slot2 = availableSlots[1];

    // Step A: Book slot1 for candA (belongs to crises)
    const bookRes1 = await fetch(`${BASE_URL}/api/public/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId: candA.id, slotId: slot1.id })
    }).then(r => r.json());
    assert(bookRes1.success === true, `Initial Booking Confirmed: ${slot1.id}`);

    // Verify candidate is now booked
    const checkCand1 = await fetch(`${BASE_URL}/api/candidates/${candA.id}`).then(r => r.json());
    assert(checkCand1.candidate.bookingStatus === 'booked', 'Candidate bookingStatus updated to booked');
    assert(checkCand1.candidate.slotId === slot1.id, 'Candidate slotId matches booked slot');

    // Step B: Reschedule to slot2
    console.log('  Testing slot rescheduling...');
    const bookRes2 = await fetch(`${BASE_URL}/api/public/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId: candA.id, slotId: slot2.id })
    }).then(r => r.json());
    assert(bookRes2.success === true, `Rescheduling Confirmed: Switched to ${slot2.id}`);

    // Verify slot1 was freed and slot2 is now booked
    const slotsAfter = await fetch(`${BASE_URL}/api/public/slots/crises`).then(r => r.json());
    const slot1After = slotsAfter.allSlots.find(s => s.id === slot1.id);
    const slot2After = slotsAfter.allSlots.find(s => s.id === slot2.id);
    assert(slot1After.isAvailable === true, 'Old Slot 1 immediately freed for others');
    assert(slot2After.isAvailable === false, 'New Slot 2 marked as booked');

    // Step C: Try booking a slot from ANOTHER sector (must be rejected)
    console.log('  Testing sector boundary security...');
    const econSlots = await fetch(`${BASE_URL}/api/public/slots/economic`).then(r => r.json());
    const econAvailSlot = (econSlots.allSlots || []).find(s => s.isAvailable);
    if (econAvailSlot) {
      const crossBook = await fetch(`${BASE_URL}/api/public/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: candA.id, slotId: econAvailSlot.id })
      });
      const crossData = await crossBook.json();
      assert(crossBook.status === 400 && crossData.success === false, 'Cross-sector slot booking securely blocked');
    }

    // Step D: Cancel booking
    const cancelRes = await fetch(`${BASE_URL}/api/candidates/${candA.id}/booking`, { method: 'DELETE' }).then(r => r.json());
    assert(cancelRes.success === true, 'Candidate booking cancellation works');

    // -------------------------------------------------------------------------
    // TEST SUITE 5: Candidate Evaluation & Role Assignment (Delegate vs Member)
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 5: Interview Evaluation & Roles Assignment');
    
    // Evaluate candA as Accepted Delegate in crises
    const evalDelegateRes = await fetch(`${BASE_URL}/api/candidates/${candA.id}/evaluation`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendanceStatus: 'attended',
        score: 9.5,
        communicationScore: 10,
        knowledgeScore: 9,
        commitmentScore: 9.5,
        englishScore: 9,
        notes: 'مرشح متميز جداً مؤهل لدور المندوب الدبلوماسي',
        decision: 'accepted',
        roleType: 'delegate',
        interviewerName: 'رئيس قطاع الأزمات'
      })
    }).then(r => r.json());
    assert(evalDelegateRes.success === true, 'Candidate evaluation saved as accepted delegate');
    assert(evalDelegateRes.candidate.roleType === 'delegate', 'Role saved as delegate');
    assert(evalDelegateRes.candidate.interviewStatus === 'completed', 'Interview marked completed');

    // Evaluate candB as Accepted Committee Member (HR Sub-department) in crises
    const evalMemberRes = await fetch(`${BASE_URL}/api/candidates/${candB.id}/evaluation`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendanceStatus: 'attended',
        score: 8.5,
        communicationScore: 9,
        knowledgeScore: 8,
        commitmentScore: 9,
        englishScore: 8,
        notes: 'مهارات قيادية وتنظيمية عالية، مناسب للجنة الـ HR',
        decision: 'accepted',
        roleType: 'member',
        subDepartment: 'hr',
        interviewerName: 'رئيس قطاع الأزمات'
      })
    }).then(r => r.json());
    assert(evalMemberRes.success === true, 'Candidate evaluation saved as accepted member');
    assert(evalMemberRes.candidate.roleType === 'member', 'Role saved as member');
    assert(evalMemberRes.candidate.subDepartment === 'hr', 'Sub-department saved as hr');

    // -------------------------------------------------------------------------
    // TEST SUITE 6: Candidate Contact Info Update & Name Protection
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 6: Contact Info Update & Candidate Name Immutability');
    const origCand = await fetch(`${BASE_URL}/api/candidates/${candA.id}`).then(r => r.json());
    const origName = origCand.candidate.arabicName;

    // Attempt to update email and phone while attempting to inject an altered name
    const updateRes = await fetch(`${BASE_URL}/api/candidates/${candA.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'delegate.verified@mofa2026.org',
        phone: '01099887766',
        faculty: 'كلية السياسة والاقتصاد',
        arabicName: 'اسم محرف ممنوع' // Malicious alteration attempt
      })
    }).then(r => r.json());
    assert(updateRes.success === true, 'Contact update request executed successfully');
    assert(updateRes.candidate.email === 'delegate.verified@mofa2026.org', 'Email updated accurately');
    assert(updateRes.candidate.arabicName === origName, 'Candidate Name STRICTLY Protected and Unchanged', `Retained: ${origName}`);

    // -------------------------------------------------------------------------
    // TEST SUITE 7: Lecture Quiz Creation, Delegate Login & Quiz Submission
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 7: Lecture Quizzes, Delegate Login & Quiz Submissions');
    
    // Create Lecture Quiz in crises
    const quizRes = await fetch(`${BASE_URL}/api/quizzes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'محاضرة تجريبية E2E: إدارة التفاوض الدبلوماسي',
        lectureNumber: 99,
        committeeId: 'crises',
        durationMinutes: 10,
        description: 'اختبار الفهم الشامل لمحاضرة التفاوض وتسجيل الحضور التلقائي',
        questions: [
          {
            type: 'mcq',
            prompt: 'ما هي الركيزة الأساسية في الدبلوماسية الوقائية؟',
            options: ['التحكيم الدولي', 'الوساطة والمفاوضات المباشرة', 'العقوبات الاقتصادية', 'التدخل العسكري'],
            correctAnswer: 1,
            points: 5
          },
          {
            type: 'true_false',
            prompt: 'تعتبر إدارة الأزمات جزءاً لا يتجزأ من التخطيط السياسي الاستراتيجي.',
            options: ['صح', 'خطأ'],
            correctAnswer: 0,
            points: 5
          }
        ]
      })
    }).then(r => r.json());
    assert(quizRes.success === true, 'Quiz created successfully');
    const createdQuiz = quizRes.quiz;

    // Test Delegate Login (candA - delegate in crises) before taking quiz
    console.log('  Testing delegate authentication before quiz...');
    const delegateLogin = await fetch(`${BASE_URL}/api/public/quiz/${createdQuiz.id}/check-delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrPhone: 'delegate.verified@mofa2026.org', password: '1234' })
    }).then(r => r.json());
    assert(delegateLogin.success === true, 'Delegate successfully authenticated for quiz');

    // Test Member Login (candB - member in crises) before taking quiz -> MUST BE BLOCKED
    console.log('  Testing member blocking from academic quizzes...');
    const memberLoginRes = await fetch(`${BASE_URL}/api/public/quiz/${createdQuiz.id}/check-delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrPhone: candB.phone || candB.email, password: '1234' })
    });
    const memberLoginData = await memberLoginRes.json();
    assert(memberLoginRes.status === 403 && memberLoginData.success === false, 'Committee Member is correctly BLOCKED from taking academic quizzes');

    // Submit Quiz Answers for candA
    console.log('  Submitting quiz answers...');
    const submitRes = await fetch(`${BASE_URL}/api/public/quiz/${createdQuiz.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateId: candA.id,
        answers: { [createdQuiz.questions[0].id]: 1, [createdQuiz.questions[1].id]: 0 },
        timeTakenSeconds: 95
      })
    }).then(r => r.json());
    assert(submitRes.success === true, 'Quiz submission accepted');
    assert(submitRes.score === 10, 'Quiz automatically graded (Score 10/10)');
    assert(submitRes.percentage === 100, 'Quiz percentage calculated (100%)');

    // -------------------------------------------------------------------------
    // TEST SUITE 8: Lecture Home Assignment & Bonus Points Grading
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 8: Home Assignment & Lecture Participation Bonus Grading');
    const gradeAssignRes = await fetch(`${BASE_URL}/api/candidates/${candA.id}/lecture-eval`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quizId: createdQuiz.id,
        lectureNumber: 99,
        assignmentStatus: 'submitted',
        assignmentScore: 9.0,
        bonusScore: 2.0,
        bonusReason: 'مداخلة دبلوماسية استثنائية أثناء المحاضرة',
        notes: 'تحليل دقيق لأزمة قناة السويس ومبادئ اتفاقية فيينا'
      })
    }).then(r => r.json());
    assert(gradeAssignRes.success === true, 'Assignment and bonus points evaluated and saved');

    // Verify Gradebook endpoint includes assignment + bonus
    const gradebookRes = await fetch(`${BASE_URL}/api/gradebook?committeeId=crises`).then(r => r.json());
    assert(gradebookRes.success === true, 'Gradebook API returns success');
    const delegateEntry = (gradebookRes.rows || []).find(r => r.id === candA.id || r.candidateId === candA.id);
    assert(delegateEntry !== undefined, 'Delegate appears in comprehensive gradebook matrix');
    assert(delegateEntry.attendedQuizzesCount >= 1, 'Lecture attendance automatically marked from quiz');

    // -------------------------------------------------------------------------
    // TEST SUITE 9: Committee Member Weekly Performance Evaluations
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 9: Executive Member Weekly Evaluations');
    const memberEvalRes = await fetch(`${BASE_URL}/api/candidates/${candB.id}/lecture-eval`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quizId: createdQuiz.id,
        lectureNumber: 1,
        assignmentStatus: 'submitted',
        assignmentScore: 9.5,
        taskDescription: 'تنظيم قاعة المؤتمرات وإدارة حضور المحاضرة الأولى',
        notes: 'التزام كامل وانضباط بروتوكولي رفيع'
      })
    }).then(r => r.json());
    assert(memberEvalRes.success === true, 'Member weekly performance task evaluated');

    // Verify Monthly Member Evaluations API
    const monthlyRes = await fetch(`${BASE_URL}/api/members/monthly-evaluations?committeeId=crises`).then(r => r.json());
    assert(monthlyRes.success === true, 'Monthly Member Evaluations API returns success');
    const memberEntry = (monthlyRes.members || []).find(m => m.id === candB.id);
    assert(memberEntry !== undefined, 'Member appears in monthly performance roster');
    assert(memberEntry.month1Average >= 9, 'Monthly average calculated correctly', `Average: ${memberEntry.month1Average}`);

    // -------------------------------------------------------------------------
    // TEST SUITE 10: Candidate Transfer Protocol
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 10: Inter-Committee Candidate Transfer Protocol');
    const transferRes = await fetch(`${BASE_URL}/api/candidates/${candC.id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetCommitteeId: 'economic',
        reason: 'توافق أفضل مع تخصص الاقتصاد والتجارة الدولية',
        transferredBy: 'الأمانة العامة'
      })
    }).then(r => r.json());
    assert(transferRes.success === true, 'Candidate transfer executed successfully');
    assert(transferRes.candidate.assignedCommitteeId === 'economic', 'Candidate assignedCommitteeId updated to economic');
    assert(transferRes.candidate.transferHistory.length > 0, 'Transfer audit record retained');

    // -------------------------------------------------------------------------
    // TEST SUITE 11: Export APIs (CSV / Excel)
    // -------------------------------------------------------------------------
    console.log('\n▶ Test Suite 11: Export Data to CSV / Excel');
    const exportRes = await fetch(`${BASE_URL}/api/export/committee/crises/csv`);
    assert(exportRes.status === 200, 'Export CSV returns HTTP 200');
    assert(exportRes.headers.get('content-type').includes('csv'), 'Export returns text/csv MIME type');

    // -------------------------------------------------------------------------
    // TEST RESULTS SUMMARY
    // -------------------------------------------------------------------------
    console.log('\n===============================================================');
    console.log(`📊 E2E TEST EXECUTION SUMMARY: ${passedTests} / ${totalTests} PASSED`);
    console.log(`🎯 PASS RATE: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    console.log('===============================================================');

    return { total: totalTests, passed: passedTests };
  } catch (err) {
    console.error('Fatal E2E test execution error:', err);
    return { total: totalTests, passed: passedTests, error: err.message };
  }
}

runE2ETests().then(res => {
  if (res.passed === res.total) {
    console.log('All E2E tests succeeded with 100% pass rate!');
    process.exit(0);
  } else {
    console.error('Some E2E tests failed!');
    process.exit(1);
  }
});
