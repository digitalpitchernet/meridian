// Self-test for evidence.mjs: node tests/recovery/evidence.test.mjs (writes only to the OS temp folder)
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDurable, apiOutcome } from './evidence.mjs';

const dir = mkdtempSync(join(tmpdir(), 'meridian-evidence-'));
try {
  const f = join(dir, 'sub', 'recovery-drill.json');
  const r1 = writeDurable(f, '{"a":1}\n');                       // creates the folder
  assert.equal(readFileSync(f, 'utf8'), '{"a":1}\n');
  assert.ok(!existsSync(`${f}.tmp`), 'temp file removed by the rename');
  assert.ok(r1 === 'flushed' || (process.platform === 'win32' && /^not supported on win32/.test(r1)), r1);
  writeDurable(f, '{"a":2}\n');                                  // replaces an existing file
  assert.equal(readFileSync(f, 'utf8'), '{"a":2}\n');
  writeFileSync(`${f}.tmp`, 'stale');                            // a stale temp file from a crash is overwritten
  writeDurable(f, '{"a":3}\n');
  assert.equal(readFileSync(f, 'utf8'), '{"a":3}\n'); assert.ok(!existsSync(`${f}.tmp`));
  console.log(`writeDurable: directory flush on ${process.platform}: ${r1}`);
} finally { rmSync(dir, { recursive: true, force: true }); }

assert.equal(apiOutcome({ status: 200 }), 'confirmed_applied');
assert.equal(apiOutcome({ status: 204 }), 'confirmed_applied');
assert.equal(apiOutcome({ status: 400 }), 'confirmed_refused');
assert.equal(apiOutcome({ status: 404 }), 'confirmed_refused');
assert.equal(apiOutcome({ status: 422 }), 'confirmed_refused');
for (const s of [500, 502, 503, 504, 301, 100]) assert.equal(apiOutcome({ status: s }), 'outcome_unknown', String(s));
assert.equal(apiOutcome({ threw: true }), 'outcome_unknown');
assert.equal(apiOutcome({ threw: true, status: 200 }), 'outcome_unknown');
assert.equal(apiOutcome({}), 'outcome_unknown');

console.log('evidence.mjs: all assertions passed');
