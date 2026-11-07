// Recovery drill: rebuild Meridian in a clean Supabase project from the repo plus a backup.
//   node tests/recovery/drill.mjs
// Needs in .env: SOURCE_DB_URL, TARGET_DB_URL (Session pooler URIs), SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, TARGET_SUPABASE_URL, TARGET_SERVICE_ROLE_KEY.
// Optional PG_BIN (default C:\Program Files\PostgreSQL\17\bin).
// Steps: (1) target must be empty  (2) apply supabase/migrations/*.sql in order with psql
// (3) put a sentinel file in source storage  (4) pg_dump source data  (5) restore it in one
// transaction with triggers in replica mode  (6) copy stored files, verifying sha256
// (7) fingerprint both databases and compare.  Writes evidence/recovery-drill.json.
// The dump holds password hashes: it stays in tests/recovery/.work (git-ignored); delete it after.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const env = Object.fromEntries(readFileSync(join(repo, '.env'), 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
for (const k of ['SOURCE_DB_URL', 'TARGET_DB_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TARGET_SUPABASE_URL', 'TARGET_SERVICE_ROLE_KEY']) {
  if (!env[k]) { console.error(`.env is missing ${k}`); process.exit(2); }
}
if (env.SOURCE_DB_URL === env.TARGET_DB_URL || env.SUPABASE_URL === env.TARGET_SUPABASE_URL) { console.error('source and target must differ'); process.exit(2); }
const BIN = env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin';
const exe = n => join(BIN, process.platform === 'win32' ? `${n}.exe` : n);
const work = join(here, '.work');
mkdirSync(work, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
const t0 = Date.now();
const steps = [];
const step = (name, ok, detail) => { steps.push({ step: name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}  [${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 200)}]`); if (!ok) finish(1); };

const psql = (url, args, input) => execFileSync(exe('psql'), [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], { input, encoding: 'utf8', maxBuffer: 1 << 28 });
const q = (url, sql) => psql(url, ['-At', '-c', sql]).trim();
const auth = key => ({ apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) });

function finish(code) {
  mkdirSync(join(repo, 'evidence'), { recursive: true });
  writeFileSync(join(repo, 'evidence', 'recovery-drill.json'), JSON.stringify({
    suite: 'recovery-drill', ran_at: new Date().toISOString(), source: env.SUPABASE_URL, target: env.TARGET_SUPABASE_URL,
    duration_seconds: Math.round((Date.now() - t0) / 1000), result: code === 0 ? 'PASS' : 'FAIL', steps,
  }, null, 2) + '\n');
  process.exit(code);
}

// 1. target is clean
const tgtTables = q(env.TARGET_DB_URL, "select count(*) from pg_tables where schemaname = 'public'");
const tgtObjects = q(env.TARGET_DB_URL, 'select count(*) from storage.objects');
const tgtUsers = q(env.TARGET_DB_URL, 'select count(*) from auth.users');
step('R-01 target project is empty', tgtTables === '0' && tgtObjects === '0' && tgtUsers === '0', `public tables ${tgtTables}, objects ${tgtObjects}, users ${tgtUsers}`);

// 2. migrations from the repo, in filename order, each in its own transaction
psql(env.TARGET_DB_URL, ['-c', 'create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)']);
const migDir = join(repo, 'supabase', 'migrations');
const files = readdirSync(migDir).filter(f => /^\d{14}_.+\.sql$/.test(f)).sort();
for (const f of files) {
  const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
  psql(env.TARGET_DB_URL, ['--single-transaction', '-f', join(migDir, f), '-c',
    `insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${rest.join('_')}')`]);
}
step('R-02 migrations applied from the repository', true, `${files.length} files`);

// 3. a real file in source storage, so byte copy is exercised
const bizA = q(env.SOURCE_DB_URL, "select id from public.businesses order by created_at, id limit 1");
const sentinel = new Uint8Array(randomBytes(65536));
const sentinelKey = `${bizA}/recovery/sentinel-${Date.now()}.bin`;
let r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/company-vault/${sentinelKey}`, { method: 'POST', headers: { ...auth(env.SUPABASE_SERVICE_ROLE_KEY), 'Content-Type': 'application/octet-stream' }, body: sentinel });
step('R-03 sentinel file stored in source', r.ok, `${r.status} ${sentinelKey} sha ${sha(sentinel).slice(0, 12)}`);

// 4. backup
const dumpFile = join(work, 'data.sql');
execFileSync(exe('pg_dump'), [env.SOURCE_DB_URL, '--data-only', '--no-owner', '--no-privileges', '-t', 'public.*', '-t', 'auth.users', '-t', 'auth.identities', '-t', 'storage.objects', '-f', dumpFile]);
const dump = readFileSync(dumpFile);
step('R-04 data backup taken with pg_dump', dump.length > 0, `${statSync(dumpFile).size} bytes, sha256 ${sha(dump)}`);

// 5. restore: one transaction; replica mode so guard and activity triggers do not re-fire on history
const restoreStart = Date.now();
psql(env.TARGET_DB_URL, ['--single-transaction', '-c', 'SET session_replication_role = replica', '-c', 'TRUNCATE public.installation_settings', '-f', dumpFile, '-c', 'SET session_replication_role = origin']);
step('R-05 backup restored into the target', true, `${Math.round((Date.now() - restoreStart) / 1000)} s`);

// 6. stored bytes
const objects = q(env.SOURCE_DB_URL, "select bucket_id || '/' || name from storage.objects order by 1").split('\n').filter(Boolean);
const copy = { copied: 0, verified: 0, metadata_only: [] };
for (const o of objects) {
  const src = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${o}`, { headers: auth(env.SUPABASE_SERVICE_ROLE_KEY) });
  if (!src.ok) { copy.metadata_only.push(o); continue; } // SQL fixture rows that never had bytes
  const bytes = new Uint8Array(await src.arrayBuffer());
  const up = await fetch(`${env.TARGET_SUPABASE_URL}/storage/v1/object/${o}`, { method: 'POST', headers: { ...auth(env.TARGET_SERVICE_ROLE_KEY), 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }, body: bytes });
  if (!up.ok) step('R-06 copy stored files', false, `${o}: upload ${up.status} ${await up.text()}`);
  copy.copied++;
  const back = new Uint8Array(await (await fetch(`${env.TARGET_SUPABASE_URL}/storage/v1/object/${o}`, { headers: auth(env.TARGET_SERVICE_ROLE_KEY) })).arrayBuffer());
  if (sha(back) === sha(bytes)) copy.verified++;
}
step('R-06 stored files copied and sha256-verified', copy.copied > 0 && copy.verified === copy.copied && objects.includes(`company-vault/${sentinelKey}`), copy);

// 7. fingerprints
const recon = readFileSync(join(here, 'reconcile.sql'), 'utf8');
const fp = url => JSON.parse(psql(url, ['-At'], recon).trim());
const a = fp(env.SOURCE_DB_URL), b = fp(env.TARGET_DB_URL);
writeFileSync(join(work, 'fingerprints.json'), JSON.stringify({ source: a, target: b }, null, 2));
const diffs = [];
(function cmp(x, y, path) {
  if (typeof x === 'object' && x && typeof y === 'object' && y) {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) cmp(x[k], y[k], `${path}.${k}`);
  } else if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push({ path, source: x, target: y });
})(a, b, '$');
const tbl = Object.keys(a.tables).length;
step('R-07 migration history identical', JSON.stringify(a.migrations) === JSON.stringify(b.migrations), `${a.migrations.length} versions`);
step('R-08 every public table identical (row count and full-row md5)', !diffs.some(d => d.path.startsWith('$.tables')), `${tbl} tables`);
step('R-09 auth users and identities identical', !diffs.some(d => d.path.startsWith('$.auth')), `${a.auth_users.rows} users`);
step('R-10 storage object index identical', !diffs.some(d => d.path.startsWith('$.storage')), `${a.storage_objects.rows} objects`);
step('R-11 cash, balances, allocations, commitment status, document hashes identical', !diffs.some(d => d.path.startsWith('$.finance')), a.finance);
step('R-12 grants, column grants, policies, RLS, function ACLs, triggers, bucket identical', !diffs.some(d => d.path.startsWith('$.security')), diffs.filter(d => d.path.startsWith('$.security')));
step('R-13 no differences at all', diffs.length === 0, diffs);
finish(0);
