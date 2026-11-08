// Recovery drill: rebuild Meridian in a clean Supabase project from the repo plus a backup.
//   node tests/recovery/drill.mjs [--allow-source-sentinel]
// Procedure, decisions and acceptance criteria: docs/RECOVERY-RUNBOOK.md.
// Needs in .env: SOURCE_DB_URL, TARGET_DB_URL (Session pooler URIs, port 5432), SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, TARGET_SUPABASE_URL, TARGET_SERVICE_ROLE_KEY, TARGET_SUPABASE_ANON_KEY.
// Optional PG_BIN (default C:\Program Files\PostgreSQL\17\bin).
//
// Writes to the SOURCE only with --allow-source-sentinel (one 64 KB file in Storage, R-03). Without it the byte
// copy cannot be proven and the result is INCOMPLETE, never PASS.
// Steps: R-00 migrations match the approved manifest · R-01 target empty · R-01a platform table definitions and
// versions · R-02 migrations · R-03 sentinel · R-04 pg_dump · R-05 restore (one replica-mode transaction) ·
// R-06 file bytes · R-07..R-13 fingerprint comparison (compare.mjs classifies every difference) ·
// R-14 referential integrity · R-15 GoTrue lists the restored users · R-16 one restored user signs in
// (intentional deviation, persisted to disk before it is made).
// The dump holds password hashes: it stays in tests/recovery/.work (git-ignored); delete it after.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { diff, classify, area } from './compare.mjs';
import { storagePath } from './paths.mjs';
import { verifyMigrations } from './migrations.mjs';
import { run, migrationArgs, restoreArgs } from './psql.mjs';
import { writeDurable, apiOutcome } from './evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const env = Object.fromEntries(readFileSync(join(repo, '.env'), 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
for (const k of ['SOURCE_DB_URL', 'TARGET_DB_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TARGET_SUPABASE_URL', 'TARGET_SERVICE_ROLE_KEY', 'TARGET_SUPABASE_ANON_KEY']) {
  if (!env[k]) { console.error(`.env is missing ${k}`); process.exit(2); }
}
if (env.SOURCE_DB_URL === env.TARGET_DB_URL || env.SUPABASE_URL === env.TARGET_SUPABASE_URL) { console.error('source and target must differ'); process.exit(2); }
const ALLOW_SENTINEL = process.argv.includes('--allow-source-sentinel');
const BIN = env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin';
const exe = n => join(BIN, process.platform === 'win32' ? `${n}.exe` : n);
const work = join(here, '.work');
mkdirSync(work, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
const t0 = Date.now();
const US = '\u001f'; // psql field separator: object names may contain '|'
// process.exit() with a pooled fetch socket open aborts Node 24 on Windows (exit 127), so finish() throws a sentinel
const STOP = Symbol('stop');
process.on('uncaughtException', e => { if (e !== STOP) { console.error(e); process.exitCode = 1; } });

// ---- evidence, written durably (temp file, fsync, rename, directory flush where supported: evidence.mjs) ----
const evidenceFile = join(repo, 'evidence', 'recovery-drill.json');
const evidence = {
  suite: 'recovery-drill', ran_at: new Date().toISOString(), source: env.SUPABASE_URL, target: env.TARGET_SUPABASE_URL,
  source_sentinel_allowed: ALLOW_SENTINEL, result: 'RUNNING', target_state: 'empty', steps: [], target_counts: null,
  migrations: null, dump: null, sentinel: null, files: null, platform_versions: null,
  differences: { platform_generated: [], platform_version: [], unexpected: [] },
  fingerprints_taken: 'after R-06, before R-15/R-16', intentional_deviations: [],
  persistence: { method: 'temp file, fsync, rename, then directory fsync', directory_flush: null },
};
function persist() {
  evidence.persisted_at = new Date().toISOString();
  evidence.persistence.directory_flush = writeDurable(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
}
const steps = evidence.steps;
let failed = false;
function record(name, status, detail) {
  steps.push({ step: name, status, detail, at: new Date().toISOString() });
  console.log(`${status.padEnd(10)} ${name}  [${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}]`);
  if (status === 'FAIL') failed = true;
}
const step = (name, ok, detail) => { record(name, ok ? 'PASS' : 'FAIL', detail); if (!ok) finish(); }; // stops on failure
const check = (name, ok, detail) => record(name, ok ? 'PASS' : 'FAIL', detail);                       // records, continues

function finish() {
  const statuses = steps.map(s => s.status);
  evidence.result = failed ? 'FAIL'
    : statuses.some(s => s === 'SKIPPED' || s === 'NOT_PROVEN') ? 'INCOMPLETE'
    : evidence.differences.platform_generated.length || evidence.differences.platform_version.length ? 'PASS_WITH_CLASSIFIED_DIFFERENCES'
    : 'PASS_EXACT';
  evidence.duration_seconds = Math.round((Date.now() - t0) / 1000);
  persist();
  console.log(`RESULT ${evidence.result}  (${evidence.duration_seconds} s)`);
  if (evidence.target_state !== 'empty') console.log(`TARGET ${evidence.target_state}`);
  process.exitCode = failed ? 1 : 0;
  throw STOP;
}

const psql = (url, args, input) => run(exe('psql'), url, args, input); // same invocation psql.test.mjs exercises
const q = (url, sql) => psql(url, ['-At', '-c', sql]).trim();
const rows = (url, sql) => psql(url, ['-At', '-F', US], sql).trim().split('\n').filter(Boolean).map(l => l.split(US));
const json = (url, file) => JSON.parse(psql(url, ['-At'], readFileSync(join(here, file), 'utf8')).trim());
const auth = key => ({ apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) });
const jwtSub = t => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')).sub; } catch { return null; } };

// ---- R-00 the repository holds exactly the approved migrations, byte for byte (local; nothing written) ----
const { files: migs, problems: migProblems } = verifyMigrations(join(repo, 'supabase', 'migrations'), readFileSync(join(here, 'approved-migrations.sha256'), 'utf8'));
evidence.migrations = { manifest: 'tests/recovery/approved-migrations.sha256', files: migs.map(({ file, sha256 }) => ({ file, sha256 })), problems: migProblems };
step('R-00 exactly the 9 approved migration files, sha256 equal to the approved manifest', migProblems.length === 0, migProblems.length ? migProblems : `${migs.length} files verified`);

// ---- R-01 target is clean ----
// The history table may not exist yet: query_to_xml is volatile, so CASE only evaluates it when to_regclass finds it.
evidence.target_counts = JSON.parse(q(env.TARGET_DB_URL, `select json_build_object(
  'public_tables', (select count(*) from pg_tables where schemaname = 'public'),
  'storage_objects', (select count(*) from storage.objects),
  'storage_buckets', (select count(*) from storage.buckets),
  'auth_users', (select count(*) from auth.users),
  'auth_identities', (select count(*) from auth.identities),
  'migration_history_rows', CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 0
    ELSE (xpath('/row/n/text()', query_to_xml('select count(*) as n from supabase_migrations.schema_migrations', false, true, '')))[1]::text::bigint END)`));
step('R-01 target project is empty (6 counts)', Object.keys(evidence.target_counts).length === 6 && Object.values(evidence.target_counts).every(n => Number(n) === 0),
  evidence.target_counts);

// ---- R-01a (A1) platform table definitions identical; platform version difference only if reviewed ----
const ps = json(env.SOURCE_DB_URL, 'platform-schema.sql'), pt = json(env.TARGET_DB_URL, 'platform-schema.sql');
const defDiffs = diff(ps.tables, pt.tables);
evidence.platform_versions = { source: ps.platform_versions, target: pt.platform_versions };
step('R-01a auth.users, auth.identities, storage.objects definitions identical (columns, types, nullability, defaults, identity, generated, collation, constraints, indexes, triggers)',
  defDiffs.length === 0, defDiffs.length ? defDiffs.map(d => d.path.join(' > ')) : 'identical');
if (JSON.stringify(ps.platform_versions) === JSON.stringify(pt.platform_versions)) {
  record('R-01b GoTrue and Storage versions', 'PASS', `identical ${JSON.stringify(ps.platform_versions)}`);
} else {
  const acc = JSON.parse(readFileSync(join(here, 'accepted-platform-versions.json'), 'utf8')).accepted
    .find(e => JSON.stringify(e.source) === JSON.stringify(ps.platform_versions) && JSON.stringify(e.target) === JSON.stringify(pt.platform_versions) && e.reason && e.reviewed_by && e.reviewed_on);
  if (acc) evidence.differences.platform_version.push({ source: ps.platform_versions, target: pt.platform_versions, reason: acc.reason, reviewed_by: acc.reviewed_by, reviewed_on: acc.reviewed_on });
  step('R-01b GoTrue and Storage versions identical, or the difference reviewed and accepted', !!acc,
    acc ? `differ; accepted by ${acc.reviewed_by} on ${acc.reviewed_on}: ${acc.reason}`
        : `differ and not reviewed: source ${JSON.stringify(ps.platform_versions)}, target ${JSON.stringify(pt.platform_versions)}. Nothing written. Review, then add an entry to tests/recovery/accepted-platform-versions.json`);
}

// ---- R-02 the verified migration bytes, in filename order, each in its own transaction ----
evidence.target_state = 'dirty: recreate the target before any re-run';
persist();
psql(env.TARGET_DB_URL, ['-c', 'create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)']);
for (const m of migs) {
  const [version, ...rest] = m.file.replace(/\.sql$/, '').split('_');
  try {
    // the bytes hashed in R-00 are piped in, so the file cannot change between the check and the apply;
    // file and history row are one transaction (psql.mjs; proven by psql.test.mjs)
    psql(env.TARGET_DB_URL, migrationArgs(version, rest.join('_')), m.bytes);
  } catch (e) { step('R-02 migrations applied from the repository', false, `${m.file}: ${String(e.stderr || e.message).slice(0, 500)}`); }
}
step('R-02 migrations applied from the repository', true, `${migs.length} files, bytes as verified in R-00`);

// ---- R-03 (A5) sentinel: the only write to the source, and only when allowed ----
const bizA = q(env.SOURCE_DB_URL, 'select id from public.businesses order by created_at, id limit 1');
let sentinelKey = null;
if (ALLOW_SENTINEL) {
  const sentinel = new Uint8Array(randomBytes(65536));
  sentinelKey = `${bizA}/recovery/sentinel-${Date.now()}.bin`;
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${storagePath('company-vault', sentinelKey)}`, { method: 'POST', headers: { ...auth(env.SUPABASE_SERVICE_ROLE_KEY), 'Content-Type': 'application/octet-stream' }, body: sentinel });
  evidence.sentinel = { key: `company-vault/${sentinelKey}`, bytes: sentinel.length, sha256: sha(sentinel), upload_status: r.status };
  step('R-03 sentinel file stored in source (approved source write)', r.ok, `${r.status} ${sentinelKey} sha ${sha(sentinel).slice(0, 12)}`);
} else {
  record('R-03 sentinel file stored in source', 'SKIPPED', 'not allowed (no --allow-source-sentinel); source not written; byte copy cannot be proven');
}

// ---- R-04 backup ----
const dumpFile = join(work, 'data.sql');
execFileSync(exe('pg_dump'), [env.SOURCE_DB_URL, '--data-only', '--no-owner', '--no-privileges', '-t', 'public.*', '-t', 'auth.users', '-t', 'auth.identities', '-t', 'storage.objects', '-f', dumpFile]);
const dump = readFileSync(dumpFile);
evidence.dump = { bytes: statSync(dumpFile).size, sha256: sha(dump), tables: 'public.*, auth.users, auth.identities, storage.objects (data only)' };
step('R-04 data backup taken with pg_dump', dump.length > 0, `${evidence.dump.bytes} bytes, sha256 ${evidence.dump.sha256}`);

// ---- R-05 restore: one transaction; replica mode so guard and activity triggers do not re-fire on history ----
const restoreStart = Date.now();
try {
  psql(env.TARGET_DB_URL, restoreArgs(dumpFile));
} catch (e) { step('R-05 backup restored into the target', false, `rolled back: ${String(e.stderr || e.message).slice(0, 500)}`); }
step('R-05 backup restored into the target', true, `${Math.round((Date.now() - restoreStart) / 1000)} s, one transaction`);

// ---- R-06 stored bytes: source -> target, same path (segments encoded), same mimetype and Cache-Control ----
const objs = rows(env.SOURCE_DB_URL, "select bucket_id, name, coalesce(metadata->>'mimetype', ''), coalesce(metadata->>'cacheControl', ''), (metadata is null)::text from storage.objects order by bucket_id, name");
// evidence.files is the live copy state, persisted after every object and before any stop
const copy = evidence.files = { objects: objs.length, copied: [], verified: [], metadata_only: [], in_progress: null, failed: null };
const r06fail = (key, phase, detail) => {
  copy.failed = { object: key, phase, detail, at: new Date().toISOString() }; copy.in_progress = null;
  step('R-06 stored files copied and sha256-verified', false, `${key}: ${phase} ${detail}`); // step() -> finish() persists
};
for (const [bucket, name, mime, cc, noMeta] of objs) {
  const key = `${bucket}/${name}`;
  let path;
  try { path = storagePath(bucket, name); } catch (e) { r06fail(key, 'path_encoding', e.message); }
  copy.in_progress = { object: key, phase: 'source_read' }; persist();
  let src; try { src = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${path}`, { headers: auth(env.SUPABASE_SERVICE_ROLE_KEY) }); }
  catch (e) { r06fail(key, 'source_read', `no response: ${e.message}`); }
  if (!src.ok) {
    const body = await src.text();
    // index-only rows (inserted by the SQL tests, metadata NULL, no bytes) stay index-only, as in the source
    if (src.status === 400 && /not_found|NoSuchKey/.test(body) && noMeta === 'true') { copy.metadata_only.push(key); copy.in_progress = null; persist(); continue; }
    r06fail(key, 'source_read', `${src.status} ${body.slice(0, 200)}`);
  }
  const bytes = new Uint8Array(await src.arrayBuffer()), want = sha(bytes);
  copy.in_progress = { object: key, phase: 'target_upload', bytes: bytes.length, sha256: want }; persist();
  let up; try { up = await fetch(`${env.TARGET_SUPABASE_URL}/storage/v1/object/${path}`, { method: 'POST',
    headers: { ...auth(env.TARGET_SERVICE_ROLE_KEY), 'Content-Type': mime || 'application/octet-stream', ...(cc ? { 'Cache-Control': cc } : {}), 'x-upsert': 'true' }, body: bytes }); }
  catch (e) { r06fail(key, 'target_upload', `no response (upload outcome unknown): ${e.message}`); }
  if (!up.ok) r06fail(key, 'target_upload', `${up.status} ${(await up.text()).slice(0, 200)}`);
  copy.copied.push(key);
  copy.in_progress = { object: key, phase: 'read_back', bytes: bytes.length, sha256: want }; persist();
  let back; try { back = await fetch(`${env.TARGET_SUPABASE_URL}/storage/v1/object/${path}`, { headers: auth(env.TARGET_SERVICE_ROLE_KEY) }); }
  catch (e) { r06fail(key, 'read_back', `no response: ${e.message}`); }
  if (!back.ok) r06fail(key, 'read_back', `${back.status} ${(await back.text()).slice(0, 200)}`);
  const got = sha(new Uint8Array(await back.arrayBuffer()));
  if (got !== want) r06fail(key, 'read_back_sha256', `target ${got} != source ${want}`);
  copy.verified.push({ object: key, bytes: bytes.length, sha256: want });
  copy.in_progress = null; persist();
}
const sentinelCopied = sentinelKey && copy.copied.includes(`company-vault/${sentinelKey}`);
if (copy.copied.length === 0) {
  record('R-06 stored files copied and sha256-verified', 'NOT_PROVEN', `no byte-bearing object in the source (${copy.metadata_only.length} index-only rows); the byte copy was not exercised`);
} else {
  check('R-06 stored files copied and sha256-verified', copy.verified.length === copy.copied.length && (!ALLOW_SENTINEL || sentinelCopied),
    `${copy.copied.length} copied, ${copy.verified.length} verified, ${copy.metadata_only.length} index-only`);
}

// ---- R-07..R-13 fingerprints, every difference classified (compare.mjs) ----
const a = json(env.SOURCE_DB_URL, 'reconcile.sql'), b = json(env.TARGET_DB_URL, 'reconcile.sql');
writeFileSync(join(work, 'fingerprints.json'), JSON.stringify({ source: a, target: b }, null, 2)); // diagnosis aid, not evidence
const classified = classify(diff(a, b), new Set(copy.copied));
for (const d of classified) evidence.differences[d.class].push(d);
const bad = k => classified.filter(d => d.class === 'unexpected' && k.includes(area(d)));
const noted = k => classified.filter(d => d.class === 'platform_generated' && k.includes(area(d)));
check('R-07 migration history identical', bad(['migrations']).length === 0, `${a.migrations.length} versions`);
check('R-08 every public table identical (row count and full-row md5)', bad(['tables']).length === 0, bad(['tables']).length ? bad(['tables']) : `${Object.keys(a.tables).length} tables`);
check('R-09 auth users and identities identical (full rows)', bad(['auth_users', 'auth_identities']).length === 0, bad(['auth_users', 'auth_identities']).length ? bad(['auth_users', 'auth_identities']) : `${a.auth_users.rows} users, ${a.auth_identities.rows} identities`);
check('R-10 storage objects identical field by field', bad(['storage_objects']).length === 0,
  { objects: a.storage_objects.rows, unexpected: bad(['storage_objects']), platform_generated: noted(['storage_objects']).map(d => d.path) });
check('R-11 cash, balances, allocations, commitment status, document hashes identical', bad(['finance']).length === 0, bad(['finance']).length ? bad(['finance']) : a.finance);
check('R-12 security posture identical (relation, column and schema ACLs incl. PUBLIC, default privileges, RLS enabled and forced, view options, policies, function definitions and config, triggers, buckets)',
  bad(['security']).length === 0, bad(['security']));
check('R-13 no unexpected differences', evidence.differences.unexpected.length === 0,
  `${evidence.differences.unexpected.length} unexpected, ${evidence.differences.platform_generated.length} platform-generated, ${evidence.differences.platform_version.length} platform-version`);

// ---- R-14 (A4) referential integrity on the target (FK triggers were skipped in replica mode) ----
const orph = rows(env.TARGET_DB_URL, readFileSync(join(here, 'orphans.sql'), 'utf8'));
const orphBad = orph.filter(r => r[2] !== '0');
check('R-14 referential integrity: every public FK and auth.identities.user_id', orph.length > 0 && orphBad.length === 0, orphBad.length ? orphBad : `${orph.length} checks, 0 orphans`);

// Stop here on any failure: R-15/R-16 would change the target that now has to be diagnosed.
if (failed) finish();

// ---- R-15 (A2) GoTrue can read the restored users ----
const srcIds = q(env.SOURCE_DB_URL, "select string_agg(id::text, ',' order by id) from auth.users");
const lr = await fetch(`${env.TARGET_SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: auth(env.TARGET_SERVICE_ROLE_KEY) });
const tu = lr.ok ? (await lr.json()).users || [] : [];
const tIds = tu.map(u => u.id).sort().join(',');
check('R-15 GoTrue on the target lists the restored users, all confirmed', lr.ok && tIds === srcIds && tu.every(u => u.email_confirmed_at),
  `${lr.status}; ${tu.length} users; ids ${tIds === srcIds ? 'identical' : 'DIFFER'}`);
if (failed) finish();

// ---- R-16 (A2) one restored user signs in: INTENTIONAL DEVIATION ----
// Each call's outcome is written to disk as 'outcome_unknown' BEFORE the call and replaced only by what the response
// proves (evidence.mjs apiOutcome). A crash or lost response therefore leaves 'outcome_unknown', never 'not applied'.
const probe = tu.slice().sort((x, y) => x.id.localeCompare(y.id))[0];
const deviation = {
  step: 'R-16', target_only: true, user_id: probe.id, email: probe.email, recorded_at: new Date().toISOString(),
  change: 'new random password set through the target Auth Admin API, then one password sign-in',
  fields_changed: ['auth.users.encrypted_password', 'auth.users.updated_at', 'auth.users.last_sign_in_at', 'auth.identities.last_sign_in_at / updated_at (if GoTrue updates them)', 'new rows in auth.sessions, auth.refresh_tokens, auth.mfa_amr_claims', 'auth.audit_log_entries'],
  why: 'proves a restored user is usable by GoTrue; the restored password hash cannot be tested because test passwords are random and never stored',
  effect_on_comparison: 'none: fingerprints were taken before this step; the target no longer matches the source in these fields afterwards',
  outcome_values: 'not_attempted | outcome_unknown (attempted, no conclusive response) | confirmed_applied (2xx) | confirmed_refused (4xx)',
  password_reset: { outcome: 'not_attempted' }, sign_in: { outcome: 'not_attempted' },
};
evidence.intentional_deviations.push(deviation);
persist(); // 1. the deviation is on disk before anything is attempted
const pw = randomBytes(24).toString('base64url');
async function attempt(slot, call) { // 2. 'attempted' on disk immediately before the call; 3. the proven outcome after it
  deviation[slot] = { outcome: 'outcome_unknown', attempted_at: new Date().toISOString() }; persist();
  let res = null, body = {}, error = null;
  try { res = await call(); body = await res.json().catch(() => ({})); } catch (e) { error = e.message; }
  Object.assign(deviation[slot], { outcome: apiOutcome({ threw: !!error, status: res?.status ?? null }), status: res?.status ?? null,
    responded_at: new Date().toISOString(), ...(error ? { transport_error: error } : {}) });
  return { res, body };
}
const reset = await attempt('password_reset', () => fetch(`${env.TARGET_SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(probe.id)}`,
  { method: 'PUT', headers: { ...auth(env.TARGET_SERVICE_ROLE_KEY), 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }));
deviation.password_reset.returned_user_id = reset.body.id ?? null;
persist();
if (deviation.password_reset.outcome === 'confirmed_applied') {
  const si = await attempt('sign_in', () => fetch(`${env.TARGET_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    { method: 'POST', headers: { apikey: env.TARGET_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: probe.email, password: pw }) }));
  const tokenSub = si.body.access_token ? jwtSub(si.body.access_token) : null;
  Object.assign(deviation.sign_in, { token_issued: !!si.body.access_token, returned_user_id: si.body.user?.id ?? null, token_sub: tokenSub,
    same_user: si.body.user?.id === probe.id && tokenSub === probe.id,
    error: si.res?.ok ? null : (si.body.error_code || si.body.msg || si.body.error || null) });
  persist();
}
const s = deviation.sign_in;
check('R-16 the selected restored user signs in on the target as itself (password reset recorded as intentional deviation)',
  deviation.password_reset.outcome === 'confirmed_applied' && deviation.password_reset.returned_user_id === probe.id
    && s.outcome === 'confirmed_applied' && s.token_issued && s.same_user,
  `${probe.email}: password reset ${deviation.password_reset.outcome} (${deviation.password_reset.status}), sign-in ${s.outcome} (${s.status ?? '-'}), user id ${s.same_user ? 'matches (response and token sub)' : 'NOT CONFIRMED'}`);
finish();
