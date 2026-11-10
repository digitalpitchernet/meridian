# Meridian Gate 1 Report (Rev 2.3.4 engineering foundation)

Date: 8 Nov 2026. Repo: `C:\xampp\htdocs\meridian`, local commits only.
Validation environment: **DPN** Supabase project `meridian-g1-validation-clean` (ref `xwopffsacsctvjjwnxnw`, ap-south-1, free),
created empty by the founder on 8 Nov 2026. All 9 migrations were applied unchanged (each stored statement's MD5 equals its repo file).
Test users are created by Supabase Auth through the Admin API (`tests/http/provision-users.mjs`), never by SQL.

Superseded runs, kept as evidence only:
- `docs/history/gate-1-liqrit/`: first run, LiqrIt org (`xpuhrahnndjfcpatarbv`). LiqrIt is no longer used for Meridian. This run found the 3 defects in §4.
- `docs/history/gate-1-dpn-first/`: DPN `meridian-g1-validation` (`ahphlozxsgifgwbtwoqb`). SQL clean, but sign-in returned HTTP 500 because the fixtures had inserted users straight into `auth.users`. The project is preserved, not deleted or reset.

The paused Rev 2.2 project (`cnelrrpmnbhylhivyybs`) was not touched.

## 1. Readiness assessment

**Gate 1 is not complete yet.** One completion criterion is still open: the recovery drill, which needs you.

| Criterion | State |
|---|---|
| Migrations succeed | **Met.** 9 migrations applied in order on the fresh DPN project; history versions equal the filenames |
| Security and isolation tests pass | **Met.** SQL 80/80; HTTP 46/46 through PostgREST, Storage API and Auth |
| Financial tests pass | **Met** (74 finance and cash + 31 CSV + 6 gap checks). Parallel allocation proven over HTTP: H-CONC-01, 10/10 races |
| Storage tests pass | **Met**: SQL policies (SEC-STO), connector (41/41), Storage API over HTTP (H-STO-01…09, H-SR-07). CDN caching finding in L16 |
| Recovery shown in a clean environment | **Pending.** Drill is scripted; it needs a second empty DPN project and your DB URLs |
| Defects resolved or documented | **Met.** 3 product defects found in the first run, all fixed (§4); none found in the DPN runs; limitations in §7 |
| Reproducible by another developer | **Met in design**: the drill rebuilds a project from repo files alone with psql. It becomes evidence once the drill runs |

When the drill passes, I'd call Gate 1 complete and ask you for Gate 2 approval. Nothing from Gate 2 has started.

## 2. What was built

| Deliverable | Where |
|---|---|
| A. Reconciled engineering spec | `docs/ENGINEERING-SPEC.md` |
| B. Migrations (timestamped, forward-only) | `supabase/migrations/` (9 files) |
| B. Fixtures and SQL tests | `tests/sql/00_harness.sql` … `40_gap_checks.sql` |
| E. Storage connector | `connector/` (PHP, README with shared hosting vs VPS) |
| F. HTTP suite | `tests/http/run.mjs` |
| F. Recovery drill | `tests/recovery/drill.mjs`, `reconcile.sql` |
| Test users (Auth Admin API) | `tests/http/provision-users.mjs` |
| Evidence | `evidence/sql-results.json`, `http-results.json`, `http-auth-results.json`, `http-cache-probe.json`, `connector-results.json`, `advisor-security.md` |
| Manifest | `MANIFEST.sha256` |

## 3. Validation results

One clean pass on the fresh DPN project: SQL ran once (`evidence/sql-results.json`, 205 rows). HTTP ran from the founder's
machine on 7 Nov 2026 23:03 UTC (`evidence/http-results.json`, 47 rows), after the test fixes in §4.

| Suite | Ran where | PASS | FAIL | INFO | Pending |
|---|---|---|---|---|---|
| 01 fixtures and onboarding | DPN project, SQL | 8 | 0 | 0 | |
| 10 security | DPN project, SQL | 80 | 0 | 1 | |
| 20 finance and cash | DPN project, SQL | 74 | 0 | 0 | |
| 21 concurrency | DPN project, SQL | 3 | 1 ¹ | 1 | moved to HTTP |
| 30 CSV import | DPN project, SQL | 31 | 0 | 0 | |
| 40 gap checks | DPN project, SQL | 6 | 0 | 0 | |
| Connector | local php -S, Windows, PHP 8.2.12 | 41 | 0 | 0 | Linux symlink, real TLS |
| HTTP (Auth, PostgREST, Storage API, service role, parallel races) | DPN project, Node 24 on Windows | 46 | 0 | 1 ² | |
| Cache probe (observation for Gate 2, not a check) | DPN project | | | 4 ² | |
| Recovery drill | hosted, clean project | | | | **13 steps, you run** |
| **Total executed** | | **289** | **1 ¹** | **7** | |

¹ CONC-02 is an environment result, not a product defect. The MCP connector runs SQL calls one after another, so two
sessions could not overlap and the "second session waited" timing check could not hold. CONC-01, 03 and 04 still
showed one allocation and the over-allocation refusal. The same `FOR UPDATE` design passed a true two-session test in
Rev 2.2 (FIN-02). Over HTTP, H-CONC-01 ran 10 real parallel races: exactly one allocation won each time.

² H-STO-CDN and H-CACHE-*: the CDN keeps serving a deleted Vault file to the token that downloaded it, whatever
Cache-Control the file was uploaded with. See L16 and founder item 17.

Security advisor after all migrations: no unexpected findings (`evidence/advisor-security.md`).

## 4. Defects found and fixed during Gate 1

All three were found in the first (LiqrIt) run and fixed by forward migrations or code before the DPN run, which found none.

| Found by | Defect | Fix | Re-test |
|---|---|---|---|
| SEC-ANON-09, SEC-FN-01 | Four trigger functions kept PostgreSQL's built-in PUBLIC EXECUTE. A schema-scoped `ALTER DEFAULT PRIVILEGES` cannot remove it | Migration 8 `close_function_default_execute` (global default revoke + explicit REVOKE) | PASS, plus new SEC-INV-06 |
| CASH-14 | Cash with no accounts returned `0`, not `0.00` | Migration 9 `cash_result_scale` | PASS, plus CASH-20 (grants kept) |
| CON-35 | Connector answered 404, not 403, for a read through a Windows junction (still no data leaked) | Any non-directory in the path is now 403 | PASS |

Test-harness mistakes I made and corrected (not product defects): a wrong hand-computed CASH-01 figure (fixed before running),
a CSV test that inserted decision columns the client is correctly not granted, and two connector-harness bugs.

HTTP-harness defects found in the DPN runs (none were product defects):

| Run | Symptom | Cause | Fix |
|---|---|---|---|
| DPN first | H-AUTH HTTP 500 | Fixtures inserted users into `auth.users` with SQL, leaving NULLs GoTrue cannot read | Fresh project; users created by the Auth Admin API (`bba60d1`) |
| Clean, provisioning | Sign-in 401 | `.env` held another project's publishable key; the gateway rejected it before GoTrue | Script now checks both keys first and resumes safely (`3ab025c`) |
| Clean, HTTP 1st | H-FIN-06, H-SR-05 FAIL | PostgREST sent `93759.00`; `JSON.parse` dropped the scale | Check the raw body (`29d38f5`) |
| Clean, HTTP 1st | H-SR-07 FAIL | Delete worked, but the follow-up GET was a CDN cache HIT; H-STO-07/08 had read the same cache | Existence and size via the list API (`29d38f5`) |

## 5. Security results

| Area | Evidence | Result |
|---|---|---|
| Anonymous access: no table, view or function privilege | SEC-ANON-01…10 | PASS |
| Tenant isolation: reads, writes, composite FKs, RPCs, no lock leak | SEC-TEN-01…11 | PASS |
| Profile ownership: stranger cannot join, no re-pointing, even service_role | SEC-PROF-01…11, BOOT-04/06/07 | PASS |
| Column privileges: amounts, reversal flags, provenance, revoked fields, base currency | SEC-COL-01…11 | PASS |
| No GUC boundary: setting the old GUC changes nothing | SEC-COL-09/10 | PASS |
| No deletion or truncation of financial history (client, service_role, owner) | SEC-DEL-01…10, CSV-14/15 | PASS |
| No client activity records; actor is real | SEC-ACT-01…06 | PASS |
| SECURITY DEFINER surface exact; search_path pinned; service_role split | SEC-FN-01…08 | PASS |
| Storage policies: own folder only, no overwrite, no client delete, private 50 MB | SEC-STO-01…07 | PASS |
| Fail-closed invariants for future objects | SEC-INV-01…06 | PASS |
| Connector: auth, replay, rotation, scopes, paths, links, atomic writes, size, HTTPS | CON-01…41 | PASS (local) |
| Same, over HTTP through Auth, PostgREST and the Storage API | H-AUTH, H-ANON, H-TEN, H-COL, H-DEL, H-ACT, H-FIN, H-FN, H-CONC, H-STO, H-SR | PASS (46/46) |
| Deleted Vault file still served from the CDN to the same token | H-STO-CDN, H-CACHE-* | **Open finding** (L16) |

## 6. Recovery drill

Status: **scripted, not yet run.** The full procedure, decisions D1–D5 and proposed script amendments A1–A6 are in
`docs/RECOVERY-RUNBOOK.md` (draft for independent review). `tests/recovery/drill.mjs` will:
1. check the target is empty;
2. apply the 9 migration files with psql (no MCP), recording the versions;
3. store a sentinel file in source storage;
4. take a `pg_dump` data backup;
5. restore it in one transaction in replica mode;
6. copy every stored file and verify its sha256;
7. compare the two databases.

The comparison covers full-row md5 of all 30 public tables, auth users, the storage index, cash and per-account
balances, live allocation sums, commitment status counts, document hashes, and the security posture (grants,
column grants, policies, RLS, function ACLs, triggers, bucket). The fingerprint query was run against the source and
works. The result goes to `evidence/recovery-drill.json`. Recovery time is recorded but no target has been agreed (founder item).

## 7. Limitations and unresolved issues

| # | Item | Effect | Proposed handling |
|---|---|---|---|
| L1 | Reversals are not dated: a reversal removes the transaction from cash at every as-of date, including dates before the reversal | Historic cash reports change after a correction | Gate 2: add `reversal_effective_date` if historic statements must stay fixed |
| L2 | Deactivating an account removes its balance from available cash | Intended, but it must be shown in the UI | UI copy in Gate 2 |
| L3 | Recurring transactions are templates only; nothing posts them | No automatic entries | Gate 2 scheduler (Edge Function) |
| L4 | The `commit_import_batch` "replace target has allocations" guard cannot be reached today (CSV rows are operational and cannot be allocated) | Defensive only | Keep it; it matters if CSV ever imports contributions |
| L5 | Vault deletion is server-only (Storage API with service_role) | No client delete button without an Edge Function | Gate 2 Edge Function |
| L6 | Migrations must run as `postgres`; `supabase_admin` would restore Supabase's anon defaults on new objects | Deployment rule | In the spec §8; CI check later |
| L7 | Global default-privilege change: every new function postgres creates needs an explicit GRANT | Easy to forget in Gate 2 | SEC-FN-01 catches it |
| L8 | Restores use replica mode, which skips guard triggers | A tampered dump could load bad history | Restore only verified Meridian dumps; spec §9 |
| L9 | No MIME allow-list on `company-vault` | Any file type can be stored | Founder decision (§9) |
| L10 | ~~Concurrency not yet proven over HTTP~~ | Resolved: H-CONC-01 10/10 | |
| L11 | Connector: link refusal tested with an NTFS junction; a POSIX symlink on Linux and the host's TLS versions are untested | | Run `tests/connector/run.php` on the real host, plus an `openssl s_client` check |
| L12 | Connector GET checks the path, then streams; a swap between the check and the read is possible on a host where another user can write into the storage root | Needs a shared-hosting account compromise | Document: storage root writable by the PHP user only |
| L13 | Leaked-password protection is off in Supabase Auth | | Founder decision before production |
| L14 | The `qa` schema and fixture data live in the validation project | Test-only | Never in production; the validation project is disposable |
| L15 | Google Drive provider: schema only, no integration | | Gate 2+ with authorisation |
| L16 | The Supabase CDN caches authenticated Vault downloads per token. After a server delete, the same token still got the file (`cf-cache-status: HIT`). Uploading with `no-store` or `private, no-store` did not change this: Storage stored and returned the header, and the edge still served HITs before and after the delete. Other users and anon were refused (cache BYPASS). The project is on the Free plan: no Smart CDN invalidation and no purge API | Residual access to a deleted file for whoever already downloaded it, for an edge lifetime not yet measured | Gate 2 (founder item 17); do not rely on upload Cache-Control alone |

## 8. Finding classification

Categories: **H** Previously supported by historical evidence (Rev 2.2) · **R** Reconstructed from available documentation ·
**N** Newly corrected in Rev 2.3.4 · **V** Successfully validated in the fresh environment · **P** Still pending validation.

| Finding | Subject | Class | Evidence |
|---|---|---|---|
| R-1 | Profile RLS tenant takeover | N, V | SEC-PROF-01…07, BOOT-04 |
| R-2 | GUC bypass | N, V | No GUC exists; SEC-COL-09/10 |
| R-3 | committed_amount change not recalculated | N, V | Status derived; FIN-28/29 |
| R-4 | Cash had no as-of date | N, V | CASH-09, 12, 13, 15, 16 |
| R-5 | Single currency not enforced | N, V | No sub-business currency columns; BOOT-02, SEC-PROF-08/09 |
| R-6 | Recovery fixture lacked auth users | N, P | Drill restores auth.users/identities (R-09) |
| R-7 | Recovery checked cash only | N, P | reconcile.sql covers allocations, status, documents, bytes |
| R-8 | Connector realpath rejected new uploads; TOCTOU | N, V (local), P (Linux) | CON-03, CON-25…37 |
| R-9 | Clients could forge activity | N, V | SEC-ACT-01…06 |
| R-10 | Service-role cash always raised | N, V | SEC-FN-04, CASH-19 |
| G-01 | Financial history deletable | H, N, V | SEC-DEL-01…10, CSV-14/15 |
| G-02 | Reversal did not cascade | H, N, V | FIN-21…23, 37 |
| G-03 | Status settable on INSERT | N, V | No status column; SEC-COL-01/03 |
| G-04 | Allocated transactions mutable | H, N, V | FIN-27, SEC-COL-04/11, FIN-38…40 |
| G-05 | Unapproved scope removals | R | Restored: Google Drive enum, recurring templates, decision options, project contacts, contact interactions, reimbursement tracking (derived), activity triggers. Not restored: outbox. **Founder approval** (§9) |
| G-06 | CSV duplicates and errors imported silently | H, N, V | CSV-04, 06, 25, 29 |
| G-07 | Privilege hardening not in SQL | H, N, V | SEC-ANON-08…10, SEC-INV-05/06; Gate 1 found and fixed the PUBLIC EXECUTE gap |
| G-08 | REVOKE on schema public may break Supabase | N | Not adopted; per-object revokes used instead |
| G-09 | No bucket or storage policies | H, N, V | SEC-STO-01…07; H-STO-01…09, H-SR-07 |
| G-10 | DEFINER BEFORE trigger leaked cross-tenant lock | N, V | Guard is SECURITY INVOKER; SEC-TEN-07/08 |
| G-11 | Capital targets unlinked | H, N, V | FIN-70…75 |
| G-12 | No restore strategy for forward-only | N, P | Spec §9, drill pending |
| G-13 | Transfer before destination opening | N, V | GAP-01…03 |
| G-14 | Integrity checks dropped | H, N, V | FIN-51/52, SEC-ACT-05 |
| G-15 | set_updated_at needlessly DEFINER | N, V | Now INVOKER; SEC-FN-01/02 |
| G-16 | Revocation reason optional | N, V | GAP-04…06 |
| G-17 | No adversarial suite | N, V | 202 SQL + 41 connector + 46 HTTP checks run |
| Rev 2.2 FIN-02 | Row-lock concurrency | H, V | H-CONC-01, 10/10 parallel races |
| New (L16) | Deleted Vault file served from CDN cache | P | H-STO-CDN, H-CACHE-*; Gate 2 design needed |

## 9. Items needing founder approval

1. **Commitment status is derived, not stored.** No status column; the view computes it.
2. **Transactions are fully immutable.** Corrections are reversal plus a new entry; only category, description, reference and notes can be edited.
3. **No `is_cleared` / bank reconciliation flag** in V1.
4. **Transactional outbox omitted.** Activity comes from triggers instead.
5. **Recurring transactions are templates only** until Gate 2.
6. **Google Drive** present in the schema only; the integration is deferred.
7. **Vault documents are archive-only**; file deletion is server-only.
8. **Base currency cannot be changed** after onboarding, by anyone.
9. **CSV duplicate decisions take two steps** (stage, then decide skip/import/replace, then commit), not one.
10. ~~Validation environment owner~~: **decided 8 Nov 2026**: Meridian infrastructure is DPN-owned; LiqrIt is not used.
11. **`max_workspaces` = 1 by default**; the validation project uses 2 for tenant tests.
12. **Reversals are not dated** (L1).
13. **Vault MIME allow-list**: none today. Allow-list or open?
14. **Leaked-password protection** in Supabase Auth (plan-dependent).
15. **Recovery targets**: what recovery point and recovery time are acceptable.
16. **A second, empty DPN project** as the recovery-drill target (created by the founder, like the validation project).
17. **Vault caching (L16).** Founder direction (8 Nov 2026): no residual access to deleted or revoked documents; change to
    be made in Gate 2, not Gate 1. The probe shows upload `no-store` reaches browsers but does not stop the CDN edge, so the
    Gate 2 design must choose another route (for example downloads through a Meridian function, or a plan with CDN invalidation).
