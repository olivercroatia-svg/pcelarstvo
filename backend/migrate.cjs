/**
 * Versioned MySQL migration runner (CommonJS — `.cjs` so it runs in ESM and CJS backends alike).
 *
 * What it does:
 *   - Ensures a `schema_migrations` tracking table exists.
 *   - Applies every migrations/*.sql file ONCE, in filename order.
 *   - Re-running applies only NEW files → safe to run on every deploy.
 *
 * Why versioned (not "CREATE TABLE IF NOT EXISTS" on startup):
 *   IF NOT EXISTS never alters an existing table and never backfills data. Versioned migrations
 *   let you create tables, ALTER existing ones (add columns/indexes), and migrate data — each
 *   step recorded so it runs exactly once.
 *
 * Run from the project root (or backend/):   node backend/migrate.cjs
 * Reads DB config from DB_* vars or DATABASE_URL (same precedence as db.js).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

// Load .env from the most likely spots (cwd, this dir, parent dir). dotenv does not override
// already-set vars, so layering is safe. In Docker the vars come from compose (no .env file).
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function parseDbUrl(url) {
  if (!url || !url.startsWith('mysql://')) return null;
  const rest = url.slice('mysql://'.length);
  const at = rest.lastIndexOf('@');
  if (at === -1) return null;
  const creds = rest.slice(0, at);
  const hostPart = rest.slice(at + 1);
  const colon = creds.indexOf(':');
  const user = colon === -1 ? creds : creds.slice(0, colon);
  const password = colon === -1 ? '' : creds.slice(colon + 1);
  const slash = hostPart.indexOf('/');
  if (slash === -1) return null;
  const hostPort = hostPart.slice(0, slash);
  const database = hostPart.slice(slash + 1);
  const pc = hostPort.indexOf(':');
  const host = pc === -1 ? hostPort : hostPort.slice(0, pc);
  const port = pc === -1 ? 3306 : parseInt(hostPort.slice(pc + 1), 10);
  return { host, port, user: decodeURIComponent(user), password: decodeURIComponent(password), database };
}

function buildConnConfig() {
  const base = { multipleStatements: true, charset: 'utf8mb4' };
  if (process.env.DB_HOST || process.env.DB_NAME || process.env.DB_USER) {
    return {
      ...base,
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    };
  }
  if (process.env.DATABASE_URL) {
    const cfg = parseDbUrl(process.env.DATABASE_URL);
    return cfg ? { ...base, ...cfg } : { ...base, uri: process.env.DATABASE_URL };
  }
  return null;
}

function resolveMigrationsDir() {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(process.cwd(), 'backend/migrations'),
    path.resolve(__dirname, '../migrations'),
    path.resolve(__dirname, 'migrations')
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

async function main() {
  const config = buildConnConfig();
  if (!config) {
    console.error('[migrate] No DB config. Set DB_* vars or DATABASE_URL.');
    process.exit(1);
  }
  const dir = resolveMigrationsDir();
  const conn = await mysql.createConnection(config);

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        checksum   CHAR(64)     NOT NULL,
        applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [rows] = await conn.query('SELECT filename, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    if (!fs.existsSync(dir)) {
      console.log(`[migrate] No migrations folder at ${dir}. Nothing to do.`);
      return;
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

    let count = 0;
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      if (applied.has(file)) {
        if (applied.get(file) !== checksum) {
          console.warn(
            `[migrate] WARNING: ${file} changed after it was applied (checksum mismatch). ` +
              `Not re-running it. To change schema, add a NEW migration file.`
          );
        }
        continue;
      }

      if (!sql.trim()) {
        await conn.query('INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)', [file, checksum]);
        continue;
      }

      console.log(`[migrate] Applying: ${file}`);
      await conn.beginTransaction();
      try {
        await conn.query(sql); // multipleStatements:true → runs the whole file
        await conn.query('INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)', [file, checksum]);
        await conn.commit();
        count++;
      } catch (err) {
        await conn.rollback();
        // NOTE: MySQL DDL (CREATE/ALTER) auto-commits and cannot be rolled back. Keep one logical
        // change per migration file and/or write idempotent DDL so a partial failure is easy to fix.
        console.error(`[migrate] Error in ${file}: ${err.message}`);
        throw err; // fail-fast — abort the deploy/boot
      }
    }
    console.log(`[migrate] Done. New migrations applied: ${count} (dir: ${dir}).`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[migrate] Migration failed:', err.message || err);
  process.exit(1);
});
