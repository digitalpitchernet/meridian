// Create the four disposable Gate 1 test users through the Supabase Auth Admin API.
//   node tests/http/provision-users.mjs --project <ref>
// Run on the validation project before tests/sql/01_fixtures.sql. Safe to re-run: it never writes
// to auth tables with SQL, never deletes, and passwords are random and never printed or stored
// (tests/http/run.mjs sets fresh ones on every run).
// Safety, all checked before anything is written:
//   - --project must match SUPABASE_URL;
//   - the publishable key and the secret key must both be accepted by this project;
//   - an existing user with a test email is reused only if it has the expected id and the
//     meridian_test_user marker this script sets; anything else stops the run, creating nothing.
// Missing users are created confirmed; reused ones get a new password. Every user must then sign in.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(readFileSync(join(repo, '.env'), 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const URL_ = env.SUPABASE_URL, PUB = env.SUPABASE_ANON_KEY, SR = env.SUPABASE_SERVICE_ROLE_KEY;
// process.exit() with a pooled fetch socket open aborts Node 24 on Windows (libuv assert, exit 127),
// so a refusal throws a sentinel and lets Node exit on its own with code 1
const REFUSED = Symbol('refused');
process.on('uncaughtException', e => { if (e !== REFUSED) console.error(e); process.exitCode = 1; });
const fail = msg => { console.error(`REFUSED: ${msg}`); throw REFUSED; };
if (!URL_ || !PUB || !SR) fail('.env needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY');
const ref = new URL(URL_).hostname.split('.')[0];
const want = process.argv[process.argv.indexOf('--project') + 1];
if (!process.argv.includes('--project') || want !== ref) fail(`pass --project ${ref} to confirm the target (SUPABASE_URL points at ${ref})`);
if (PUB.startsWith('sb_secret_') || PUB === SR) fail('SUPABASE_ANON_KEY must be the publishable key, not the secret key');

const TEST_USERS = [
  { key: 'a', id: '00000000-0000-4000-8000-0000000000a1', email: 'founder.a@meridian.test' },
  { key: 'b', id: '00000000-0000-4000-8000-0000000000b2', email: 'founder.b@meridian.test' },
  { key: 'c', id: '00000000-0000-4000-8000-0000000000c3', email: 'stranger.c@meridian.test' },
  { key: 'd', id: '00000000-0000-4000-8000-0000000000d4', email: 'latecomer.d@meridian.test' },
];
const admin = { apikey: SR, ...(SR.startsWith('eyJ') ? { Authorization: `Bearer ${SR}` } : {}), 'Content-Type': 'application/json' };
// GoTrue error bodies hold error_code/msg only; request bodies (passwords) are never echoed
const reason = async r => { const t = await r.text(); try { const j = JSON.parse(t); return [j.error_code || j.code || j.error, j.msg || j.message || j.error_description].filter(Boolean).join(': ') || t.slice(0, 200); } catch { return t.slice(0, 200); } };

// 1. both keys must belong to this project (a key from another project gets 401 at the gateway)
const pubCheck = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: PUB } });
if (!pubCheck.ok) fail(`SUPABASE_ANON_KEY is not accepted by ${ref} (${pubCheck.status} ${await reason(pubCheck)}); copy the publishable key from this project's API Keys page`);
const list = await fetch(`${URL_}/auth/v1/admin/users?page=1&per_page=1000`, { headers: admin });
if (!list.ok) fail(`SUPABASE_SERVICE_ROLE_KEY is not accepted by ${ref} (${list.status} ${await reason(list)})`);

// 2. classify every test user before writing anything
const users = (await list.json()).users || [];
const plan = TEST_USERS.map(t => {
  const byEmail = users.find(u => u.email === t.email), byId = users.find(u => u.id === t.id);
  if (!byEmail && !byId) return { ...t, action: 'create' };
  if (byEmail && byEmail === byId && byEmail.user_metadata?.meridian_test_user === true) return { ...t, action: 'reuse' };
  fail(`${t.email} / ${t.id} exists but is not a user this script created (id or marker differs); nothing was changed`);
});

// 3. create or reuse, then prove password sign-in
for (const t of plan) {
  const password = randomBytes(24).toString('base64url');
  const r = t.action === 'create'
    ? await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: admin,
        body: JSON.stringify({ id: t.id, email: t.email, password, email_confirm: true, user_metadata: { meridian_test_user: true } }) })
    : await fetch(`${URL_}/auth/v1/admin/users/${t.id}`, { method: 'PUT', headers: admin,
        body: JSON.stringify({ password, email_confirm: true }) });
  if (!r.ok) fail(`${t.action} ${t.email} returned ${r.status} ${await reason(r)}; earlier users are in place, re-run to resume`);
  const body = await r.json();
  const s = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: t.email, password }),
  });
  const sWhy = s.ok ? '' : ` (${await reason(s)})`;
  console.log(`${t.action === 'create' ? 'created' : 'reused '} ${t.email.padEnd(28)} id ${body.id}  confirmed ${!!body.email_confirmed_at}  sign-in ${s.status}${sWhy}`);
  if (!s.ok || !body.email_confirmed_at) fail(`${t.email} is in place but cannot sign in with a password; fix the cause and re-run (it resumes)`);
}
console.log(`OK: 4 test users ready on ${ref}. Next: tell Gavin, who runs tests/sql/01_fixtures.sql onwards.`);
