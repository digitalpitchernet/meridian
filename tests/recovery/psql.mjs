// The exact psql invocations used by drill.mjs, shared with psql.test.mjs so the test exercises the same arguments.
import { execFileSync } from 'node:child_process';

// -X: ignore psqlrc · -q: quiet · ON_ERROR_STOP: stop at the first error. With --single-transaction, psql 15+ then
// sends ROLLBACK instead of COMMIT, so nothing from the wrapped commands is kept (PostgreSQL 17 psql docs; psql.test.mjs tests it,
// not yet executed: P-6 OPEN, see docs/RECOVERY-RUNBOOK-CHANGES.md).
export const BASE = ['-X', '-q', '-v', 'ON_ERROR_STOP=1'];

// opts: extra execFileSync options; psql.test.mjs passes { timeout }. drill.mjs passes none, so its calls are unchanged.
export function run(psqlExe, url, args, input, opts = {}) {
  return execFileSync(psqlExe, [url, ...BASE, ...args], { input, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

// R-02: one migration file (bytes on stdin, '-f -') and its history row (-c), inside ONE transaction.
// version and name come from file names R-00 has already matched against the approved manifest.
export function migrationArgs(version, name) {
  if (!/^\d{14}$/.test(version) || !/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe migration identity ${version}_${name}`);
  return ['--single-transaction', '-f', '-', '-c',
    `insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}')`];
}

// R-05: the data-only dump, in ONE transaction, with triggers (including FK triggers) in replica mode.
export function restoreArgs(dumpFile) {
  return ['--single-transaction', '-c', 'SET session_replication_role = replica', '-c', 'TRUNCATE public.installation_settings',
    '-f', dumpFile, '-c', 'SET session_replication_role = origin'];
}
