// Self-test for migrations.mjs: node tests/recovery/migrations.test.mjs
// Uses the real repository and a throwaway copy in the OS temp folder; the repository is never modified.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMigrations, transactionHazard } from './migrations.mjs';

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

// 4. transaction control and psql meta-commands are refused; PL/pgSQL block syntax and comments are not
for (const bad of ['COMMIT;', 'commit;', '  ROLLBACK;', 'BEGIN;', 'begin transaction;', 'START TRANSACTION;', 'END TRANSACTION;',
  'SAVEPOINT a;', 'RELEASE a;', 'ABORT;', 'PREPARE TRANSACTION \'x\';', '\\q', '\\i other.sql', '\\c otherdb']) {
  assert.ok(transactionHazard(`create table t (id int);\n${bad}\nselect 1;`), bad);
}
for (const ok of ['CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$\nBEGIN\n  PERFORM 1;\nEND;\n$$;', '-- COMMIT; in a comment',
  'select 1; -- then commit later', 'create table commits (id int);', "insert into t values ('COMMIT');"]) {
  assert.equal(transactionHazard(ok), null, ok);
}
assert.equal(transactionHazard('a;\nb;\nCOMMIT;'), 'line 3: COMMIT');
{ // a file with a hazard is refused by verifyMigrations even if the manifest were regenerated to match it
  const d = scratch();
  try { appendFileSync(join(d, first), '\nCOMMIT;\n'); const r = verifyMigrations(d, manifest);
    assert.ok(r.problems.some(p => /transaction control or a psql meta-command \(line \d+: COMMIT\)/.test(p)), JSON.stringify(r.problems)); }
  finally { rmSync(d, { recursive: true, force: true }); }
}
// 5. none of the 9 approved migrations contains a hazard
for (const f of verifyMigrations(real, manifest).files) assert.equal(transactionHazard(f.bytes.toString('utf8')), null, f.file);

console.log('migrations.mjs: all assertions passed');
