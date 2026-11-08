// Isolated test of the exact R-02 and R-05 psql invocations (psql.mjs), on a THROWAWAY local PostgreSQL cluster
// created in the OS temp folder, on 127.0.0.1 only, deleted afterwards. Never connects to a Supabase project.
//   node tests/recovery/psql.test.mjs        (needs PostgreSQL 15+ binaries; PG_BIN overrides the default path)
// Proves: migration bytes and the history row commit together or not at all; a failure anywhere leaves no SQL and
// no history row; a COMMIT inside a file would break that (which is why R-00 refuses transaction control); the
// restore is all-or-nothing and really runs in replica mode.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { run, migrationArgs, restoreArgs } from './psql.mjs';
import { cleanupCluster, TIMEOUT_MS } from './pgctl.mjs';

const BIN = process.env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin';
const exe = n => join(BIN, process.platform === 'win32' ? `${n}.exe` : n);
const port = await new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const dir = mkdtempSync(join(tmpdir(), 'meridian-psql-test-'));
const data = join(dir, 'data'), url = `postgresql://postgres@127.0.0.1:${port}/postgres`;
// every pg_ctl, initdb, postgres and psql call has a 120 s timeout
const sh = (n, args) => execFileSync(exe(n), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: TIMEOUT_MS });
const p = (args, input) => run(exe('psql'), url, args, input, { timeout: TIMEOUT_MS });
const val = sql => p(['-At', '-c', sql]).trim();
// An expected failure must be psql exiting non-zero by itself. A timeout, a signal or a launch failure is not the
// rollback being tested, so it is re-thrown and fails the test instead of counting as "failed as expected".
const fails = (args, input) => {
  try { p(args, input); return false; }
  catch (e) { if (typeof e.status === 'number' && e.status !== 0 && !e.signal) return true; throw e; }
};

// Cleanup (pgctl.mjs cleanupCluster) runs on every path. Once a start has been attempted it stops the server
// (graceful, then immediate if not confirmed) and checks pg_ctl status after every stop attempt. The temp folder is
// deleted only if the server is confirmed stopped; otherwise it is preserved and its path printed. The test exits
// non-zero unless the server is confirmed stopped AND the folder is removed (a hard assertion).
let startAttempted = false, assertionsPassed = false;
try {
  console.log(`binaries: ${sh('postgres', ['--version']).trim()} | ${sh('initdb', ['--version']).trim()} | ${sh('psql', ['--version']).trim()}`);
  sh('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-sync']);
  startAttempted = true;
  sh('pg_ctl', ['-D', data, '-l', join(dir, 'log.txt'), '-o', `-p ${port} -c listen_addresses=127.0.0.1`, '-w', 'start']);
  const version = val('show server_version');
  assert.ok(Number(version.split('.')[0]) >= 15, `needs PostgreSQL 15+, got ${version}`);
  p(['-c', 'create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text); create schema public_test']);
  const history = v => val(`select count(*) from supabase_migrations.schema_migrations where version = '${v}'`);
  const exists = t => val(`select to_regclass('${t}') is not null`);

  // 1. success: the file's SQL and its history row both commit
  p(migrationArgs('20990101000001', 'ok'), Buffer.from('create table m_ok (id int);\ninsert into m_ok values (1);\n'));
  assert.equal(exists('m_ok'), 't'); assert.equal(history('20990101000001'), '1');

  // 2. failure in the middle of the file: nothing from the file, no history row
  assert.ok(fails(migrationArgs('20990101000002', 'bad_middle'), Buffer.from('create table m_bad1 (id int);\ninsert into m_bad1 values (1);\nselect 1/0;\ncreate table m_bad2 (id int);\n')));
  assert.equal(exists('m_bad1'), 'f'); assert.equal(exists('m_bad2'), 'f'); assert.equal(history('20990101000002'), '0');

  // 3. failure in the history insert (duplicate version): the file's SQL is rolled back too, so it is one transaction
  assert.ok(fails(migrationArgs('20990101000001', 'dup'), Buffer.from('create table m_dup (id int);\n')));
  assert.equal(exists('m_dup'), 'f'); assert.equal(history('20990101000001'), '1');

  // 4. a syntax error on the last line: still nothing kept
  assert.ok(fails(migrationArgs('20990101000004', 'bad_syntax'), Buffer.from('create table m_syn (id int);\ncreat table oops;\n')));
  assert.equal(exists('m_syn'), 'f'); assert.equal(history('20990101000004'), '0');

  // 5. hazard: a COMMIT inside the file ends the wrapping transaction early, so a later error leaves partial SQL.
  //    This is why R-00 refuses migration files containing transaction control (migrations.test.mjs).
  assert.ok(fails(migrationArgs('20990101000005', 'commit_inside'), Buffer.from('create table m_commit (id int);\nCOMMIT;\nselect 1/0;\n')));
  assert.equal(exists('m_commit'), 't'); assert.equal(history('20990101000005'), '0');

  // 6. restore: all-or-nothing, and replica mode really skips ordinary and FK triggers during the load
  p(['-c', `create table installation_settings (id int);
    create table parent (id int primary key); create table child (id int, parent_id int references parent (id));
    create function no_insert() returns trigger language plpgsql as $$ begin raise exception 'guard fired'; end $$;
    create trigger guard before insert on child for each row execute function no_insert();
    insert into installation_settings values (1);`]);
  const good = join(dir, 'good.sql'), bad = join(dir, 'bad.sql');
  writeFileSync(good, 'insert into child values (1, 999);\ninsert into installation_settings values (2);\n'); // FK orphan + guard: allowed in replica mode
  writeFileSync(bad, 'insert into child values (2, 998);\ninsert into child values (3, \'x\');\n');            // type error on line 2
  const restore = f => restoreArgs(f).map(a => a.replace('public.installation_settings', 'installation_settings'));
  p(restore(good));
  assert.equal(val('select count(*) from child'), '1');                       // guard and FK skipped: replica mode was in force
  assert.equal(val('select string_agg(id::text, \',\') from installation_settings'), '2'); // TRUNCATE then the dumped row
  assert.ok(fails(restore(bad)));
  assert.equal(val('select count(*) from child'), '1');                       // nothing from the failed restore
  assert.equal(val('select string_agg(id::text, \',\') from installation_settings'), '2'); // the TRUNCATE was rolled back too
  assert.equal(val('show session_replication_role'), 'origin');                // a new session is not left in replica mode

  assertionsPassed = true;
  console.log(`psql.mjs: all atomicity assertions passed on throwaway PostgreSQL ${version} (port ${port})`);
} finally {
  const c = cleanupCluster({ startAttempted, dataDir: data, tempDir: dir,
    pgctl: args => sh('pg_ctl', ['-D', data, ...args]),
    removeDir: d => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }), dirExists: existsSync });
  console.log(`cleanup: ${JSON.stringify(c)}`);
  if (c.dir_preserved) console.error(`CLEANUP: server state "${c.server}" not confirmed stopped; data directory preserved for a manual stop: ${c.dir_preserved}`);
  if (!c.ok) process.exitCode = 1;
  console.log(`RESULT ${assertionsPassed && c.ok ? 'PASS' : 'FAIL'} (assertions ${assertionsPassed ? 'passed' : 'did not complete'}; cleanup ${c.ok ? 'ok' : 'FAILED'})`);
}
