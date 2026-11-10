# Supabase security advisor, meridian-g1-validation (run 2026-11-07 18:55 UTC, after all 9 migrations)

| Lint | Level | Count | Disposition |
|---|---|---|---|
| 0008 rls_enabled_no_policy: `public.installation_settings` | INFO | 1 | Intended. Server-only singleton; no client access at all (SEC-INV-04) |
| 0011 function_search_path_mutable: `qa.*` | WARN | 14 | Test harness only (`tests/sql/00_harness.sql`), not in migrations, schema not exposed by the API. Drop `qa` before any real use. All `public` functions pin `search_path` (SEC-FN-03) |
| 0029 authenticated_security_definer_function_executable | WARN | 8 | Intended RPCs: create_workspace, get_current_business_id, get_available_cash, get_account_balances, reverse_transaction, reverse_payment_allocation, revoke_funding_commitment, commit_import_batch. Each checks membership itself (SEC-TEN-09/10, SEC-FN-01, CSV-31) |
| auth_leaked_password_protection | WARN | 1 | Auth setting, not schema. Founder decision (plan-dependent) before production |
