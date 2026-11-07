// Create the four disposable Gate 1 test users through the Supabase Auth Admin API.
//   node tests/http/provision-users.mjs --project <ref>
// Run ONCE on a fresh validation project, before tests/sql/01_fixtures.sql.
// Safety: refuses unless --project matches SUPABASE_URL, and refuses (creating nothing) if any
// of the test emails already exists. Passwords are random and never printed or stored;
// tests/http/run.mjs sets fresh ones on every run. Never writes to auth tables with SQL.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(readFileSync(join(repo, '.env'), 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const URL_ = env.SUPABASE_URL, PUB = env.SUPABASE_ANON_KEY, SR = env.SUPABASE_SERVICE_ROLE_KEY;
const fail = msg => { console.error(`REFUSED: ${msg}`); process.exit(1); };
if (!URL_ || !PUB || !SR) fail('.env needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY');
const ref = new URL(URL_).hostname.split('.')[0];
const want = process.argv[process.argv.indexOf('--project') + 1];
if (!process.argv.includes('--project') || want !== ref) fail(`pass --project ${ref} to confirm the target (SUPABASE_URL points at ${ref})`);

const TEST_USERS = [
  { key: 'a', id: '00000000-0000-4000-8000-0000000000a1', email: 'founder.a@meridian.test' },
  { key: 'b', id: '00000000-0000-4000-8000-0000000000b2', email: 'founder.b@meridian.test' },
  { key: 'c', id: '00000000-0000-4000-8000-0000000000c3', email: 'stranger.c@meridian.test' },
  { key: 'd', id: '00000000-0000-4000-8000-0000000000d4', email: 'latecomer.d@meridian.test' },
];
const admin = { apikey: SR, ...(SR.startsWith('eyJ') ? { Authorization: `Bearer ${SR}` } : {}), 'Content-Type': 'application/json' };

// 1. nothing may exist yet
const list = await fetch(`${URL_}/auth/v1/admin/users?page=1&per_page=1000`, { headers: admin });
if (!list.ok) fail(`could not list users (${list.status} ${await list.text()})`);
const existing = ((await list.json()).users || []).filter(u => TEST_USERS.some(t => t.email === u.email || t.id === u.id));
if (existing.length) fail(`test users already exist, nothing created: ${existing.map(u => u.email).join(', ')}`);

// 2. create, confirmed, through Auth
let created = 0;
for (const t of TEST_USERS) {
  const password = randomBytes(24).toString('base64url');
  const r = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ id: t.id, email: t.email, password, email_confirm: true, user_metadata: { meridian_test_user: true } }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) fail(`creating ${t.email} returned ${r.status} ${JSON.stringify(body)}; ${created} of 4 were created before this`);
  created++;
  // 3. prove password sign-in works for the user Auth just created
  const s = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: t.email, password }),
  });
  console.log(`created ${t.email.padEnd(28)} id ${body.id}${body.id === t.id ? '' : ' (Auth chose this id)'}  confirmed ${!!body.email_confirmed_at}  sign-in ${s.status}`);
  if (!s.ok || !body.email_confirmed_at) fail(`${t.email} was created but cannot sign in with a password (${s.status})`);
}
console.log(`OK: 4 test users provisioned on ${ref}. Next: tell Gavin, who runs tests/sql/01_fixtures.sql onwards.`);
