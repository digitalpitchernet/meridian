// Durable evidence writes and API outcome classification for drill.mjs. Self-test: node tests/recovery/evidence.test.mjs
import { openSync, writeSync, fsyncSync, closeSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Write text to file so it survives a crash: temp file -> fsync -> rename over the old file -> fsync the directory.
// Returns how the directory flush went. On Windows, Node cannot open a directory for fsync (EISDIR/EPERM); NTFS
// journals the rename itself, so the result is recorded as a platform limitation, not treated as an error.
export function writeDurable(file, text) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
  try {
    const dfd = openSync(dir, 'r');
    try { fsyncSync(dfd); } finally { closeSync(dfd); }
    return 'flushed';
  } catch (e) {
    if (process.platform === 'win32') return `not supported on win32 (${e.code}); NTFS journals the rename`;
    throw e; // on POSIX a failed directory flush is a real error
  }
}

// Outcome of a state-changing API call whose effect cannot be observed independently in the moment.
//   confirmed_applied  2xx: the server says it applied the change
//   confirmed_refused  4xx: the server says it rejected the request, so nothing changed
//   outcome_unknown    no response (network error, crash, timeout), 5xx, or anything else: it may or may not have happened
export function apiOutcome({ threw = false, status = null } = {}) {
  if (threw || status === null) return 'outcome_unknown';
  if (status >= 200 && status < 300) return 'confirmed_applied';
  if (status >= 400 && status < 500) return 'confirmed_refused';
  return 'outcome_unknown';
}
