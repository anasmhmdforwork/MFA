const fs = require('fs');
const path = require('path');
const dbSupabase = require('../db_supabase.js');

const COMM_CODE_MAP = {
  crises: 'CRS',
  economic: 'ECO',
  security: 'SEC',
  arab: 'ARB',
  climate: 'CLM',
  digital: 'DIG',
  palestine: 'PAL',
  american: 'USA',
  africa: 'AFR',
  general: 'GEN'
};

function getCommCode(commId) {
  if (!commId) return 'GEN';
  const clean = String(commId).toLowerCase().trim();
  return COMM_CODE_MAP[clean] || clean.slice(0, 3).toUpperCase();
}

function getDiplomaticId(cand, index) {
  const commId = cand.assignedCommitteeId || cand.originalCommitteeId || 'general';
  let commCode = getCommCode(commId);
  let roleCode = 'D';

  if (cand.roleType === 'member') {
    roleCode = 'M';
    const sub = String(cand.subDepartment || '').toLowerCase().trim();
    if (sub === 'hr' || sub === 'organization') commCode = 'ORG';
    else if (sub === 'media') commCode = 'MED';
    else if (sub === 'academic') commCode = 'ACD';
  } else if (cand.roleType === 'delegate') {
    roleCode = 'D';
  } else if (cand.roleType === 'head') {
    roleCode = 'H';
  } else if (cand.roleType === 'board') {
    roleCode = 'B';
  } else {
    roleCode = 'C';
  }

  const num = cand.num || (index + 1);
  const numPadded = String(num).padStart(3, '0');

  return `MFA-26-${commCode}-${roleCode}-${numPadded}`;
}

async function run() {
  console.log('Fetching database...');
  await dbSupabase.syncFromSupabase(true);
  const db = dbSupabase.getDB();

  if (!db || !db.candidates) {
    console.error('No candidates found in DB!');
    process.exit(1);
  }

  console.log(`Assigning Diplomatic IDs to ${db.candidates.length} candidates...`);
  db.candidates.forEach((cand, idx) => {
    cand.diplomaticId = getDiplomaticId(cand, idx);
  });

  // Ensure tables/arrays exist
  if (!db.operationsSessions) db.operationsSessions = [];
  if (!db.operationsTasks) db.operationsTasks = [];
  if (!db.auditLogs) db.auditLogs = [];
  if (!db.certificates) db.certificates = [];

  console.log('Sample Diplomatic IDs:');
  db.candidates.slice(0, 5).forEach(c => {
    console.log(`- ${c.fullName || c.arabicName} (${c.roleType || 'applicant'}): ${c.diplomaticId}`);
  });

  console.log('Saving to local and Supabase...');
  await dbSupabase.saveDB(db);
  console.log('Successfully saved Diplomatic IDs to all candidates!');
  process.exit(0);
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
