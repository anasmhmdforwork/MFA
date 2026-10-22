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

  // 1. Create JSON state table for seamless high-performance sync
  await client.query(`
    CREATE TABLE IF NOT EXISTS mofa_interview_db (
      id VARCHAR(50) PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  console.log('✓ Table mofa_interview_db ready.');

  // 2. Also create structured normalized relational tables for easy viewing in Supabase Table Editor!
  await client.query(`
    CREATE TABLE IF NOT EXISTS mofa_candidates (
      id VARCHAR(50) PRIMARY KEY,
      num INT,
      arabic_name TEXT,
      full_name TEXT,
      university TEXT,
      faculty TEXT,
      grade TEXT,
      phone TEXT,
      email TEXT,
      first_preference TEXT,
      assigned_committee_id TEXT,
      all_preferences TEXT,
      track_preference TEXT,
      english_level TEXT,
      booking_status TEXT,
      interview_status TEXT,
      rating NUMERIC,
      interview_notes TEXT,
      decision TEXT,
      slot_info JSONB,
      evaluation JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mofa_slots (
      id VARCHAR(100) PRIMARY KEY,
      committee_id TEXT,
      date TEXT,
      day_name_ar TEXT,
      date_display TEXT,
      time_display TEXT,
      duration_minutes INT,
      type TEXT,
      location_or_link TEXT,
      status TEXT,
      candidate_id TEXT,
      candidate_name TEXT,
      candidate_phone TEXT,
      notes TEXT
    );
  `);
  console.log('✓ Normalized tables mofa_candidates and mofa_slots ready for Supabase Studio.');

  // 3. Read current db.json
  const dbPath = path.join(__dirname, '..', 'data', 'db.json');
  const raw = fs.readFileSync(dbPath, 'utf-8');
  const dbData = JSON.parse(raw);

  // 4. Seed mofa_interview_db
  await client.query(
    'INSERT INTO mofa_interview_db (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()',
    ['main', JSON.stringify(dbData)]
  );
  console.log('✓ Seeded main database document into Supabase!');

  // 5. Seed normalized candidates table
  console.log(`Seeding ${dbData.candidates.length} candidates into mofa_candidates table...`);
  for (const c of dbData.candidates) {
    await client.query(`
      INSERT INTO mofa_candidates (
        id, num, arabic_name, full_name, university, faculty, grade, phone, email,
        first_preference, assigned_committee_id, all_preferences, track_preference,
        english_level, booking_status, interview_status, rating, interview_notes,
        decision, slot_info, evaluation
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (id) DO UPDATE SET
        arabic_name = $3,
        assigned_committee_id = $11,
        booking_status = $15,
        interview_status = $16,
        rating = $17,
        interview_notes = $18,
        decision = $19,
        slot_info = $20,
        evaluation = $21;
    `, [
      c.id, c.num, c.arabicName, c.fullName, c.university, c.faculty, c.grade, c.phone, c.email,
      c.firstPreference, c.assignedCommitteeId, c.allPreferences, c.trackPreference,
      c.englishLevel, c.bookingStatus, c.interviewStatus,
      c.evaluation ? c.evaluation.score : null,
      c.evaluation ? c.evaluation.notes : '',
      c.evaluation ? c.evaluation.decision : 'pending',
      JSON.stringify(c.slotInfo),
      JSON.stringify(c.evaluation)
    ]);
  }
  console.log('✓ All 438 candidates successfully synced to Supabase mofa_candidates table!');

  // 6. Seed slots table
  console.log(`Seeding ${dbData.slots.length} slots into mofa_slots table...`);
  for (const s of dbData.slots) {
    await client.query(`
      INSERT INTO mofa_slots (
        id, committee_id, date, day_name_ar, date_display, time_display,
        duration_minutes, type, location_or_link, status, candidate_id,
        candidate_name, candidate_phone, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (id) DO UPDATE SET
        status = $10,
        candidate_id = $11,
        candidate_name = $12,
        candidate_phone = $13;
    `, [
      s.id, s.committeeId, s.date, s.dayNameAr, s.dateDisplay, s.timeDisplay,
      s.durationMinutes, s.type, s.locationOrLink, s.status, s.candidateId,
      s.candidateName, s.candidatePhone, s.notes
    ]);
  }
  console.log('✓ All slots successfully synced to Supabase mofa_slots table!');

  const check = await client.query('SELECT COUNT(*) FROM mofa_candidates');
  console.log(`Verification: Total candidates in Supabase = ${check.rows[0].count}`);

  await client.end();
  console.log('=======================================================');
  console.log('  تهانينا! تم ربط وتهيئة قاعدة بيانات Supabase بنجاح!');
  console.log('=======================================================');
}

run().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
