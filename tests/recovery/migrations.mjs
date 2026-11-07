// R-00: the repository must hold exactly the approved migrations, byte for byte.
// Returns the verified bytes (so the drill applies exactly what was hashed) and every problem found.
// Self-test: node tests/recovery/migrations.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const EXPECTED_COUNT = 9;
const sha = b => createHash('sha256').update(b).digest('hex');

export function parseManifest(text) {
  return text.split(/\r?\n/).filter(Boolean).map(l => {
    const m = l.match(/^([0-9a-f]{64}) [ *](\d{14}_[a-z0-9_]+\.sql)$/);
    if (!m) throw new Error(`bad manifest line: ${l}`);
    return { file: m[2], sha256: m[1] };
  });
}

export function verifyMigrations(dir, manifestText) {
  const problems = [];
  let approved = [];
  try { approved = parseManifest(manifestText); } catch (e) { problems.push(e.message); }
  if (new Set(approved.map(a => a.file)).size !== approved.length) problems.push('manifest lists a file twice');
  const onDisk = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const files = onDisk.map(f => { const bytes = readFileSync(join(dir, f)); return { file: f, sha256: sha(bytes), bytes }; });
  if (approved.length !== EXPECTED_COUNT) problems.push(`manifest lists ${approved.length} files, expected ${EXPECTED_COUNT}`);
  if (onDisk.length !== EXPECTED_COUNT) problems.push(`repository holds ${onDisk.length} .sql files, expected ${EXPECTED_COUNT}`);
  for (const a of approved) {
    const m = files.find(x => x.file === a.file);
    if (!m) problems.push(`missing ${a.file}`);
    else if (m.sha256 !== a.sha256) problems.push(`${a.file} sha256 ${m.sha256} differs from approved ${a.sha256}`);
  }
  for (const m of files) if (!approved.some(a => a.file === m.file)) problems.push(`unapproved file ${m.file}`);
  return { files, problems };
}
