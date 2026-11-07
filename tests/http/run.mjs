// HTTP validation against the hosted Gate 1 project: PostgREST, Storage API, parallel
// allocations and service-role semantics.  Node 20+, no dependencies.
//   1. copy .env.example to .env and fill SUPABASE_SERVICE_ROLE_KEY (never commit it)
//   2. node tests/http/run.mjs
// It sets fresh random passwords on the SQL fixture users (they are never printed), signs
// in through GoTrue, and writes evidence/http-results.json. Safe to re-run.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(readFileSync(join(repo, '.env'), 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const URL_ = env.SUPABASE_URL, PUB = env.SUPABASE_ANON_KEY, SR = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !PUB || !SR) { console.error('.env needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }

const USERS = {
  a: { id: '00000000-0000-4000-8000-0000000000a1', email: 'founder.a@meridian.test' },
  b: { id: '00000000-0000-4000-8000-0000000000b2', email: 'founder.b@meridian.test' },
  c: { id: '00000000-0000-4000-8000-0000000000c3', email: 'stranger.c@meridian.test' },
};
const BIZ_A = '3dbab4a5-bd5d-4d1c-a6a6-639bbebd4853', BIZ_B = '40458d24-cfad-4fc5-9a01-b38447b8ad62';
const ACCT_A = 'e175c620-5da5-409d-bf91-9d19453a7021'; // 'Bridge escrow-free account' from 21_concurrency part 1
const RUN = new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + randomBytes(3).toString('hex');
const sha = b => createHash('sha256').update(b).digest('hex');

const srHeaders = () => ({ apikey: SR, ...(SR.startsWith('eyJ') ? { Authorization: `Bearer ${SR}` } : {}) });
const as = who => who === 'anon' ? { apikey: PUB } : who === 'service' ? srHeaders() : { apikey: PUB, Authorization: `Bearer ${tokens[who]}` };

async function call(who, method, path, body, extra = {}) {
  const isBin = body instanceof Uint8Array;
  const res = await fetch(URL_ + path, {
    method,
    headers: { ...as(who), ...(body !== undefined && !isBin ? { 'Content-Type': 'application/json' } : {}), ...extra },
    body: body === undefined ? undefined : isBin ? body : JSON.stringify(body),
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(new TextDecoder().decode(buf)); } catch { /* binary */ }
  return { status: res.status, json, buf };
}
const rest = (who, method, path, body, extra) => call(who, method, '/rest/v1/' + path, body, { Prefer: 'return=representation', ...extra });
const rpc = (who, fn, args) => call(who, 'POST', '/rest/v1/rpc/' + fn, args);

const results = [];
function record(id, desc, ok, expected, actual) {
  results.push({ test_id: id, description: desc, status: ok ? 'PASS' : 'FAIL', expected, actual });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id.padEnd(12)} ${desc}  [${actual}]`);
}
const brief = r => `${r.status} ${r.json ? JSON.stringify(r.json).slice(0, 140) : r.buf.length + ' bytes'}`;
const denied = r => r.status === 401 || r.status === 403 || (r.json && r.json.code === '42501');
const emptyOrDenied = r => denied(r) || (r.status === 200 && Array.isArray(r.json) && r.json.length === 0);

// ---- auth setup ----
const tokens = {};
for (const [k, u] of Object.entries(USERS)) {
  const pw = randomBytes(24).toString('base64url');
  const up = await call('service', 'PUT', `/auth/v1/admin/users/${u.id}`, { password: pw, email_confirm: true });
  const si = await call('anon', 'POST', '/auth/v1/token?grant_type=password', { email: u.email, password: pw });
  tokens[k] = si.json?.access_token;
  record(`H-AUTH-0${Object.keys(tokens).length}`, `user ${k} signs in through GoTrue`, up.status === 200 && !!tokens[k], '200 + token', `${up.status}/${si.status}`);
}
if (!tokens.a || !tokens.b) { console.error('sign-in failed; stopping'); process.exit(1); }

// ---- anon ----
record('H-ANON-01', 'anon cannot read businesses', emptyOrDenied(await rest('anon', 'GET', 'businesses?select=id')), 'denied or []', brief(await rest('anon', 'GET', 'businesses?select=id')));
let r = await rest('anon', 'POST', 'contacts', { business_id: BIZ_A, first_name: 'anon' });
record('H-ANON-02', 'anon cannot insert', denied(r), '401/403', brief(r));
r = await rpc('anon', 'create_workspace', { p_business_name: 'x', p_base_currency: 'INR', p_locale: 'en-IN', p_timezone: 'Asia/Kolkata', p_full_name: 'x' });
record('H-ANON-03', 'anon cannot call create_workspace', denied(r), '401/403', brief(r));
r = await rpc('anon', 'get_available_cash', {});
record('H-ANON-04', 'anon cannot call get_available_cash', denied(r), '401/403', brief(r));

// ---- tenant isolation ----
r = await rest('a', 'GET', 'businesses?select=id');
record('H-TEN-01', 'founder A sees only business A', r.status === 200 && r.json.length === 1 && r.json[0].id === BIZ_A, `[${BIZ_A}]`, brief(r));
r = await rest('a', 'GET', `transactions?select=id&business_id=eq.${BIZ_B}`);
record('H-TEN-02', 'founder A reads no transactions of business B', r.status === 200 && r.json.length === 0, '[]', brief(r));
r = await rest('a', 'POST', 'contacts', { business_id: BIZ_B, first_name: 'Intruder' });
record('H-TEN-03', 'founder A cannot insert into business B', denied(r), '403 42501', brief(r));
r = await rest('a', 'PATCH', `businesses?id=eq.${BIZ_B}`, { business_name: 'Hijacked' });
record('H-TEN-04', 'founder A cannot rename business B', r.status === 200 && r.json.length === 0, '0 rows', brief(r));
r = await rest('c', 'GET', 'transactions?select=id');
record('H-TEN-05', 'user without a workspace reads nothing', r.status === 200 && r.json.length === 0, '[]', brief(r));
r = await rest('b', 'GET', `documents?select=id&business_id=eq.${BIZ_A}`);
record('H-TEN-06', 'founder B reads no documents of business A', r.status === 200 && r.json.length === 0, '[]', brief(r));

// ---- financial writes through PostgREST ----
r = await rest('a', 'POST', 'transactions', { business_id: BIZ_A, account_id: ACCT_A, transaction_date: '2026-08-03', amount: 100, type: 'expense', description: `http ${RUN}` });
const tx = r.json?.[0]?.id;
record('H-FIN-01', 'founder A records an expense', r.status === 201 && !!tx, '201', brief(r));
r = await rest('a', 'PATCH', `transactions?id=eq.${tx}`, { amount: 1 });
record('H-COL-01', 'transaction amount cannot be edited', denied(r), '42501', brief(r));
r = await rest('a', 'PATCH', `transactions?id=eq.${tx}`, { is_reversed: true });
record('H-COL-02', 'is_reversed cannot be set directly (only by the RPC)', denied(r), '42501', brief(r));
r = await rest('a', 'PATCH', `businesses?id=eq.${BIZ_A}`, { base_currency: 'USD' });
record('H-COL-03', 'base currency cannot be changed', denied(r), '42501', brief(r));
r = await rest('a', 'GET', 'integration_connections?select=id,vault_secret_id');
record('H-COL-04', 'vault_secret_id is not readable', denied(r), '42501', brief(r));
r = await rest('a', 'POST', 'transactions', { business_id: BIZ_A, account_id: ACCT_A, transaction_date: '2026-08-03', amount: 100, type: 'expense', description: 'forged', is_reversed: true });
record('H-COL-05', 'a transaction cannot be inserted already reversed', denied(r), '42501', brief(r));
r = await rest('a', 'DELETE', `transactions?id=eq.${tx}`);
record('H-DEL-01', 'transactions cannot be deleted', denied(r), '42501', brief(r));
r = await rest('a', 'POST', 'activity_records', { business_id: BIZ_A, actor_type: 'user', event_type: 'x', entity_table: 'x', entity_id: BIZ_A, summary: 'forged' });
record('H-ACT-01', 'clients cannot write activity records', denied(r), '42501', brief(r));
r = await rest('a', 'DELETE', `activity_records?business_id=eq.${BIZ_A}`);
record('H-DEL-02', 'activity records cannot be deleted', denied(r), '42501', brief(r));
r = await rpc('a', 'reverse_transaction', { p_transaction_id: tx, p_reason: `http test ${RUN}` });
record('H-FIN-02', 'reversal through the RPC succeeds', r.status === 200 || r.status === 204, '200/204', brief(r));
r = await rest('a', 'GET', `transactions?select=is_reversed&id=eq.${tx}`);
record('H-FIN-03', 'the transaction now reads as reversed', r.json?.[0]?.is_reversed === true, 'true', brief(r));
r = await rest('a', 'GET', `activity_records?select=event_type&entity_id=eq.${tx}`);
record('H-ACT-02', 'the reversal left a server-written activity record', r.status === 200 && r.json.length >= 1, '>= 1 row', brief(r));
r = await rpc('a', 'reverse_transaction', { p_transaction_id: tx, p_reason: 'again' });
record('H-FIN-04', 'a reversed transaction cannot be reversed again', r.status >= 400, '4xx', brief(r));
r = await rest('a', 'POST', 'vw_funding_commitment_status', { status: 'fulfilled' });
record('H-FIN-05', 'derived commitment status cannot be written', r.status >= 400, '4xx', brief(r));
r = await rpc('a', 'get_available_cash', {});
record('H-FIN-06', 'get_available_cash returns a 2-decimal amount', r.status === 200 && /^-?\d+\.\d{2}$/.test(String(r.json)), 'n.nn', brief(r));
r = await rpc('a', 'get_available_cash_for_business', { p_business_id: BIZ_B });
record('H-FN-01', 'founder cannot call the service-only cash function', denied(r) || r.status === 404, '401/403/404', brief(r));

// ---- concurrency: two allocations of 4000 race for one 5000 receipt, 10 rounds ----
r = await rest('a', 'POST', 'funding_requirements', { business_id: BIZ_A, title: `Race ${RUN}`, required_amount: 100000 });
const req = r.json?.[0]?.id;
let clean = 0, detail = [];
for (let i = 0; i < 10 && req; i++) {
  const c = (await rest('a', 'POST', 'funding_commitments', { business_id: BIZ_A, requirement_id: req, funder_name: `Racer ${i}`, committed_amount: 10000 })).json?.[0]?.id;
  const t = (await rest('a', 'POST', 'transactions', { business_id: BIZ_A, account_id: ACCT_A, transaction_date: '2026-08-04', amount: 5000, type: 'income', contribution_type: 'third_party_equity', description: `race ${RUN} ${i}` })).json?.[0]?.id;
  const body = { business_id: BIZ_A, commitment_id: c, transaction_id: t, amount: 4000 };
  const [x, y] = await Promise.all([rest('a', 'POST', 'payment_allocations', body), rest('a', 'POST', 'payment_allocations', body)]);
  const live = (await rest('a', 'GET', `payment_allocations?select=amount&transaction_id=eq.${t}&is_reversed=eq.false`)).json || [];
  const ok = [x, y].filter(q => q.status === 201).length === 1 && [x, y].some(q => q.json?.code === '23514') && live.length === 1;
  if (ok) clean++;
  detail.push(`${x.status}/${y.status}/${live.length}`);
}
record('H-CONC-01', 'parallel allocations: exactly one wins in every round', clean === 10, '10/10', `${clean}/10 ${detail.join(' ')}`);

// ---- Storage API ----
const bytes = new Uint8Array(randomBytes(4096));
const keyA = `${BIZ_A}/http/${RUN}.bin`;
r = await call('a', 'POST', `/storage/v1/object/company-vault/${keyA}`, bytes, { 'Content-Type': 'application/octet-stream' });
record('H-STO-01', 'founder A uploads into the business A folder', r.status === 200, '200', brief(r));
r = await call('a', 'GET', `/storage/v1/object/authenticated/company-vault/${keyA}`);
record('H-STO-02', 'download returns identical bytes', r.status === 200 && sha(r.buf) === sha(bytes), sha(bytes).slice(0, 12), `${r.status} ${sha(r.buf).slice(0, 12)}`);
r = await call('a', 'POST', `/storage/v1/object/company-vault/${BIZ_B}/http/${RUN}.bin`, bytes, { 'Content-Type': 'application/octet-stream' });
record('H-STO-03', 'founder A cannot upload into business B', r.status >= 400, '4xx', brief(r));
r = await call('b', 'GET', `/storage/v1/object/authenticated/company-vault/${keyA}`);
record('H-STO-04', 'founder B cannot download business A objects', r.status >= 400, '4xx', brief(r));
r = await call('anon', 'GET', `/storage/v1/object/authenticated/company-vault/${keyA}`);
record('H-STO-05', 'anon cannot download', r.status >= 400, '4xx', brief(r));
r = await call('anon', 'GET', `/storage/v1/object/public/company-vault/${keyA}`);
record('H-STO-06', 'bucket is not public', r.status >= 400, '4xx', brief(r));
r = await call('a', 'POST', `/storage/v1/object/company-vault/${keyA}`, new Uint8Array(randomBytes(10)), { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' });
const still = await call('a', 'GET', `/storage/v1/object/authenticated/company-vault/${keyA}`);
record('H-STO-07', 'founder cannot overwrite an object (no UPDATE policy)', r.status >= 400 && sha(still.buf) === sha(bytes), '4xx + unchanged', `${r.status} ${sha(still.buf) === sha(bytes) ? 'unchanged' : 'CHANGED'}`);
r = await call('a', 'DELETE', `/storage/v1/object/company-vault/${keyA}`);
const after = await call('a', 'GET', `/storage/v1/object/authenticated/company-vault/${keyA}`);
record('H-STO-08', 'founder cannot delete through the Storage API', after.status === 200 && sha(after.buf) === sha(bytes), 'object still there', `delete ${r.status}, then get ${after.status}`);
r = await call('b', 'POST', '/storage/v1/object/list/company-vault', { prefix: `${BIZ_A}/`, limit: 100 });
record('H-STO-09', 'founder B cannot list business A folder', r.status === 200 ? r.json.length === 0 : r.status >= 400, '[] or 4xx', brief(r));

// ---- service role ----
r = await rest('service', 'GET', 'businesses?select=id');
record('H-SR-01', 'service role reads across businesses (bypasses RLS)', r.status === 200 && r.json.length >= 2, '>= 2', brief(r));
r = await rest('service', 'DELETE', `transactions?id=eq.${tx}`);
record('H-SR-02', 'service role cannot delete transactions', r.status >= 400, '4xx', brief(r));
r = await rest('service', 'PATCH', `transactions?id=eq.${tx}`, { amount: 1 });
record('H-SR-03', 'service role cannot alter a transaction amount', r.status >= 400, '4xx', brief(r));
r = await rest('service', 'DELETE', `activity_records?business_id=eq.${BIZ_A}`);
record('H-SR-04', 'service role cannot delete activity records', r.status >= 400, '4xx', brief(r));
r = await rpc('service', 'get_available_cash_for_business', { p_business_id: BIZ_A });
record('H-SR-05', 'service role can compute cash for a named business', r.status === 200 && /^-?\d+\.\d{2}$/.test(String(r.json)), 'n.nn', brief(r));
r = await rpc('service', 'create_workspace', { p_business_name: 'svc', p_base_currency: 'INR', p_locale: 'en-IN', p_timezone: 'Asia/Kolkata', p_full_name: 'svc' });
record('H-SR-06', 'service role cannot create a workspace without a user', r.status >= 400, '4xx', brief(r));
r = await call('service', 'DELETE', `/storage/v1/object/company-vault/${keyA}`);
const gone = await call('a', 'GET', `/storage/v1/object/authenticated/company-vault/${keyA}`);
record('H-SR-07', 'server-side deletion through the Storage API works', r.status === 200 && gone.status >= 400, '200 then 4xx', `${r.status} then ${gone.status}`);

const summary = results.reduce((m, x) => (m[x.status] = (m[x.status] || 0) + 1, m), {});
mkdirSync(join(repo, 'evidence'), { recursive: true });
writeFileSync(join(repo, 'evidence', 'http-results.json'), JSON.stringify({ suite: 'http', run: RUN, project: URL_, node: process.version, ran_at: new Date().toISOString(), summary, results }, null, 2) + '\n');
console.log(JSON.stringify(summary));
process.exit(summary.FAIL ? 1 : 0);
