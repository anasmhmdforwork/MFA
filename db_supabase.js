const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'db.json');

// Helper to sanitize any database URL and encode special characters in password
function sanitizeConnectionString(connStr) {
  if (!connStr || typeof connStr !== 'string') return connStr;
  const trimmed = connStr.trim();
  const m = trimmed.match(/^(postgres(?:ql)?:\/\/)([^:]+):(.*)@([^:/]+)(?::(\d+))?\/([^?#]+)(.*)$/);
  if (!m) return trimmed;
  const [, protocol, user, rawPass, host, port, db, extra] = m;
  let plain = rawPass;
  try {
    plain = decodeURIComponent(rawPass);
  } catch (e) {
    plain = rawPass;
  }
  const safePass = encodeURIComponent(plain);
  const portPart = port ? `:${port}` : '';
  const extraPart = extra || '';
  return `${protocol}${user}:${safePass}@${host}${portPart}/${db}${extraPart}`;
}

const DEFAULT_URL = 'postgresql://postgres.bqxpkgzaxkyxvqvljvus:jU%26p%244u%23a%3FPK2.Y@aws-1-eu-central-1.pooler.supabase.com:5432/postgres';
const SUPABASE_URL = sanitizeConnectionString(process.env.DATABASE_URL) || DEFAULT_URL;

let pool = null;
let isConnected = false;
let memoryCache = null;
let lastCheckTime = 0;
let lastKnownUpdatedAt = null;
const CACHE_TTL_MS = 10000; // 10 seconds check window

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
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000
    });

    pool.on('error', (err) => {
      console.warn('Supabase Pool error (fallback active):', err.message);
      isConnected = false;
    });

    pool.connect((err, client, release) => {
      if (err) {
        console.warn('Could not connect to Supabase (using local db.json fallback):', err.message);
        isConnected = false;
      } else {
        isConnected = true;
        console.log('Connected to Supabase Cloud PostgreSQL successfully!');
        release();
        syncFromSupabase(true).catch(() => {});
      }
    });
  } catch (e) {
    console.warn('Supabase init error:', e.message);
    isConnected = false;
  }
}

// Smart lightweight sync: ONLY checks updated_at timestamp (28 bytes) instead of downloading 2MB
async function syncFromSupabase(force = false) {
  const now = Date.now();
  
  // 1. If within TTL window and we already have memoryCache, return immediately with ZERO network egress
  if (!force && memoryCache && (now - lastCheckTime < CACHE_TTL_MS)) {
    return memoryCache;
  }

  // Ensure local memory cache is populated from packaged db.json
  if (!memoryCache) {
    memoryCache = getLocalDB();
  }

  if (!pool) {
    initSupabase();
  }

  if (pool) {
    try {
      lastCheckTime = now;

      // 2. Query ONLY the updated_at timestamp (28 bytes!)
      const timeCheck = await pool.query("SELECT updated_at FROM mofa_interview_db WHERE id = 'main'");
      
      if (timeCheck.rows.length > 0) {
        isConnected = true;
        const dbUpdatedAt = timeCheck.rows[0].updated_at ? new Date(timeCheck.rows[0].updated_at).toISOString() : null;

        // 3. If timestamp has NOT changed and we already have memoryCache, DO NOT download data!
        if (!force && memoryCache && lastKnownUpdatedAt && dbUpdatedAt === lastKnownUpdatedAt) {
          return memoryCache;
        }

        // 4. Timestamp is newer or first load: download data
        const res = await pool.query("SELECT data, updated_at FROM mofa_interview_db WHERE id = 'main'");
        if (res.rows.length > 0 && res.rows[0].data) {
          memoryCache = res.rows[0].data;
          lastKnownUpdatedAt = res.rows[0].updated_at ? new Date(res.rows[0].updated_at).toISOString() : null;
          
          try {
            fs.writeFileSync(DB_FILE, JSON.stringify(memoryCache, null, 2), 'utf-8');
          } catch (e) {}
          
          return memoryCache;
        }
      }
    } catch (err) {
      console.error('Error syncing from Supabase (using fallback):', err.message);
      isConnected = false;
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
  const now = Date.now();
  lastCheckTime = now;

  // 1. Save locally to file atomically (if filesystem is writable)
  try {
    const tempFile = DB_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    // Read-only filesystem on Vercel serverless is normal and expected
  }

  // 2. Await Supabase PostgreSQL write and capture the new updated_at
  if (pool) {
    try {
      const res = await pool.query(
        "INSERT INTO mofa_interview_db (id, data, updated_at) VALUES ('main', $1, NOW()) ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW() RETURNING updated_at",
        [JSON.stringify(data)]
      );
      isConnected = true;
      if (res.rows.length > 0 && res.rows[0].updated_at) {
        lastKnownUpdatedAt = new Date(res.rows[0].updated_at).toISOString();
      }
    } catch (err) {
      console.error('Supabase write error:', err.message);
      isConnected = false;
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
  setConnected: (val) => { isConnected = val; },
  getPool: () => pool
};
