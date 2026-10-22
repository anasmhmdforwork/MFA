const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'db.json');
const SUPABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres.jwzsfndgzblwkqmryvuu:jU%26p%244u%23a%3FPK2.Y@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';

let pool = null;
let isConnected = false;
let memoryCache = null;
let lastSyncTime = 0;

// Read local JSON file fallback
function getLocalDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading local db.json:', err.message);
    return null;
  }
}

// Initialize Supabase Connection
function initSupabase() {
  if (pool) return;
  try {
    pool = new Pool({
      connectionString: SUPABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    pool.on('error', (err) => {
      console.warn('Supabase Pool error (fallback active):', err.message);
      isConnected = false;
    });

    pool.connect((err, client, release) => {
      if (err) {
        console.warn('⚠️ Could not connect to Supabase (using local db.json fallback):', err.message);
        isConnected = false;
      } else {
        isConnected = true;
        console.log('⚡ Connected to Supabase Cloud PostgreSQL successfully!');
        release();
        syncFromSupabase(true);
      }
    });
  } catch (e) {
    console.warn('Supabase init error:', e.message);
    isConnected = false;
  }
}

// Sync from Supabase into memory cache
async function syncFromSupabase(force = false) {
  const now = Date.now();
  if (!force && memoryCache && (now - lastSyncTime < 3000)) {
    return memoryCache;
  }

  if (!pool) {
    initSupabase();
  }

  if (pool) {
    try {
      const res = await pool.query("SELECT data FROM mofa_interview_db WHERE id = 'main'");
      if (res.rows.length > 0 && res.rows[0].data) {
        memoryCache = res.rows[0].data;
        lastSyncTime = now;
        // Try writing local file (will be ignored if read-only on Vercel)
        try {
          fs.writeFileSync(DB_FILE, JSON.stringify(memoryCache, null, 2), 'utf-8');
        } catch (e) {}
        return memoryCache;
      }
    } catch (err) {
      console.error('Error syncing from Supabase:', err.message);
    }
  }

  if (!memoryCache) {
    memoryCache = getLocalDB();
  }
  return memoryCache;
}

// Synchronous getDB (uses memoryCache or local file)
function getDB() {
  if (memoryCache) {
    return memoryCache;
  }
  memoryCache = getLocalDB();
  return memoryCache;
}

// Save database (atomic local + awaited Supabase)
async function saveDB(data) {
  memoryCache = data;
  lastSyncTime = Date.now();

  // 1. Save locally to file atomically (if filesystem is writable)
  try {
    const tempFile = DB_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    // Read-only filesystem on Vercel serverless is normal and expected
  }

  // 2. Await Supabase PostgreSQL write so Vercel does not terminate container early
  if (pool) {
    try {
      await pool.query(
        "INSERT INTO mofa_interview_db (id, data, updated_at) VALUES ('main', $1, NOW()) ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()",
        [JSON.stringify(data)]
      );
    } catch (err) {
      console.error('Supabase write error:', err.message);
    }
  }

  return true;
}

initSupabase();

module.exports = {
  getDB,
  saveDB,
  syncFromSupabase,
  isConnected: () => isConnected,
  getPool: () => pool
};
