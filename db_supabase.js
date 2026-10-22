const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'db.json');
const SUPABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres.jwzsfndgzblwkqmryvuu:jU%26p%244u%23a%3FPK2.Y@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';

let pool = null;
let isConnected = false;
let memoryCache = null;

// Initialize Supabase Connection
function initSupabase() {
  try {
    pool = new Pool({
      connectionString: SUPABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    pool.connect((err, client, release) => {
      if (err) {
        console.warn('⚠️ Could not connect to Supabase (using local db.json fallback):', err.message);
        isConnected = false;
      } else {
        isConnected = true;
        console.log('⚡ Connected to Supabase Cloud PostgreSQL successfully!');
        release();
        syncFromSupabase();
      }
    });
  } catch (e) {
    console.warn('Supabase init error:', e.message);
    isConnected = false;
  }
}

// Initial Sync from Supabase into memory cache
async function syncFromSupabase() {
  if (!isConnected || !pool) return;
  try {
    const res = await pool.query("SELECT data FROM mofa_interview_db WHERE id = 'main'");
    if (res.rows.length > 0 && res.rows[0].data) {
      memoryCache = res.rows[0].data;
      // Also update local file
      fs.writeFileSync(DB_FILE, JSON.stringify(memoryCache, null, 2), 'utf-8');
      console.log('✓ Synced live database from Supabase cloud into local memory and disk.');
    }
  } catch (err) {
    console.error('Error syncing from Supabase:', err.message);
  }
}

// Read database
function getDB() {
  if (memoryCache) {
    return memoryCache;
  }

  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    memoryCache = JSON.parse(raw);
    return memoryCache;
  } catch (err) {
    console.error('Error reading db.json:', err);
    return null;
  }
}

// Save database
function saveDB(data) {
  memoryCache = data;

  // 1. Save locally to file atomically
  try {
    const tempFile = DB_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('Error saving local db.json:', err.message);
  }

  // 2. Sync to Supabase in background
  if (isConnected && pool) {
    pool.query(
      "INSERT INTO mofa_interview_db (id, data, updated_at) VALUES ('main', $1, NOW()) ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()",
      [JSON.stringify(data)]
    ).catch(err => {
      console.error('Background Supabase save error:', err.message);
    });
  }

  return true;
}

initSupabase();

module.exports = {
  getDB,
  saveDB,
  isConnected: () => isConnected,
  getPool: () => pool
};
