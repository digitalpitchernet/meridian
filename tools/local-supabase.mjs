// Local PostgreSQL 17 + Supabase-compatible HTTP gateway (GoTrue + PostgREST subset) for offline development
// and automated integration testing. Uses the exact migrations in supabase/migrations/ and enforces real
// PostgreSQL RLS, column grants, triggers, foreign keys, and auth.uid().
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function findPgBin() {
  const candidates = [
    process.env.PG_BIN,
    'C:\\Program Files\\PostgreSQL\\17\\bin',
    'C:\\Program Files\\PostgreSQL\\16\\bin',
  ].filter(Boolean);
  for (const dir of candidates) {
    if (existsSync(join(dir, process.platform === 'win32' ? 'psql.exe' : 'psql'))) return dir;
  }
  return '';
}

function exe(binDir, name) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return binDir ? join(binDir, `${name}${suffix}`) : name;
}

export function hasLocalPgServer() {
  const binDir = findPgBin();
  const pgConfigExe = exe(binDir, 'pg_config');
  try {
    const shareDir = execFileSync(pgConfigExe, ['--sharedir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return Boolean(shareDir && existsSync(join(shareDir, 'postgres.bki')));
  } catch {
    return false;
  }
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
function assertIdent(name, label = 'identifier') {
  if (!IDENT_RE.test(name)) throw Object.assign(new Error(`Invalid ${label}: ${name}`), { status: 400, code: '42703' });
  return name;
}

function sqlLit(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  return `'${str.replace(/'/g, "''")}'`;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parsePgError(err) {
  const text = String(err.stderr || err.stdout || err.message || '');
  const codeMatch = text.match(/ERROR:\s+([A-Z0-9]{5}):\s+([^\r\n]+)/);
  if (codeMatch) {
    return { code: codeMatch[1], message: codeMatch[2].trim() };
  }
  const msgMatch = text.match(/ERROR:\s+([^\r\n]+)/);
  return { code: 'P0001', message: msgMatch ? msgMatch[1].trim() : text.trim() };
}

function httpStatusForSqlState(code) {
  if (code === '42501') return 403;
  if (code === '23505') return 409;
  if (code === 'P0002') return 404;
  return 400;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function createLocalSupabase({
  dataDir = join(REPO_ROOT, '.local-pg', 'data'),
  logFile = join(REPO_ROOT, '.local-pg', 'postgres.log'),
  port = 55432,
  jwtSecret = 'meridian-local-dev-jwt-secret',
  seedDemo = true,
} = {}) {
  const binDir = findPgBin();
  const initdbExe = exe(binDir, 'initdb');
  const pgCtlExe = exe(binDir, 'pg_ctl');
  const psqlExe = exe(binDir, 'psql');
  const dbName = 'meridian';
  const pgUrl = `postgresql://postgres@127.0.0.1:${port}/${dbName}`;
  const adminUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;

  function runPsql(url, sql, { singleTx = false } = {}) {
    const args = [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
    if (singleTx) args.push('--single-transaction');
    return execFileSync(psqlExe, args, {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 1 << 26,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  function runAsAuthenticated(userId, bodySql) {
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
    const wrapped = [
      'SET LOCAL ROLE authenticated;',
      `SELECT set_config('request.jwt.claims', ${sqlLit(claims)}, true);`,
      bodySql,
    ].join('\n');
    return runPsql(pgUrl, wrapped, { singleTx: true });
  }

  function initAndStart() {
    if (!hasLocalPgServer()) {
      throw new Error(
        'Local PostgreSQL server is not available (missing share/postgres.bki). ' +
        'Run "node tools/serve.mjs --fixtures" for explicit fictional fixture mode, ' +
        'or configure app/app-config.json for a live Supabase project.'
      );
    }
    mkdirSync(join(dataDir, '..'), { recursive: true });
    const isFresh = !existsSync(join(dataDir, 'PG_VERSION'));
    if (isFresh) {
      execFileSync(initdbExe, ['-D', dataDir, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    // Start if not already running
    let running = false;
    try {
      execFileSync(pgCtlExe, ['-D', dataDir, 'status'], { stdio: 'ignore' });
      running = true;
    } catch { /* not running */ }

    if (!running) {
      execFileSync(pgCtlExe, ['-D', dataDir, '-l', logFile, '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    const dbExists = runPsql(adminUrl, `SELECT 1 FROM pg_database WHERE datname = ${sqlLit(dbName)};`).trim();
    if (!dbExists) {
      runPsql(adminUrl, `CREATE DATABASE ${dbName};`);
      const platformSql = readFileSync(join(REPO_ROOT, 'tests', 'recovery', 'platform-schema.sql'), 'utf8');
      runPsql(pgUrl, platformSql, { singleTx: true });

      runPsql(pgUrl, `
        CREATE TABLE IF NOT EXISTS auth.local_credentials (
          user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
          password_hash text NOT NULL
        );
      `, { singleTx: true });

      const migrationsDir = join(REPO_ROOT, 'supabase', 'migrations');
      const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
      for (const file of files) {
        const sql = readFileSync(join(migrationsDir, file), 'utf8');
        runPsql(pgUrl, sql, { singleTx: true });
      }

      if (seedDemo) {
        seedDemoWorkspace();
      }
    }
  }

  function seedDemoWorkspace() {
    const userId = randomUUID();
    const email = 'founder@meridian.local';
    const pwHash = hashPassword('meridian-dev-pass');
    runPsql(pgUrl, `
      INSERT INTO auth.users (id, email) VALUES (${sqlLit(userId)}, ${sqlLit(email)});
      INSERT INTO auth.local_credentials (user_id, password_hash) VALUES (${sqlLit(userId)}, ${sqlLit(pwHash)});
    `, { singleTx: true });

    const bizId = runAsAuthenticated(userId, `
      SELECT public.create_workspace('Kestrel Ridge Studio', 'INR', 'en-IN', 'Asia/Kolkata', 'Asha Varma', 4);
    `).trim().split(/\r?\n/).pop();

    runAsAuthenticated(userId, `
      INSERT INTO public.participants (business_id, full_name, participant_type, designation, email, agreed_equity_percentage)
      VALUES (${sqlLit(bizId)}, 'Rohan Mehra', 'cofounder', 'Co-founder, Engineering', 'rohan@meridian.local', 40.00);
      INSERT INTO public.projects (business_id, name, description, status, priority)
      VALUES
        (${sqlLit(bizId)}, 'Meridian V1 Launch', 'Deliver the first persistent founder workflow.', 'Active', 'High'),
        (${sqlLit(bizId)}, 'Customer Discovery', 'Design partner onboarding and feedback.', 'Planning', 'Normal');
    `);
  }

  function stop() {
    try {
      execFileSync(pgCtlExe, ['-D', dataDir, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
    } catch { /* ignore if already stopped */ }
  }

  function authenticate(req) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    return verifyJwt(auth.slice(7), jwtSecret);
  }

  function issueSession(user) {
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = nowSec + 60 * 60 * 12;
    const access_token = signJwt({ sub: user.id, role: 'authenticated', email: user.email, exp }, jwtSecret);
    const refresh_token = signJwt({ sub: user.id, kind: 'refresh', email: user.email, exp: nowSec + 60 * 60 * 24 * 7 }, jwtSecret);
    return { access_token, refresh_token, token_type: 'bearer', expires_in: 43200, expires_at: exp, user: { id: user.id, email: user.email } };
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname;

    try {
      // ---- GoTrue Auth subset ----
      if (path === '/auth/v1/signup' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const email = String(body?.email || '').trim().toLowerCase();
        const password = String(body?.password || '');
        if (!email || password.length < 6) return sendJson(res, 400, { message: 'Valid email and password (6+ chars) required' });
        const existing = runPsql(pgUrl, `SELECT id FROM auth.users WHERE lower(email) = ${sqlLit(email)};`).trim();
        if (existing) return sendJson(res, 409, { code: '23505', message: 'An account with this email already exists' });
        const userId = randomUUID();
        const pwHash = hashPassword(password);
        runPsql(pgUrl, `
          INSERT INTO auth.users (id, email) VALUES (${sqlLit(userId)}, ${sqlLit(email)});
          INSERT INTO auth.local_credentials (user_id, password_hash) VALUES (${sqlLit(userId)}, ${sqlLit(pwHash)});
        `, { singleTx: true });
        return sendJson(res, 200, issueSession({ id: userId, email }));
      }

      if (path === '/auth/v1/token' && req.method === 'POST') {
        const grantType = url.searchParams.get('grant_type') || 'password';
        const body = await readJsonBody(req);
        if (grantType === 'refresh_token') {
          const claims = verifyJwt(body?.refresh_token, jwtSecret);
          if (!claims?.sub || claims.kind !== 'refresh') {
            return sendJson(res, 401, { error_description: 'Invalid or expired refresh token' });
          }
          const row = runPsql(pgUrl, `SELECT id, email FROM auth.users WHERE id = ${sqlLit(claims.sub)} LIMIT 1;`).trim();
          if (!row) return sendJson(res, 401, { error_description: 'User not found' });
          const [id, userEmail] = row.split('|');
          return sendJson(res, 200, issueSession({ id, email: userEmail }));
        }
        const email = String(body?.email || '').trim().toLowerCase();
        const password = String(body?.password || '');
        const row = runPsql(pgUrl, `
          SELECT u.id, u.email, c.password_hash
          FROM auth.users u
          JOIN auth.local_credentials c ON c.user_id = u.id
          WHERE lower(u.email) = ${sqlLit(email)}
          LIMIT 1;
        `).trim();
        if (!row) return sendJson(res, 400, { error_description: 'Invalid login credentials' });
        const [id, userEmail, pwHash] = row.split('|');
        if (!verifyPassword(password, pwHash)) return sendJson(res, 400, { error_description: 'Invalid login credentials' });
        return sendJson(res, 200, issueSession({ id, email: userEmail }));
      }

      if (path === '/auth/v1/user' && req.method === 'GET') {
        const claims = authenticate(req);
        if (!claims?.sub) return sendJson(res, 401, { message: 'Invalid or missing session' });
        const row = runPsql(pgUrl, `SELECT id, email FROM auth.users WHERE id = ${sqlLit(claims.sub)} LIMIT 1;`).trim();
        if (!row) return sendJson(res, 401, { message: 'User not found' });
        const [id, email] = row.split('|');
        return sendJson(res, 200, { id, email });
      }

      if (path === '/auth/v1/logout' && req.method === 'POST') {
        return sendJson(res, 200, {});
      }

      // ---- PostgREST RPC subset ----
      if (path.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
        const claims = authenticate(req);
        if (!claims?.sub) return sendJson(res, 401, { code: '42501', message: 'Authentication required' });
        const fn = assertIdent(decodeURIComponent(path.slice('/rest/v1/rpc/'.length)), 'function');
        const args = (await readJsonBody(req)) || {};
        const argList = Object.entries(args).map(([k, v]) => `${assertIdent(k, 'argument')} => ${sqlLit(v)}`).join(', ');
        const out = runAsAuthenticated(claims.sub, `SELECT to_json(r) FROM public.${fn}(${argList}) AS r;`).trim();
        const lastLine = out.split(/\r?\n/).filter(Boolean).pop();
        return sendJson(res, 200, lastLine ? JSON.parse(lastLine) : null);
      }

      // ---- PostgREST table subset ----
      if (path.startsWith('/rest/v1/')) {
        const claims = authenticate(req);
        if (!claims?.sub) return sendJson(res, 401, { code: '42501', message: 'Authentication required' });
        const table = assertIdent(decodeURIComponent(path.slice('/rest/v1/'.length)), 'table');

        const filters = [];
        for (const [k, v] of url.searchParams.entries()) {
          if (k === 'select' || k === 'order' || k === 'limit') continue;
          const col = assertIdent(k, 'column');
          if (v === 'is.null') filters.push(`${col} IS NULL`);
          else if (v.startsWith('eq.')) filters.push(`${col} = ${sqlLit(v.slice(3))}`);
        }
        const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

        if (req.method === 'GET') {
          const orderParam = url.searchParams.get('order');
          let orderSql = '';
          if (orderParam) {
            const parts = orderParam.split(',').map(p => {
              const [col, dir] = p.split('.');
              return `${assertIdent(col, 'order column')} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
            });
            orderSql = `ORDER BY ${parts.join(', ')}`;
          }
          const limitParam = url.searchParams.get('limit');
          const limitSql = limitParam != null && /^\d+$/.test(limitParam) ? `LIMIT ${Number(limitParam)}` : '';
          const sql = `SELECT COALESCE(json_agg(t), '[]'::json) FROM (SELECT * FROM public.${table} ${whereSql} ${orderSql} ${limitSql}) t;`;
          const out = runAsAuthenticated(claims.sub, sql).trim().split(/\r?\n/).filter(Boolean).pop();
          return sendJson(res, 200, out ? JSON.parse(out) : []);
        }

        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          if (!body || typeof body !== 'object') return sendJson(res, 400, { message: 'JSON body required' });
          const cols = Object.keys(body).map(c => assertIdent(c, 'column'));
          const vals = cols.map(c => sqlLit(body[c]));
          const sql = `
            WITH ins AS (
              INSERT INTO public.${table} (${cols.join(', ')})
              VALUES (${vals.join(', ')})
              RETURNING *
            )
            SELECT COALESCE(json_agg(ins), '[]'::json) FROM ins;
          `;
          const out = runAsAuthenticated(claims.sub, sql).trim().split(/\r?\n/).filter(Boolean).pop();
          return sendJson(res, 201, out ? JSON.parse(out) : []);
        }

        if (req.method === 'PATCH') {
          const body = await readJsonBody(req);
          if (!body || typeof body !== 'object') return sendJson(res, 400, { message: 'JSON body required' });
          const sets = Object.entries(body).map(([c, v]) => `${assertIdent(c, 'column')} = ${sqlLit(v)}`);
          if (!sets.length) return sendJson(res, 400, { message: 'No columns to update' });
          const sql = `
            WITH upd AS (
              UPDATE public.${table}
              SET ${sets.join(', ')}
              ${whereSql}
              RETURNING *
            )
            SELECT COALESCE(json_agg(upd), '[]'::json) FROM upd;
          `;
          const out = runAsAuthenticated(claims.sub, sql).trim().split(/\r?\n/).filter(Boolean).pop();
          return sendJson(res, 200, out ? JSON.parse(out) : []);
        }

        if (req.method === 'DELETE') {
          const sql = `
            WITH del AS (
              DELETE FROM public.${table}
              ${whereSql}
              RETURNING *
            )
            SELECT COALESCE(json_agg(del), '[]'::json) FROM del;
          `;
          const out = runAsAuthenticated(claims.sub, sql).trim().split(/\r?\n/).filter(Boolean).pop();
          return sendJson(res, 200, out ? JSON.parse(out) : []);
        }
      }

      sendJson(res, 404, { message: 'Not found' });
    } catch (err) {
      if (err.status) return sendJson(res, err.status, { code: err.code || 'P0001', message: err.message });
      const pgErr = parsePgError(err);
      sendJson(res, httpStatusForSqlState(pgErr.code), pgErr);
    }
  }

  return { initAndStart, stop, handleRequest, runPsql, pgUrl };
}
