# MER-ENG-SPEC-001 Rev 2.3.3: Gavin's Static Review (input to Rev 2.3.4)

| | |
|---|---|
| Date | 7 November 2026 |
| Inputs | MER-ENG-SPEC-001 Rev 2.3.3 · MER-CHG-REG-001 Rev 2.3.3 · founder/reviewer findings of 7 Nov · my Rev 2.2 validation (`../rev-2.2/VALIDATION-REPORT.md`) |
| Method | **Read-only review of the specified SQL. Nothing was executed.** No database, repository or deployment was touched. Stage 2 is withheld, and building a validation environment is authorised only after the Rev 2.3.4 corrections. |
| Status vocabulary | "Confirmed by reading" means the defect follows directly from the SQL text. It is **not** "Disposable Database Tested". Every item here still has to be proven or disproven on a fresh project. |

## 1. Verdict

I agree with the reviewer: **withhold Stage 2 and go to Rev 2.3.4.** I confirm all 10 reviewer findings by reading the SQL. I also found **5 more P0 items** that the reviewer did not list:
- three are financial-history regressions from the behaviour I validated in Rev 2.2;
- one is a second route around the commitment state machine;
- one is a set of product-scope removals that nobody has approved.

The change register's claim of "technical closure" is not supported. Several Rev 2.2 protections that physically passed on 7 Nov have been dropped from 2.3.3.

## 2. Reviewer findings: verification

| # | Reviewer finding | My reading | Notes / additions |
|---|---|---|---|
| R-1 | **P0 Profile RLS permits tenant takeover** | **Confirmed, and worse than stated** | `profiles_insert` checks only `id = auth.uid()`. Any authenticated user with no profile can **insert** a profile pointing at any business and immediately pass every `get_current_business_id()` policy. Supabase allows self sign-up by default, so this is reachable by anyone who learns a business UUID. `profiles_update` also lets an existing member re-point `business_id`. This is a regression: the Rev 2.2 policy required `b.created_by_user_id = auth.uid()` and passed BOOT-07 on 7 Nov |
| R-2 | **P0 GUC NULL bypass** | **Confirmed** | `current_setting(name, true)` returns NULL in a session that never set it, and `''` in a pooled session where it was set and then reset. So the guard is bypassable on some connections and not others. It is also not a boundary even when it does fire: any session that can run SQL can call `set_config('app.internal_commitment_mutation','true',true)`. And once the sync trigger sets it, it stays `true` for the rest of that transaction. I agree with column privileges plus SECURITY DEFINER mutation routines |
| R-3 | **P0 committed_amount change not recalculated** | **Confirmed** | `funding_commitments` has only `trg_*_updated_at` and the immutability trigger. The sync trigger fires only on `payment_allocations`. Same defect as Rev 2.2 FIN-X4 |
| R-4 | **P0 cash has no as-of date** | **Confirmed** | Only `t.date >= a.opening_balance_date`; no upper bound. Future-dated (scheduled) transactions count as today's cash |
| R-5 | **P0 single-currency not enforced** | **Confirmed** | `financial_accounts`, `transactions`, `capital_structures` and `funding_requirements` each accept any `^[A-Z]{3}$`. Nothing ties them to `businesses.base_currency`, and `base_currency` itself is freely updatable (Rev 2.2 concern 2 again). The Rev 2.2 transaction-vs-account currency trigger was removed |
| R-6 | P1 recovery fixture FK | **Confirmed** | `businesses.created_by_user_id` and `profiles.id` both reference `auth.users`; no auth user is created. The drill also never switches to `authenticated`, so it doesn't exercise the RLS path it claims to |
| R-7 | P1 recovery coverage | **Confirmed** | It asserts cash only. No allocation, commitment-status or document-byte checks |
| R-8 | P1 connector `realpath()` | **Confirmed** | `realpath()` returns false for a not-yet-existing file, so **every new upload is rejected (403)**. It also returns false when the business directory doesn't exist yet. Additions: validate the basename (no `/`, `\`, `..`, NUL); canonicalise the parent directory, not the target. The check-then-`rename()` sequence is open to a symlink swap (TOCTOU), so the parent must be re-verified after the temp write. `str_starts_with` requires PHP ≥ 8.0, which needs confirming on Hostinger/GoDaddy |
| R-9 | P1 activity grants | **Confirmed, and worse** | The generic loop re-grants UPDATE/DELETE (the trigger still blocks those). More serious: **INSERT is granted to `authenticated` with a FOR ALL policy, so a client can forge audit events**, e.g. a fake `funding_commitments.revoked` row with `actor_type='system'`. Rev 2.2 revoked client INSERT, and SEC-04 passed on that |
| R-10 | P1 service-role cash | **Confirmed** | `auth.uid()` is NULL for service_role, so the membership check always raises |

## 3. Additional findings (not in the reviewer's list)

### P0

| ID | Finding | Evidence in 2.3.3 SQL | Proposed correction (needs Atlas) |
|---|---|---|---|
| G-01 | **Financial history can be deleted.** The loop grants `DELETE` on `transactions`, `payment_allocations` and `import_batches` to `authenticated`, and the FOR ALL policies allow it. The Rev 2.2 `prevent_financial_history_deletion` triggers were removed. `fk_tx_import_batch` and `fk_ibr_overwrite_tx` changed from RESTRICT to SET NULL, so deleting a batch silently erases provenance. A deleted allocation re-syncs status with no trace | Migration 000004 grant loop; no delete triggers | Revoke DELETE on all financial tables; restore the no-delete triggers; restore RESTRICT on provenance FKs |
| G-02 | **Reversed payments keep counting.** The `cascade_transaction_reversal` trigger is gone, so reversing a transaction no longer reverses its allocations. Worse, `enforce_payment_allocation_invariants()` raises whenever the parent transaction is reversed, even when the UPDATE is setting `is_reversed = TRUE` on the allocation. Once a transaction is reversed, its allocations **can never be reversed**, and the commitment stays `fulfilled` on money that was never received. Breaks the brief's "a pledge is not cash" | Migration 000005 | Restore the cascade; let the trigger allow `NEW.is_reversed = TRUE`; forbid un-reversing allocations (validated in Rev 2.2 FIN-03) |
| G-03 | **Commitment status can be set on INSERT.** The immutability trigger is `BEFORE UPDATE` only. A client can `INSERT … status = 'fulfilled'` (or `'revoked'`, skipping the RPC and its audit event) | Migration 000003 | Column-level INSERT grant excluding `status`/`revoked_at`/`revocation_reason`, or a BEFORE INSERT trigger forcing `pledged` |
| G-04 | **Allocated transactions are still mutable** (Rev 2.2 D-05, validated failing on 7 Nov, not addressed). Amount, type, account, participant and `is_reversed` can all be edited after allocation, so allocations can exceed their transaction, or a reversal can be undone | No transaction history-protection trigger | Rev 2.2 patch P-05 (verified 43/43) |
| G-05 | **Unapproved scope removals.** 2.3.3 silently drops requirements from the product brief and from Rev 2.2: **Google Drive** as a vault provider (the brief says it "must not be silently omitted"); **recurring transactions** (table removed; the brief lists them for Finances); decision **options / selected option / review date / related contact**; **project contacts** and **contact interactions**; **reimbursement status** (`reimbursement_status` column removed, so reimbursable founder expenses can't be tracked); the **transactional outbox** and domain-activity triggers (the Command Centre's "recent activity" now has no automatic source); task/milestone/contact links on calendar events; date/time format settings. It also introduces a new "locked" decision: **single currency per business, no multi-currency**. Rev 2.2 was built multi-currency | Table list (25 tables vs Rev 2.2's 30); §2.2 | Founder/Aurelian must explicitly approve or reject each removal. Locked decisions can't change inside an engineering revision |

### P1

| ID | Finding | Proposed correction |
|---|---|---|
| G-06 | CSV commit no longer refuses `pending` rows flagged `has_potential_duplicate`, or rows with `row_status = 'error'`, so suspected duplicates are imported silently (Rev 2.2 blocked this). Overwriting a target that has allocations leaves them on the reversed transaction (see G-02) | Restore the unresolved-duplicate/error guard; cascade allocations on overwrite or refuse targets with active allocations |
| G-07 | The privilege hardening is mostly not in the SQL. The `ALTER DEFAULT PRIVILEGES … FROM PUBLIC` statements don't affect Supabase, which grants to `anon`/`authenticated`/`service_role` by name. Nothing revokes `anon`'s SELECT/INSERT/UPDATE/DELETE on any table (only TRUNCATE). REV233-05 ("revoked all default PUBLIC permissions across all 25 tables, sequences and routines") overstates what the SQL does | Explicit `REVOKE ALL … FROM anon`; column-level grants where state is derived; default-privilege statements naming `anon`/`authenticated` (Rev 2.2 P-09, verified) |
| G-08 | `REVOKE ALL ON SCHEMA public FROM PUBLIC` may break Supabase-internal roles that rely on PUBLIC usage (storage, realtime, `authenticator`) | Must be tested on Supabase before adoption |
| G-09 | No Supabase Storage bucket or `storage.objects` policies are specified for the `supabase` provider, so Company Vault isolation is undefined | Restore the vault bucket and policies with the text comparison (Rev 2.2 P-10) |
| G-10 | `enforce_payment_allocation_invariants()` is a SECURITY DEFINER **BEFORE** trigger, so it runs before RLS `WITH CHECK`. A client inserting an allocation stamped with another business's id causes a cross-tenant `FOR UPDATE` row lock, and an error message disclosing that transaction's amount, before RLS rejects the row | Make it SECURITY INVOKER (Rev 2.2 design), or verify membership first |
| G-11 | Capital targets can no longer be linked to participant allocations (no `capital_target_id`, no currency). Rev 2.2 concern 1 has been removed, not solved | Product decision, then restore the target linkage and the target-level summary (P-02) |
| G-12 | Migrations are now forward-only. The Rev 2.2 rollback defects (D-01 to D-03) disappear only because rollback is gone; there is no stated replacement (restore-from-backup procedure, recovery-point objective, tested restore). The handover's up/down/up exit criterion needs restating | Define the rollback/restore strategy and the matching validation criterion |

### P2

| ID | Finding |
|---|---|
| G-13 | Transfer neutrality breaks when the two accounts' opening dates differ. A transfer dated before the destination's `opening_balance_date` counts as an outflow from the source only |
| G-14 | Integrity checks dropped from Rev 2.2: contribution types that require a participant; personal founder payments restricted to reimbursable/capital/loan types; `is_recurring` ⇔ rule; the activity actor check |
| G-15 | `set_updated_at()` is SECURITY DEFINER without needing to be |
| G-16 | `revoke_funding_commitment()` accepts a NULL or empty reason |
| G-17 | No adversarial RLS/financial test suite ships with 2.3.3 (§3.1 mentions pgTAP but supplies none). Only the fixture drill exists |

## 4. Recommended corrections for Rev 2.3.4 (proposal; Atlas owns the SQL)

The reviewer's 8 points plus my 5 P0 additions. Concrete shapes for the two highest-risk items:

```sql
-- R-1 profile tenancy: join only a business you created, once; never move.
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
WITH CHECK (
    id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.businesses b
                WHERE b.id = business_id AND b.created_by_user_id = auth.uid())
);
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, role_title, theme, week_start_day,
              countdown_preferences, widget_layout) ON public.profiles TO authenticated;
-- plus a BEFORE UPDATE trigger rejecting id / business_id / is_primary_founder changes (defence in depth)

-- R-2 / R-3 / G-03 commitment state: privileges are the boundary, not a GUC.
REVOKE INSERT, UPDATE ON public.funding_commitments FROM authenticated;
GRANT INSERT (business_id, requirement_id, participant_id, funder_name,
              committed_amount, expected_payment_date) ON public.funding_commitments TO authenticated;
GRANT UPDATE (funder_name, committed_amount, expected_payment_date) ON public.funding_commitments TO authenticated;
-- status is written only by SECURITY DEFINER routines owned by postgres (sync, revoke);
-- add AFTER UPDATE OF committed_amount -> recompute status; drop the GUC check.
```

For R-10, split the cash function into `get_available_cash(p_as_of DATE DEFAULT CURRENT_DATE)`, which derives the business from `get_current_business_id()` for users, and an internal `get_available_cash_for(p_business_id UUID, p_as_of DATE)`, granted to `service_role` only.

## 5. What Rev 2.3.4 validation must include (when authorised)

On a fresh disposable project:
- the full migration set, plus the declared restore/rollback procedure;
- adversarial tests, run at the SQL level and over **HTTP through PostgREST and the Storage API**:
  - a signed-up stranger tries to join a business (R-1);
  - a commitment status is set on INSERT and on UPDATE, and via `set_config` (R-2, G-03);
  - financial rows are deleted (G-01);
  - a transaction is reversed after allocation (G-02);
  - audit records are forged (R-9);
  - cash is checked as-of a date with future-dated rows (R-4);
  - mixed-currency inserts (R-5);
- the Rev 2.2 suites adapted to the 25-table schema;
- FIN-02 concurrency.

Exit criterion: 0 FAIL, and every result physically recorded.
