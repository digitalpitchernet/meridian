# MER-ENG-SPEC-001 Rev 2.2: Engineering Validation Report

| | |
|---|---|
| Prepared by | Gavin (implementation intelligence) |
| Date | 7 November 2026 |
| Specification | MER-ENG-SPEC-001 Revision 2.2 (candidate V1.0 blueprint) |
| Environment | Disposable Supabase project `meridian-rev22-validation` (ref `cnelrrpmnbhylhivyybs`), org DigitalPitcherNetworks, region ap-northeast-2 (Seoul), PostgreSQL 17.11 |
| Authority used | Disposable database only. No production code, live database, deployment or live data was touched. Nothing is committed. |
| Verdict | **Rev 2.2 is not yet executable as a V1 baseline.** Up-migrations apply cleanly and core tenant isolation holds. The rollback chain fails, one feature (capital targets) cannot store data, and 6 of 6 outstanding concerns are confirmed. Candidate fixes for all SQL defects were written and pass on the same database (43/43). |

Every result below was physically executed and recorded in `qa.results` on the disposable project. Nothing is reported as passing unless it ran.

## 1. Repository audit

| Item | Actual state |
|---|---|
| Repository | `C:\xampp\htdocs\dpn`: the DPN static website, not a Meridian repository |
| Branch / commit | `phase-6/production-readiness` @ `a7eb2b3` |
| Working tree | 2 untracked DPN files (`tests/regression/dist-parity.js`, `tests/verify-dist.mjs`) pre-existing; this validation added `meridian/validation/` (uncommitted) |
| Remote | None configured |
| `meridian/` | Empty and never committed before this validation |
| Supabase config / migrations / `supabase/` dir | None anywhere in the repository |
| Frontend code for Meridian | None |
| Retainable implementation | **Nothing.** There is no Meridian code to keep or conflict with |

**Conflicts between the repository and the blueprint**

1. The blueprint assumes a Meridian repository with `supabase/migrations` and `supabase/tests/rls_adversarial.sql`. None exists. The current home is a subfolder of the DPN site repo, which has its own build tooling (Tailwind, `dist/`), an unrelated branch and no remote. **Recommendation: a separate Meridian repository** (founder decision).
2. The migration format conflicts with Supabase tooling. The spec ships paired `00001.up.sql`/`.down.sql` files. The Supabase CLI expects timestamped, forward-only `supabase/migrations/<ts>_name.sql` and has no down migrations. A rollback convention must be chosen before Stage 3.
3. `meridian/` sits under XAMPP `htdocs`, so local Apache serves it. That is harmless for SQL and docs, but secrets must never be placed there.
4. The Supabase account linked to my MCP connector holds the unrelated `liqrit-dev` project and was not used. Validation ran in your DigitalPitcherNetworks account through the dashboard SQL Editor.

## 2. Test environment and method

* **Real Supabase, not an emulation.** It has the real `auth`, `storage`, roles and default privileges. Measured role attributes: `postgres` superuser = false, BYPASSRLS = true. `service_role` superuser = false, BYPASSRLS = true.
* Migrations were transcribed verbatim from the spec into `migrations/`. Each file was pasted into the SQL Editor and its SHA-256 was matched against the file on disk before running. For the rollback cycle, the scripts were stored in `qa.migrations` (hashes re-verified) and executed through `EXECUTE`, one transaction per script.
* Client access was impersonated exactly as PostgREST does it: `SET LOCAL role` plus `request.jwt.claims`, through `qa.login()`. Three auth users exist: founder A, founder B, and stranger C with no business.
* Every destructive probe ran inside a sandbox block that is rolled back. Results were captured before the rollback.
* The Supabase SQL Editor shows "Run without RLS" and destructive-operation warnings. Both were acknowledged so the SQL ran exactly as written.
* **The spec's Section 7.2 (RLS) has no migration number** (defect D-03). It was applied as `00006b.rls.up.sql`, after 00006 and before 00007. That is the only placement consistent with the spec's down scripts.

Artefacts (all under `meridian/validation/rev-2.2/`):

| Path | Contents |
|---|---|
| `migrations/` | 00001–00007 up, 00006b RLS, `down.all.sql`: verbatim spec SQL |
| `tests/00_harness.sql` | Harness: impersonation, result capture, spec cash formula, catalog snapshots |
| `tests/01_fixtures.sql` | Users and businesses bootstrapped through RLS |
| `tests/10_security.sql` | SEC-01 to SEC-05, SEC-07 storage, SEC-08 grants, SEC-09 TRUNCATE |
| `tests/20_financial.sql` | FIN-01, FIN-03 to FIN-08, FIN-X1 to X5 |
| `tests/30_concerns.sql` | Handover concerns 1–5 (concern 6 is SEC-08/09) |
| `tests/fin02_setup.sql`, `tests/fin02_session.sql` | Two-session concurrency test |
| `patches/R23-candidate.patches.sql` | Candidate corrections P-01 to P-10 |
| `patches/down.all.corrected.sql` | Rollback with D-01/D-02 fixed |
| `patches/PV-patch-verification.sql` | Re-tests of every failure plus regressions |

## 3. Migration execution report (up)

| Migration | SHA-256 (16) | Result |
|---|---|---|
| 00001.up | 91c2d91589a706dd | OK |
| 00002.up | c34ed8268d1935d7 | OK |
| 00003.up | 9d313c44424a29ea | OK |
| 00004.up | 72bcbec87e50f17d | OK |
| 00005.up | 3de34394c8da6e2e | OK |
| 00006.up | 54f97db101dc5eff | OK |
| 00006b RLS (Section 7.2) | 3133603333ca88e9 | OK |
| 00007.up | 1eb16da7da8fb0d4 | OK |

Resulting catalog: **30 tables** (the spec says 25), 1 view, 89 indexes, 110 public policies plus 3 storage policies, 39 triggers, 14 functions. RLS is enabled and forced on 30/30 tables. Snapshot `up1` holds 608 catalog objects, including constraints, ACLs and function owners.

Observations:
- Tables created in 00001–00006 have no RLS until 00006b runs. Under Supabase default grants, `anon` has full access in that window (D-03, D-19).
- `ALTER FUNCTION … OWNER TO postgres` and the storage policies applied without error on the managed project.

## 4. Up/down/up rollback validation

| Step | Script | Result |
|---|---|---|
| Down, as specified | `down.all.sql` (00007 to 00001) | **FAIL**: `42501 Direct deletion from storage tables is not allowed. Use the Storage API instead.` (00006.down). The whole down rolled back; 608 objects remain. **D-01** |
| Down, D-01 neutralised | `down.all.patched-V02` | **FAIL**: `2BP01 cannot drop table profiles because other objects depend on it`. Detail: policy `businesses_insert_bootstrap` on `businesses` depends on `profiles` (00001.down). **D-02** |
| Down, D-01 + D-02 fixed | `down.all.corrected.sql` | OK, 86 ms. Leftover: `company_vault` bucket (by design of the fix). `pgcrypto` stays installed (platform-managed) |
| Up again | 00001 to 00007 + 00006b | All OK (3–33 ms each) |
| Compare | `up1` vs `up2` | **Identical: 608 objects, 0 differences** (tables, constraints, triggers, policies, RLS flags, ACLs, function owners/ACLs) |
| Partial rollback | down 00007+00006 (D-01 fixed), up 00006, 00006b, 00007 | **FAIL**: 00006b `42710 policy "businesses_insert_bootstrap" already exists`. Result: `documents`, `document_associations`, `integration_connections`, `activity_records` and `transactional_outbox` come back with **RLS disabled** while `anon` holds full grants. Vault storage policies are gone. **D-03 (P0 security)** |
| Reset | corrected down + full up | OK, 0 differences from `up1` |

**Conclusion.** Rev 2.2's rollback scripts are not executable on Supabase as written. With two small corrections the full cycle is clean and reproducible. Partial rollback is unsafe until each table's RLS lives in the same migration as the table.

## 5. RLS and privilege test report

| Test | Result | Evidence |
|---|---|---|
| BOOT-01 to BOOT-08 | **8/8 PASS** | Founder bootstraps business then profile through RLS. Second business refused (42501). Stranger C cannot attach a profile to business A (42501) and sees 0 rows |
| SEC-01 anon, all 30 tables + vault | **Data: PASS.** Spec criterion: **FAIL** | 0 rows readable and 0 leaking operations. But on 28 tables anon UPDATE/DELETE returns `OK 0` instead of 42501, because Supabase default grants give anon `arwdDxtm` |
| SEC-02 cross-business read/update/delete/move | **15/15 PASS** | 0 rows; inserts stamped with B's `business_id` refused (42501) |
| SEC-03 composite FK injection | **5/5 PASS** | tasks and document_associations: 23503. Transactions, commitments and allocations are rejected earlier by BEFORE triggers (P0001), not 23503 as the spec states (D-18, wording only) |
| SEC-04 ledger/outbox write isolation | **14/14 PASS** | authenticated INSERT/UPDATE/DELETE on both tables: 42501. `claim_outbox_batch`, `complete_outbox_item` and `record_domain_activity`: 42501 for anon and authenticated. Trigger-written row = `user/<A>/projects.insert` plus outbox `pending/domain.projects.insert` under FORCE RLS |
| SEC-05 column-specific `ON DELETE SET NULL` | **4/4 PASS** | Project and selected decision_option deleted; children keep `business_id`; only the optional FK is nulled |
| SEC-05x extras | 4 PASS, **1 FAIL** | FK cycle decision/options deletes cleanly; cross-decision option rejected (23503); document version parent nulls. **`capital_targets` INSERT fails `42703 record "new" has no field "capital_target_id"` (D-04)** |
| SEC-07 vault storage | 1 PASS, **2 FAIL** | Upload into B's folder refused. One object named `not-a-uuid/…` makes every vault listing fail with `22P02` (D-07) |
| SEC-08 grant inventory (concern 6) | 1 PASS, **2 FAIL**, 13 INFO | No PUBLIC table grants. anon holds INSERT/UPDATE/DELETE/TRUNCATE on 29 relations. authenticated holds TRUNCATE on every table except `transactions` and `payment_allocations`. `commit_import_batch` and trigger functions are executable by PUBLIC and anon |
| SEC-09 TRUNCATE (RLS bypass) | **FAIL** | Founder A ran `TRUNCATE public.subtasks` as `authenticated`: business B's subtasks were deleted (sandbox rolled back) (D-12) |
| SECURITY DEFINER behaviour | PASS (platform-dependent) | Works because Supabase's `postgres` has BYPASSRLS. A self-hosted deployment without it would break the trigger and `get_current_business_id()` under FORCE RLS (D-15) |

## 6. Financial invariant test report

| Test | Result | Evidence |
|---|---|---|
| FIN-01 partial payments | **PASS** | 30000 required / 30000 committed / 20000 allocated / 10000 outstanding; A `fulfilled`, B `pledged` |
| FIN-02 concurrency (two real sessions) | **PASS** | S1 16:15:03.699–16:15:11.720 (held lock 8 s). S2 started 16:15:04.044, blocked until 16:15:11.724, then `Total allocated transaction_amount (8000.00) exceeds transaction amount (5000.00)`. One 4000 allocation survives |
| FIN-03 reversal cascade | **PASS** (6/6) | Allocation auto-reversed; commitment back to `partially_paid` with 10000 active; both reversal events in the ledger; un-reverse of an allocation refused; transaction DELETE refused (42501) |
| FIN-04a EUR to INR transfer | **PASS** | EUR 5000 to 4000, INR +90000; available cash 450000.00 before and after |
| FIN-04b USD to INR allocation | **PASS** | 1000 × 84.5 = 84500 accepted. 84000 rejected by `chk_pa_currency_conversion` (23514). USD-currency allocation refused |
| FIN-05 historical FX | **PASS** | Native 1500 USD; base 125500.00 |
| FIN-06 personal founder expense | **PASS** | Corporate cash unchanged; unreimbursed = 1200. *Weak test: the fixture account balance was 0* |
| FIN-07 capital over-allocation | **PASS** | USD allocation into INR structure refused; view `over_allocated/200000.00/0.00`; equity 60/40 untouched |
| FIN-08 CSV currency fallback | **PASS** (5/5) | Both rows resolved to INR; overwritten transaction reversed and linked; an EUR row aborts the batch atomically (`staged/0`) |
| FIN-X1 shrink allocated transaction | **FAIL** | `amount` 10000 to 5000 accepted with 10000 allocated |
| FIN-X2 un-reverse transaction | **FAIL** | `is_reversed` TRUE to FALSE accepted; its allocations stay reversed |
| FIN-X3 client sets commitment status | **FAIL** | `fulfilled` set by hand with 0 paid |
| FIN-X4 change committed amount | **FAIL** | Status stays `partially_paid` when it should be `fulfilled` |
| FIN-X5 retype allocated income | **FAIL** | income to expense accepted with active allocations |
| FIN-06x reimbursement status | **FAIL** | Reimbursable expense stored as `not_applicable` |

Note: the Available Cash formula (Section 5.2) exists only as prose. There is no SQL view or function in Rev 2.2. It was implemented verbatim in the harness (`qa.available_cash`) for these tests (D-16).

## 7. Outstanding concerns (handover Section 3)

| # | Concern | Finding | Fix (verified) |
|---|---|---|---|
| 1 | Structure vs target allocation | **Confirmed and worse:** no target can be inserted at all (D-04). The view has no target-level row and no check that sum(targets) ≤ structure | P-01 fixes the trigger. P-02 adds `vw_capital_target_allocation_summary` plus `total_capital_targets`, `targets_exceed_structure_by` and `over_allocated_target_count` on the structure view. Additive and read-only |
| 2 | Parent currency changes | **Confirmed ×4:** capital_structures, funding_requirements, financial_accounts and businesses.base_currency all change freely under existing children | P-03 freezes currency once dependent rows exist (23514); childless parents can still change |
| 3 | Cross-currency transfers | **Confirmed:** a 1000 EUR @90 to INR transfer with `transfer_to_amount` 50000 is accepted. INR native balance 50000 is counted as 90000 in available cash (450000 vs 410000 native-derived). A EUR transaction left at the default rate 1 is accepted | P-04 reconciles when one leg is the base currency and rejects non-base rate = 1. **General case needs a schema decision** (`transfer_to_exchange_rate_to_base`) |
| 4 | CSV overwrite validation | **Confirmed:** one batch reversed a transaction on another account and a transfer, re-reversed an already-reversed row (overwriting `reversed_by_id`), and created 2 replacements for one target. 5 active replacements for 4 targets | P-07 validates and locks every target first; P-05 blocks re-reversal |
| 5 | Abandoned `processing` jobs | **Confirmed:** a job stays `processing` forever (0 reclaimed after 1 day). A late failure report also moves `dispatched` back to `failed` | P-08 uses `available_at` as a lease (no new column), reclaims on expiry, parks final-attempt expiries in `dead_letter`, and only completes rows still in `processing` |
| 6 | Explicit revocations incl. PUBLIC | **Confirmed:** see SEC-08/09 | P-09 revokes all anon table privileges; revokes TRUNCATE/TRIGGER/REFERENCES/MAINTAIN from authenticated; adds explicit PUBLIC revokes on protected tables, hardened default privileges, and `commit_import_batch` limited to authenticated |

## 8. Outstanding defect register

Severity: P0 = blocks Stage 2 / security or data loss · P1 = financial integrity or a broken feature · P2 = hardening / platform risk · P3 = documentation.

| ID | Sev | Defect | Reproduced by | Fix | Status after patch |
|---|---|---|---|---|---|
| D-01 | P0 | 00006.down `DELETE FROM storage.buckets` is rejected by Supabase (42501), so the entire rollback fails | Up/down step 1 | Remove the bucket through the Storage API as an operational step | Fixed in `down.all.corrected.sql`; cycle verified |
| D-02 | P0 | 00001.down cannot drop `profiles`: policy `businesses_insert_bootstrap` depends on it (2BP01) | Up/down step 2 | Drop the policy first | Fixed; cycle verified |
| D-03 | P0 | Section 7.2 RLS has no migration home; down scripts don't remove its policies. Partial rollback recreates 5 tables without RLS while anon holds full grants, and re-applying RLS fails (42710) | Partial rollback | **Restructure:** ENABLE/FORCE RLS and policies in the same migration as each table; `get_current_business_id()` in 00001; paired downs | Open: needs Rev 2.3 restructure |
| D-04 | P0 | Every `capital_targets` INSERT fails (42703): shared trigger reads `NEW.capital_target_id` | SEC-05x, C1 | P-01 | Fixed (PV-01) |
| D-05 | P1 | Allocated transactions can be shrunk, retyped and un-reversed (FIN-X1/X2/X5) | FIN-X1/2/5 | P-05 | Fixed (PV-05) |
| D-06 | P1 | CSV overwrite accepts any target (concern 4) | C4 | P-07 + P-05 | Fixed (PV-07) |
| D-07 | P1 | Vault policies cast the folder to UUID; one bad path breaks vault listing for everyone (22P02) | SEC-07 | P-10 compares text | Fixed (PV-10) |
| D-08 | P1 | Parent currency changes unguarded (concern 2) | C2 | P-03 | Fixed (PV-03) |
| D-09 | P1 | Transfer legs not reconciled; non-base default rate 1 accepted (concern 3) | C3 | P-04 (partial) | Partly fixed; general case needs approval |
| D-10 | P1 | Outbox jobs stranded in `processing`; late failure reopens a dispatched job (concern 5) | C5 | P-08 (`claim_outbox_batch` gains `p_lease_seconds`) | Fixed (PV-08) |
| D-11 | P1 | Commitment status is client-writable and goes stale when `committed_amount` changes | FIN-X3/X4 | P-06: status always derived; clients may only set `revoked` | Fixed (PV-06). **[Needs approval]** |
| D-12 | P2 | Supabase default grants leave anon with DML on 29 relations; authenticated can TRUNCATE (cross-tenant wipe demonstrated) and LOCK (MAINTAIN); functions executable by PUBLIC | SEC-01/08/09 | P-09 | Fixed (PV-09). Not reachable through PostgREST; V1's single business limits the blast radius |
| D-13 | P2 | No target-level capital summary; sum(targets) > structure undetected (concern 1) | C1 | P-02 | Fixed (PV-02) |
| D-14 | P2 | Reimbursable founder expenses default to `not_applicable` | FIN-06x | P-05 default trigger | Fixed (PV-06b) |
| D-15 | P2 | SECURITY DEFINER design depends on `postgres` having BYPASSRLS (true on Supabase Cloud). Self-hosted Supabase or plain Postgres must guarantee it, or the trigger and RLS helper break under FORCE RLS | SEC-08 role inventory | Document as a deployment prerequisite; consider a dedicated owner role with BYPASSRLS | Open |
| D-16 | P2 | Available Cash is specified only as a formula; there is no SQL object to test or reuse | — | Ship `vw_available_cash` / function in Rev 2.3 (harness version is reference) | Open |
| D-17 | P3 | Spec says 25 tables (actual 30 plus a view). The RLS matrix lists 24 tables under "20". Defect matrix names `trg_enforce_capital_currency_and_target` (actual: two other names). Dedup key description includes `tg_op`; code doesn't | Catalog | Correct the document | Open |
| D-18 | P3 | SEC-03 expects 23503 for all FK injections; some are rejected earlier by triggers (P0001). SEC-01 expects 42501 for anon UPDATE/DELETE (only true after P-09) | SEC-01/03 | Reword acceptance criteria | Open |
| D-19 | P3 | Migration format (`.up`/`.down` pairs) is incompatible with the Supabase CLI | Repo audit | Decide the tooling convention | Open (decision) |
| D-20 | P3 | `integration_connections` has no design for OAuth token storage (Drive/Calendar/Gmail) | Schema review | Specify Supabase Vault/secret storage before Phase 6 | Open |

## 9. Corrected SQL / migration patches

`patches/R23-candidate.patches.sql` holds P-01 to P-10. `patches/down.all.corrected.sql` fixes D-01 and D-02.

**Patch verification: 43/43 PASS** (`patches/PV-patch-verification.sql`). That includes regressions of FIN-01, FIN-03, FIN-04a, FIN-08, SEC-02 and SEC-04 against the patched schema.

Caveats, stated plainly:
- The patches were applied **forward on top of Rev 2.2**. They were not folded into the home migrations, and the folded result has not been through up/down/up. Rev 2.3 must re-run the full suite on a fresh project.
- The patches were applied in two parts through the SQL Editor. Unlike the migrations, their pasted text was not hash-verified against the file. The content was taken from the same source as the file.
- FIN-02, SEC-01/03/05 and FIN-05/06/07 were not re-run after patching. P-05/P-06 add triggers on the allocation path, so FIN-02 should be re-run in Rev 2.3 validation.
- P-04 and P-06 change behaviour that Atlas/Aurelian own and are marked **[NEEDS APPROVAL]**. P-04 also blocks a legitimate 1:1-pegged currency without an override.

## 10. Updated implementation dependency plan

1. **Decisions (founder):**
   - Meridian repository home (separate repo recommended).
   - Migration tooling convention (D-19).
   - Deployment profile, Decision 04: it determines vault storage and the outbox worker host.
   - Approval or rejection of P-04 (general case) and P-06.
2. **Rev 2.3 (Atlas):**
   - Fold P-01 to P-10 into their home migrations.
   - Restructure RLS per migration (D-03).
   - Fix the down scripts (D-01, D-02).
   - Add an Available Cash SQL object (D-16).
   - Correct the documentation (D-17, D-18).
   - Specify OAuth token storage (D-20) and the BYPASSRLS prerequisite (D-15).
3. **Rev 2.3 validation (Gavin, fresh disposable project):** full up/down/up, partial rollback of every migration, all suites including FIN-02. Exit criterion: 0 FAIL.
4. **Founder Stage 2 approval.**
5. **Stage 3 build order**, each step gated on the one before:
   1. Repo scaffold and Supabase CLI config.
   2. Auth, onboarding bootstrap, profiles and settings.
   3. App shell and FO-VIS-CC-001 tokens.
   4. Projects, milestones and tasks.
   5. Contacts, decisions and calendar.
   6. Finance core: accounts, categories and transactions, including the Available Cash view.
   7. Funding requirements, commitments, allocations, and capital structure and targets.
   8. CSV import.
   9. Activity feed, then the outbox worker. **Blocked:** the worker runtime is unspecified (Edge Function + `pg_cron`?).
   10. Company Vault. **Blocked** on Decision 04 and the Drive scope.
   11. Command Centre projections.
   12. Reports.
   13. Integrations. **Blocked** on Decisions 01–03.

## 11. Limitations of this validation

* The test client was the dashboard SQL Editor, which connects as `postgres`; client roles were impersonated with `SET LOCAL role` + JWT claims. PostgREST and Storage API request paths (HTTP, JWT verification, storage object uploads through the API) were **not** exercised. Storage tests inserted `storage.objects` rows directly.
* The SQL Editor's RLS and destructive-operation prompts were acknowledged so the spec SQL ran unaltered.
* Performance and index usefulness were not measured (no volume data).
* FO-VIS-CC-001 / frontend subsystems were out of scope for this database validation.

## 12. Disposable project state

Recorded results are preserved in `RESULTS.md`. `meridian-rev22-validation` holds Rev 2.2 **plus the candidate patches**, the `qa` schema (all results, migration texts, snapshots) and test fixtures (`*@meridian.test` auth users). It is not used by anything. Pause or delete it after review; nothing in it needs to be kept beyond this report.
