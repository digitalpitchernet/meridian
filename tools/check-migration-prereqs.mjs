// Read-only preflight check for Migration 10 (20261127000000_task_execution_slice.sql).
// Verifies the local migration chain and, when TEST_SUPABASE_URL + TEST_SUPABASE_ANON_KEY are set,
// probes PostgREST read-only (using anon/publishable key only; no service-role key required).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');

const EXPECTED_BASELINE = [
  '20261107181941_tenancy_and_privileges.sql',
  '20261107182033_operations.sql',
  '20261107182116_capital_and_funding.sql',
  '20261107182311_ledger.sql',
  '20261107182410_csv_import.sql',
  '20261107182442_vault_and_integrations.sql',
  '20261107182518_pin_function_search_path.sql',
  '20261107183130_close_function_default_execute.sql',
  '20261107183617_cash_result_scale.sql',
  '20261127000000_task_execution_slice.sql',
];

const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
const missing = EXPECTED_BASELINE.filter(f => !files.includes(f));
if (missing.length) {
  console.error(`Missing migration file(s): ${missing.join(', ')}`);
  process.exit(1);
}

const m1 = readFileSync(join(MIGRATIONS_DIR, '20261107181941_tenancy_and_privileges.sql'), 'utf8');
const m2 = readFileSync(join(MIGRATIONS_DIR, '20261107182033_operations.sql'), 'utf8');
const m10 = readFileSync(join(MIGRATIONS_DIR, '20261127000000_task_execution_slice.sql'), 'utf8');

const prereqs = [
  ['participants(business_id, id) unique constraint in M1', /CONSTRAINT\s+uq_participants_business\s+UNIQUE\s*\(business_id,\s*id\)/i.test(m1)],
  ['log_activity() helper in M1', /CREATE\s+FUNCTION\s+public\.log_activity\(/i.test(m1)],
  ['tasks table in M2', /CREATE\s+TABLE\s+public\.tasks\s*\(/i.test(m2)],
  ['tasks_tenant RLS policy in M2', /CREATE\s+POLICY\s+%1\$s_tenant|tasks_tenant/i.test(m2)],
  ['migration 10 adds assigned_to_participant_id', /ADD\s+COLUMN\s+assigned_to_participant_id\s+uuid/i.test(m10)],
];

let failed = false;
for (const [label, ok] of prereqs) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);

const url = process.env.TEST_SUPABASE_URL;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
if (url && anonKey) {
  const base = url.replace(/\/+$/, '');
  try {
    const authRes = await fetch(`${base}/auth/v1/settings`, { headers: { apikey: anonKey } });
    console.log(`${authRes.ok ? 'PASS' : 'FAIL'} GoTrue /auth/v1/settings reachable (${authRes.status})`);
    if (!authRes.ok) process.exit(1);

    const colRes = await fetch(`${base}/rest/v1/tasks?select=assigned_to_participant_id&limit=0`, {
      headers: { apikey: anonKey },
    });
    if (colRes.status === 200 || colRes.status === 401 || colRes.status === 403) {
      console.log(`INFO tasks.assigned_to_participant_id probe returned HTTP ${colRes.status} (note: 400/42703 indicates migration 10 not yet applied)`);
    } else {
      console.log(`INFO tasks.assigned_to_participant_id not yet exposed or denied (HTTP ${colRes.status})`);
    }
  } catch (err) {
    console.error(`FAIL Remote preflight error: ${err.message}`);
    process.exit(1);
  }
} else {
  console.log('INFO Remote probe skipped (set TEST_SUPABASE_URL and TEST_SUPABASE_ANON_KEY to probe a validation project)');
}
