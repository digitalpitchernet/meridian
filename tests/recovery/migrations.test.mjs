// Self-test for migrations.mjs: node tests/recovery/migrations.test.mjs
// Uses the real repository and a throwaway copy in the OS temp folder; the repository is never modified.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMigrations } from './migrations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const real = join(here, '..', '..', 'supabase', 'migrations');
const manifest = readFileSync(join(here, 'approved-migrations.sha256'), 'utf8');

// 1. the committed repository matches the committed manifest
{ const r = verifyMigrations(real, manifest); assert.deepEqual(r.problems, []); assert.equal(r.files.length, 9); }

const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'mig-')); cpSync(real, d, { recursive: true }); return d; };
const first = manifest.split('\n')[0].split(/ [ *]/)[1];
const cases = [
  ['one changed byte', d => appendFileSync(join(d, first), ' '), /differs from approved/],
  ['a missing file', d => rmSync(join(d, first)), /missing .*expected|missing/],
  ['an extra unapproved file', d => writeFileSync(join(d, '20991231000000_extra.sql'), 'select 1;'), /unapproved file 20991231000000_extra\.sql/],
];
for (const [label, mutate, re] of cases) {
  const d = scratch();
  try { mutate(d); const r = verifyMigrations(d, manifest); assert.ok(r.problems.some(p => re.test(p)), `${label}: ${JSON.stringify(r.problems)}`); }
  finally { rmSync(d, { recursive: true, force: true }); }
}
// 2. manifest problems: wrong count, duplicate entry, malformed line
const lines = manifest.split('\n').filter(Boolean);
assert.ok(verifyMigrations(real, lines.slice(0, 8).join('\n')).problems.some(p => /manifest lists 8 files/.test(p)));
assert.ok(verifyMigrations(real, [...lines, lines[0]].join('\n')).problems.some(p => /twice/.test(p)));
assert.ok(verifyMigrations(real, `${lines.join('\n')}\nnot a manifest line`).problems.some(p => /bad manifest line/.test(p)));
// 3. CRLF manifest is read the same as LF
assert.deepEqual(verifyMigrations(real, lines.join('\r\n')).problems, []);

console.log('migrations.mjs: all assertions passed');
