const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const SUPABASE_CONN_STR = process.env.DATABASE_URL || 'postgresql://postgres.jwzsfndgzblwkqmryvuu:jU%26p%244u%23a%3FPK2.Y@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';

const client = new Client({
  connectionString: SUPABASE_CONN_STR,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  console.log('Connecting to Supabase PostgreSQL...');
  await client.connect();
  console.log('Connected successfully!');

  // Read current clean db.json
  const dbPath = path.join(__dirname, '..', 'data', 'db.json');
  const raw = fs.readFileSync(dbPath, 'utf-8');
  const dbData = JSON.parse(raw);

  // 1. Update main document in mofa_interview_db
  console.log('Syncing clean main document to mofa_interview_db...');
  await client.query(
    'INSERT INTO mofa_interview_db (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()',
    ['main', JSON.stringify(dbData)]
  );
  console.log('✓ Pure production database document synced to Supabase!');

  // 2. Clear out any dummy candidates from mofa_candidates
  console.log('Cleaning mofa_candidates relational table...');
  await client.query('DELETE FROM mofa_candidates');

  // 3. Insert pure 438 candidates
  console.log(`Inserting ${dbData.candidates.length} pristine candidates from Excel sheet...`);
  for (const c of dbData.candidates) {
    await client.query(`
      INSERT INTO mofa_candidates (
        id, num, arabic_name, full_name, university, faculty, grade, phone, email,
        first_preference, assigned_committee_id, all_preferences, track_preference,
        english_level, booking_status, interview_status, rating, interview_notes,
        decision, slot_info, evaluation
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
    `, [
      c.id, c.num, c.arabicName, c.fullName, c.university, c.faculty, c.grade, c.phone, c.email,
      c.firstPreference, c.assignedCommitteeId, c.allPreferences, c.trackPreference,
      c.englishLevel, c.bookingStatus, c.interviewStatus,
      null, '', 'pending',
      JSON.stringify(c.slotInfo),
      JSON.stringify(c.evaluation)
    ]);
  }
  console.log(`✓ All ${dbData.candidates.length} pristine candidates seeded!`);

  // 4. Clean and reseed mofa_slots
  console.log('Cleaning mofa_slots relational table...');
  await client.query('DELETE FROM mofa_slots');
  console.log(`Inserting ${dbData.slots.length} pure available slots...`);
  for (const s of dbData.slots) {
    await client.query(`
      INSERT INTO mofa_slots (
        id, committee_id, date, day_name_ar, date_display, time_display,
        duration_minutes, type, location_or_link, status, candidate_id,
        candidate_name, candidate_phone, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `, [
      s.id, s.committeeId, s.date, s.dayNameAr, s.dateDisplay, s.timeDisplay,
      s.durationMinutes, s.type, s.locationOrLink, s.status, s.candidateId,
      s.candidateName, s.candidatePhone, s.notes
    ]);
  }
  console.log(`✓ All ${dbData.slots.length} available slots seeded!`);

  const candCount = await client.query('SELECT COUNT(*) FROM mofa_candidates');
  const slotCount = await client.query('SELECT COUNT(*) FROM mofa_slots');
  const availSlotCount = await client.query("SELECT COUNT(*) FROM mofa_slots WHERE status = 'available'");
  console.log('\n=======================================================');
  console.log(`Verification:`);
  console.log(`- Total Candidates in Supabase: ${candCount.rows[0].count}`);
  console.log(`- Total Slots in Supabase: ${slotCount.rows[0].count}`);
  console.log(`- Available Slots in Supabase: ${availSlotCount.rows[0].count}`);
  console.log('=======================================================');

  await client.end();
}

run().catch(err => {
  console.error('Sync error:', err);
  process.exit(1);
});
