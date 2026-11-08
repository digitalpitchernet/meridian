// Server lifecycle helpers for psql.test.mjs: pg_ctl status classification and the cleanup decision.
// Kept free of real processes (pg_ctl and the filesystem are passed in) so every path is testable without a server:
//   node tests/recovery/pgctl.test.mjs
export const TIMEOUT_MS = 120_000; // every pg_ctl and psql call in psql.test.mjs

// pg_ctl status (PostgreSQL 17 docs): exit 0 = running, exit 3 = not running. Everything else is UNKNOWN: exit 4
// (no accessible data directory), exit 1 (usage or environment error), a launch failure (ENOENT, EACCES), a
// timeout, or death by signal. err is undefined when the call succeeded (exit 0).
export function classifyPgCtlStatus(err) {
  if (err === undefined) return 'running';
  if (err.status === 3 && !err.signal) return 'stopped';
  const why = err.code === 'ETIMEDOUT' ? 'timeout' : err.signal ? `signal ${err.signal}` : err.status ?? err.code ?? 'error';
  return `unknown (${why})`;
}

const describe = e => (e.code === 'ETIMEDOUT' ? 'timeout' : e.signal ? `signal ${e.signal}` : `exit ${e.status ?? e.code ?? '?'}`);

// Cleanup after the test. pgctl(args) runs pg_ctl against the test's data directory and throws like execFileSync.
// Safeguards: the temp folder is removed only when no start was attempted or the server is CONFIRMED stopped; an
// unknown or running state after graceful and immediate shutdown preserves the folder and reports its path.
// ok is true only when the server is confirmed stopped and the folder is gone; the caller fails the test otherwise.
export function cleanupCluster({ startAttempted, dataDir, tempDir, pgctl, removeDir, dirExists }) {
  const r = { start_attempted: startAttempted, data_dir: dataDir, temp_dir: tempDir };
  const attempt = args => { try { pgctl(args); return 'ok'; } catch (e) { return `failed (${describe(e)})`; } };
  const state = () => { try { pgctl(['status']); return classifyPgCtlStatus(); } catch (e) { return classifyPgCtlStatus(e); } };
  if (startAttempted) {
    r.graceful_stop = attempt(['-m', 'fast', '-w', 'stop']);
    r.state_after_graceful = state();                       // checked after every stop attempt, even a successful one
    if (r.state_after_graceful !== 'stopped') {
      r.immediate_stop = attempt(['-m', 'immediate', '-w', 'stop']);
      r.state_after_immediate = state();
    }
    r.server = r.state_after_immediate ?? r.state_after_graceful;
  } else {
    r.server = 'not started';
  }
  r.server_confirmed_stopped = r.server === 'stopped' || r.server === 'not started';
  if (r.server_confirmed_stopped) {
    try { removeDir(tempDir); } catch (e) { r.remove_error = e.message; }
    r.dir_removed = !dirExists(tempDir);
  } else {
    r.dir_removed = false;
    r.dir_preserved = dataDir; // never delete the data directory of a server that may still be running
  }
  r.ok = r.server_confirmed_stopped && r.dir_removed;
  return r;
}
