# Meridian V1 Engineering Specification (Rev 2.3.4, Gate 1)

Status: **Gate 1 foundation**, reconciled from Rev 2.2 (validated 7 Nov 2026), the Rev 2.3.3 static review
and the Gate 1 handoff. This document describes what the migrations in `supabase/migrations/` actually do.
Where the SQL and this text disagree, the SQL wins and this document is wrong.

## 1. Locked decisions (unchanged)

| Decision | How the foundation honours it |
|---|---|
| Single currency per business | `businesses.base_currency char(3)` only; no currency column anywhere below it; immutable by trigger for every role |
| One workspace per installation, `business_id` everywhere | `installation_settings.max_workspaces` (default 1); every tenant table carries `business_id` and composite FKs `(business_id, id)` |
| Vanilla HTML/CSS/JS ES modules, Supabase, modular monolith | No UI in Gate 1. Server logic lives in Postgres (RLS, triggers, RPCs) and one PHP connector |
| No AI, multi-user, multi-currency/FX, wallets, banking | None present. One founder per workspace (`businesses.created_by_user_id UNIQUE`) |
| Manual entry and CSV only | `transactions` (manual) and `import_batches` / `import_batch_rows` (CSV). No bank feeds |
| Storage provider abstraction | `documents.storage_provider` ∈ `supabase_storage`, `external_connector`, `google_drive` |
| Forward-only migrations with a verified recovery point | No down migrations. Recovery = rebuild from repo migrations + `pg_dump` data + storage copy (§9) |

## 2. Architecture

```
Browser (vanilla ES modules, Gate 2+)
   │ supabase-js: Auth, PostgREST, Storage — always as `authenticated`
   ▼
Supabase ── Postgres: RLS + column grants + triggers + SECURITY DEFINER RPCs   (the trust boundary)
   │        Storage: bucket company-vault, folder = business_id
   │        Edge Functions (Gate 2+): service_role, server-only work
   ▼
Founder hosting ── meridian-vault-connector.php (HMAC-signed HTTPS), optional
```

The browser is untrusted. Every rule that protects money or tenancy is enforced in Postgres, so it holds
no matter which client (supabase-js, curl, a modified page) sends the request.

### Module boundaries (one schema, grouped by migration)

| Module | Migration | Tables |
|---|---|---|
| Tenancy and privileges | `…181941_tenancy_and_privileges` | businesses, profiles, participants, activity_records, installation_settings |
| Operations | `…182033_operations` | contacts, projects, project_contacts, contact_interactions, milestones, tasks, subtasks, decisions, decision_options, calendar_events |
| Capital and funding | `…182116_capital_and_funding` | capital_structures, capital_targets, participant_capital_allocations, funding_requirements, funding_commitments |
| Ledger | `…182311_ledger` | financial_accounts, financial_categories, transactions, payment_allocations, recurring_transactions |
| CSV import | `…182410_csv_import` | import_batches, import_batch_rows |
| Vault and integrations | `…182442_vault_and_integrations` | documents, document_links, integration_connections; bucket `company-vault` |
| Hardening | `…182518`, `…183130`, `…183617` | search_path pinning, PUBLIC EXECUTE closed, cash result scale |

Modules reference each other only by FK; cross-module behaviour (activity, reversal cascade) is in triggers.

## 3. Tenancy and access model

- **Onboarding** only through `create_workspace(...)` (SECURITY DEFINER). It locks the business table,
  enforces one workspace per user and the installation limit, then creates the business, the profile and the
  founder participant together. Clients have no INSERT on `businesses` or `profiles`.
- **Membership** is `profiles.business_id`; `get_current_business_id()` (SQL, SECURITY DEFINER, `search_path ''`)
  reads it for `auth.uid()`. Every tenant policy is `business_id = get_current_business_id()`.
- **Profile ownership**: a profile's `id`, `business_id` and founder flag are immutable for every role
  (`guard_profile_identity`); clients can update only cosmetic columns.
- **No GUC boundary.** Nothing reads `current_setting('app.*')`. State that clients must not forge is either
  derived in a view or writable only by SECURITY DEFINER code.
- **Roles**:
  - `anon`: no privilege on any public table, view or function.
  - `authenticated`: column-scoped grants, RLS forced on every table.
  - `service_role`: bypasses RLS, but has no DELETE/TRUNCATE on financial history and is still stopped by the
    immutability triggers; it uses `get_available_cash_for_business(p_business_id, p_as_of)`.
  - `postgres` (migrations): owner. Needs BYPASSRLS, which Supabase grants it.
- **Default privileges**: Supabase's `anon`/`authenticated` defaults are revoked, and PUBLIC EXECUTE on new
  functions is closed globally. Every function postgres creates from now on needs an explicit GRANT.

## 4. Financial model and invariants

| # | Invariant | Enforced by |
|---|---|---|
| F1 | A pledge is not money | Commitment "received" = sum of live allocations of real receipts |
| F2 | Commitment status is derived, never stored | `vw_funding_commitment_status`: `revoked` / `over_allocated` / `fulfilled` / `partially_paid` / `pledged` |
| F3 | Partial and multiple payments | `payment_allocations` many-to-many between receipts and commitments |
| F4 | A receipt cannot be allocated beyond its amount, even under concurrency | `guard_allocation_insert` takes `FOR UPDATE` on the transaction and the commitment, then re-sums |
| F5 | Only eligible money satisfies a commitment | contribution type and participant must match (founder money ≠ cofounder commitment; revenue ≠ funding) |
| F6 | Transactions are append-only | financial columns immutable for all roles (`guard_transaction_update`); corrections = reversal + new transaction (`replaces_transaction_id`) |
| F7 | Reversal is final and cascades | `reverse_transaction(id, reason)` → `cascade_transaction_reversal` reverses live allocations and logs the count; un-reversal impossible |
| F8 | Allocated history is protected | no DELETE on transactions, allocations or commitments for any role (trigger even for the owner); a commitment with received money cannot be revoked until its allocations are reversed |
| F9 | Over-allocation is visible | target and structure summary views report `over_allocated_by` and gaps; nothing is silently capped |
| F10 | Cash is as-of a date | `get_available_cash(p_as_of default business-local today)`: opening balance from `opening_balance_date`, transactions with `opening ≤ date ≤ as_of`, transfers neutral, escrow excluded, credit draws included |
| F11 | Reimbursements and founder loans are tracked separately from capital | `settles_transaction_id` with remaining-balance checks; `vw_settlement_status`, `vw_participant_contribution_summary` |
| F12 | CSV import is validated, duplicate-aware and atomic | server-side parse in `prepare_import_row`; `commit_import_batch` refuses invalid rows, undecided duplicates, re-imports of the same file and double replaces, and writes all rows or none |

## 5. RPC contracts (callable by `authenticated` unless noted)

| Function | Contract |
|---|---|
| `create_workspace(p_business_name, p_base_currency, p_locale, p_timezone, p_full_name, p_financial_year_start_month = 4) → uuid` | One per user, within `max_workspaces`. Currency upper-cased and then fixed |
| `get_available_cash(p_as_of date = NULL) → numeric(15,2)` | Caller's business only; NULL = today in the business timezone |
| `get_account_balances(p_as_of date = NULL)` | Per-account balances, same rules |
| `get_available_cash_for_business(p_business_id, p_as_of) → numeric(15,2)` | **service_role only** |
| `reverse_transaction(p_transaction_id, p_reason)` | Reason required; cascades to allocations; refused for settled reimbursables |
| `reverse_payment_allocation(p_allocation_id, p_reason)` | Reason required; final |
| `revoke_funding_commitment(p_commitment_id, p_reason)` | Reason required; refused while live allocations exist |
| `commit_import_batch(p_batch_id) → json` | Atomic; returns imported/skipped/replaced counts |

All are SECURITY DEFINER with `search_path = ''`, check membership themselves, and write activity records.

## 6. Activity ledger

`activity_records` is append-only (no UPDATE or DELETE for anyone, trigger-enforced) and has **no client
INSERT**. It is written only by SECURITY DEFINER triggers on projects, milestones, tasks, decisions and
finance, and by the RPCs. `actor_type`/`actor_id` come from `auth.uid()`, never from the client.

## 7. Company Vault and storage providers

- **Record of truth**: `documents` (provider, `storage_key` under `{business_id}/`, sha256 required, archive
  only, no delete) and `document_links` (exactly one target).
- **Supabase Storage**: private bucket `company-vault`, 50 MB, first folder must equal the caller's business id
  (text comparison). Clients get read and insert only: no overwrite and no delete. Deletion is server-only
  through the Storage API with service_role (Supabase blocks direct SQL deletes from `storage.objects`).
- **External connector**: `connector/meridian-vault-connector.php`, protocol MERIDIAN-V1 (see
  `connector/README.md`): HMAC-SHA256 signature over method, path, body sha256, length, timestamp and nonce;
  ±300 s window; nonce store; key rotation; per-business scopes; strict paths; link refusal; atomic
  no-clobber publish with hash verification; HTTPS required. The connector is called only by server code.
  TLS 1.2+ (1.3 preferred) is configured at the host. **FTP is a deployment channel, not a storage API.**
- **Google Drive**: enum value and `integration_connections` row shape exist; integration deferred.
  OAuth tokens go in Supabase Vault (`vault_secret_id`, which clients cannot select).

## 8. Migration strategy

- Supabase CLI layout, timestamped, forward-only, each file one transaction. Apply as `postgres`, never as
  `supabase_admin` (that would bring back Supabase's anon defaults on new objects).
- A defect is fixed by a new migration, never by editing an applied one (migrations 8 and 9 are examples).
- Before each production migration: take a recovery point (§9) and keep it until the next one is verified.

## 9. Recovery strategy

Recovery point = repo at a commit + `pg_dump --data-only` of `public.*`, `auth.users`, `auth.identities`,
`storage.objects` + a copy of vault bytes. Restore (scripted in `tests/recovery/drill.mjs`):

1. new empty project;
2. apply the repo's migrations in order;
3. restore data in one transaction with `session_replication_role = replica`, so guard and activity triggers do
   not re-fire on history;
4. copy stored files and verify each sha256;
5. compare full-row fingerprints, finance figures and the security posture (`tests/recovery/reconcile.sql`)
   with the source.

Replica mode bypasses the guard triggers, so a restore may only load a dump taken from a verified Meridian
source. Never hand-edit a dump.

## 10. Testing

| Layer | Location | Runs as |
|---|---|---|
| SQL (security, finance, cash, CSV, concurrency) | `tests/sql/*.sql` | MCP or psql, impersonating roles through `request.jwt.claims` |
| HTTP (PostgREST, Storage API, real parallel requests, service role) | `tests/http/run.mjs` | founder, with the service key in `.env` |
| Connector | `tests/connector/run.php` | local `php -S` |
| Recovery | `tests/recovery/drill.mjs` | founder, with database URLs in `.env` |
