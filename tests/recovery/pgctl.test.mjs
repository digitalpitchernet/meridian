// Self-test for pgctl.mjs: node tests/recovery/pgctl.test.mjs
// Part 1 needs nothing. Part 2 runs the INSTALLED pg_ctl client (PG_BIN, default PostgreSQL 17 on Windows) against
// throwaway folders in the OS temp directory: no server is started, nothing is downloaded, Supabase is never contacted.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyPgCtlStatus, cleanupCluster, TIMEOUT_MS } from './pgctl.mjs';

// ---- Part 1a: status classification ----
const err = (o) => Object.assign(new Error('x'), o);
assert.equal(classifyPgCtlStatus(undefined), 'running');
assert.equal(classifyPgCtlStatus(err({ status: 3 })), 'stopped');
assert.equal(classifyPgCtlStatus(err({ status: 4 })), 'unknown (4)');
assert.equal(classifyPgCtlStatus(err({ status: 1 })), 'unknown (1)');
assert.equal(classifyPgCtlStatus(err({ status: 2 })), 'unknown (2)');
assert.equal(classifyPgCtlStatus(err({ status: null, code: 'ENOENT' })), 'unknown (ENOENT)');
assert.equal(classifyPgCtlStatus(err({ status: null, code: 'EACCES' })), 'unknown (EACCES)');
assert.equal(classifyPgCtlStatus(err({ status: null, code: 'ETIMEDOUT', signal: 'SIGTERM' })), 'unknown (timeout)');
assert.equal(classifyPgCtlStatus(err({ status: 3, signal: 'SIGKILL' })), 'unknown (signal SIGKILL)'); // 3 only counts as a clean exit
assert.equal(classifyPgCtlStatus(err({})), 'unknown (error)');

// ---- Part 1b: cleanup decisions with a scripted pg_ctl ----
// script: responses in call order; 'ok' = exit 0, a number = that exit code, an object = that error
function harness(startAttempted, script, { removeThrows = false, dirSurvives = false } = {}) {
  const calls = [], removed = [];
  const queue = [...script];
  const pgctl = args => {
    calls.push(args.join(' '));
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected pg_ctl call: ${args.join(' ')}`);
    if (next === 'ok') return '';
    throw typeof next === 'number' ? err({ status: next }) : err(next);
  };
  const r = cleanupCluster({ startAttempted, dataDir: 'T/data', tempDir: 'T', pgctl,
    removeDir: d => { removed.push(d); if (removeThrows) throw new Error('EBUSY'); }, dirExists: () => dirSurvives || removeThrows });
  assert.equal(queue.length, 0, `unused scripted responses: ${JSON.stringify(queue)}`);
  return { r, calls, removed };
}
const STOP_FAST = '-m fast -w stop', STOP_IMM = '-m immediate -w stop', STATUS = 'status';

{ // a. initdb failed, no start attempted: no pg_ctl call, folder removed
  const { r, calls, removed } = harness(false, []);
  assert.deepEqual(calls, []); assert.deepEqual(removed, ['T']); assert.equal(r.server, 'not started'); assert.equal(r.ok, true);
}
{ // b. normal run: graceful stop ok, status confirms stopped, no immediate stop
  const { r, calls, removed } = harness(true, ['ok', 3]);
  assert.deepEqual(calls, [STOP_FAST, STATUS]); assert.deepEqual(removed, ['T']); assert.equal(r.server, 'stopped'); assert.equal(r.ok, true);
}
{ // c. pg_ctl start failed before the server came up: graceful stop fails (no PID file), status 3 -> stopped, removed
  const { r, calls, removed } = harness(true, [1, 3]);
  assert.deepEqual(calls, [STOP_FAST, STATUS]); assert.deepEqual(removed, ['T']); assert.equal(r.graceful_stop, 'failed (exit 1)'); assert.equal(r.ok, true);
}
{ // d. graceful stop reports success but the server still runs: status is checked anyway, immediate stop follows
  const { r, calls, removed } = harness(true, ['ok', 'ok', 'ok', 3]);
  assert.deepEqual(calls, [STOP_FAST, STATUS, STOP_IMM, STATUS]); assert.equal(r.state_after_graceful, 'running'); assert.deepEqual(removed, ['T']); assert.equal(r.ok, true);
}
{ // e. graceful stop times out with the server running; immediate stop works
  const { r, calls, removed } = harness(true, [{ status: null, code: 'ETIMEDOUT', signal: 'SIGTERM' }, 'ok', 'ok', 3]);
  assert.deepEqual(calls, [STOP_FAST, STATUS, STOP_IMM, STATUS]); assert.equal(r.graceful_stop, 'failed (timeout)'); assert.deepEqual(removed, ['T']); assert.equal(r.ok, true);
}
{ // f. both stops fail and the server is still running: folder PRESERVED, not ok
  const { r, removed } = harness(true, [1, 'ok', 1, 'ok']);
  assert.deepEqual(removed, []); assert.equal(r.server, 'running'); assert.equal(r.dir_preserved, 'T/data'); assert.equal(r.dir_removed, false); assert.equal(r.ok, false);
}
for (const [label, unknown, expect] of [ // g. status cannot confirm anything: folder PRESERVED, not ok
  ['exit 4', { status: 4 }, 'unknown (4)'], ['exit 1', { status: 1 }, 'unknown (1)'],
  ['launch failure', { status: null, code: 'ENOENT' }, 'unknown (ENOENT)'], ['status timeout', { status: null, code: 'ETIMEDOUT', signal: 'SIGTERM' }, 'unknown (timeout)']]) {
  const { r, calls, removed } = harness(true, [1, unknown, 1, unknown]);
  assert.deepEqual(calls, [STOP_FAST, STATUS, STOP_IMM, STATUS], label);
  assert.deepEqual(removed, [], label); assert.equal(r.server, expect, label); assert.equal(r.dir_preserved, 'T/data', label); assert.equal(r.ok, false, label);
}
{ // h. a stop that "succeeds" followed by an unknown status is still unknown: preserved
  const { r, removed } = harness(true, ['ok', { status: 4 }, 'ok', { status: 4 }]);
  assert.deepEqual(removed, []); assert.equal(r.ok, false);
}
{ // i. server confirmed stopped but the folder cannot be removed: not ok
  const { r } = harness(true, ['ok', 3], { removeThrows: true });
  assert.equal(r.server_confirmed_stopped, true); assert.equal(r.dir_removed, false); assert.equal(r.remove_error, 'EBUSY'); assert.equal(r.ok, false);
  const s = harness(true, ['ok', 3], { dirSurvives: true });
  assert.equal(s.r.dir_removed, false); assert.equal(s.r.ok, false);
}
console.log('pgctl.mjs part 1: classification and cleanup decisions passed');

// ---- Part 2: the installed pg_ctl client really returns what the classifier assumes ----
const BIN = process.env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin';
const pgctlExe = join(BIN, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
if (!existsSync(pgctlExe)) {
  console.log(`pgctl.mjs part 2: SKIPPED (no pg_ctl at ${pgctlExe})`);
} else {
  const status = (exe, dir) => { try { execFileSync(exe, ['status', '-D', dir], { stdio: 'pipe', timeout: TIMEOUT_MS }); return classifyPgCtlStatus(); } catch (e) { return classifyPgCtlStatus(e); } };
  const t = mkdtempSync(join(tmpdir(), 'meridian-pgctl-test-'));
  try {
    mkdirSync(join(t, 'empty')); mkdirSync(join(t, 'cluster')); mkdirSync(join(t, 'stale'));
    writeFileSync(join(t, 'cluster', 'PG_VERSION'), '17\n'); writeFileSync(join(t, 'stale', 'PG_VERSION'), '17\n');
    writeFileSync(join(t, 'stale', 'postmaster.pid'), `999999\n${join(t, 'stale')}\n`);
    assert.equal(status(pgctlExe, join(t, 'missing')), 'unknown (4)');  // no such folder: NOT treated as stopped
    assert.equal(status(pgctlExe, join(t, 'empty')), 'unknown (4)');    // not a cluster folder: NOT treated as stopped
    assert.equal(status(pgctlExe, join(t, 'cluster')), 'stopped');      // cluster folder, no PID file
    assert.equal(status(pgctlExe, join(t, 'stale')), 'stopped');        // stale PID file, that process does not exist
    assert.equal(status(join(t, 'no-such-pg_ctl.exe'), join(t, 'cluster')), 'unknown (ENOENT)'); // launch failure
    const v = execFileSync(pgctlExe, ['--version'], { encoding: 'utf8', timeout: TIMEOUT_MS }).trim();
    console.log(`pgctl.mjs part 2: installed client behaviour passed (${v})`);
  } finally {
    rmSync(t, { recursive: true, force: true });
    assert.ok(!existsSync(t), `temp folder left behind: ${t}`);
  }
}
console.log('pgctl.mjs: all assertions passed');
