# Meridian Gate 1 Recovery Drill: Runbook (revision 3, for review, not yet executed)

Status: **revision 3 for independent review, 8 Nov 2026.** It covers the reviewer's six implementation corrections on
top of revision 2. Changes are in `docs/RECOVERY-RUNBOOK-CHANGES.md`. Nothing has been run. The
recovery target does not exist. The nine migrations, both validation projects and Gate 2 are untouched. **D1 (source
sentinel write) is not approved.**

Purpose: show that Meridian can be rebuilt in a separate, empty Supabase project from **the repository plus one
backup**, with database, Auth users, stored files and security posture identical to the source. Any difference is
either proven exact, classified as platform-generated with a stated reason, or fails the drill. Nothing is silently ignored.

| File | Role |
|---|---|
| `tests/recovery/drill.mjs` | runs R-00 … R-16, writes `evidence/recovery-drill.json` (fsync'd at each critical point) |
| `tests/recovery/approved-migrations.sha256` | the approved manifest: the 9 migration files and their sha256 |
| `tests/recovery/migrations.mjs` (+ `.test.mjs`) | R-00: exactly the 9 approved files, byte for byte |
| `tests/recovery/accepted-platform-versions.json` | reviewed GoTrue/Storage version differences (empty: none accepted) |
| `tests/recovery/platform-schema.sql` | A1: full definitions of `auth.users`, `auth.identities`, `storage.objects` |
| `tests/recovery/reconcile.sql` | fingerprint: tables, full Auth rows, every Storage object field, finance as exact text, security posture |
| `tests/recovery/compare.mjs` (+ `.test.mjs`) | diff and classification (exact / platform_generated / platform_version / unexpected) |
| `tests/recovery/paths.mjs` (+ `.test.mjs`) | Storage URL path encoding, per segment, separators kept |
| `tests/recovery/orphans.sql` | A4: 84 public foreign keys + `auth.identities.user_id → auth.users.id` |

Self-tests (no network, no credentials): `node tests/recovery/compare.test.mjs`, `node tests/recovery/migrations.test.mjs`,
`node tests/recovery/paths.test.mjs`.

| | Source | Target |
|---|---|---|
| Project | `meridian-g1-validation-clean`, ref `xwopffsacsctvjjwnxnw` | new, empty, created by the founder (proposed `meridian-g1-recovery-target`) |
| Org / region / plan | DigitalPitcherNetworks, ap-south-1, Free | same org, **same region**, Free |
| Writes during the drill | **none**, unless D1 is approved (then one Storage file) | all restore writes; disposable |
| Postgres | 17.11 | 17.x (checked) |

Not involved at any point: `ahphlozxsgifgwbtwoqb` (preserved), the paused Rev 2.2 project, LiqrIt, production.

---

## 0. Decisions

| # | Decision | State |
|---|---|---|
| D1 | Write **one** 64 KB sentinel file into source Storage (`company-vault/<business A>/recovery/sentinel-<ms>.bin`) so the byte copy can be proven. The source holds 3 storage index rows from the SQL tests and **no file bytes** | **Not approved.** The drill refuses to write it unless run with `--allow-source-sentinel`. Without it, R-03 is SKIPPED, R-06 is NOT_PROVEN and the result is **INCOMPLETE**, never PASS. Everything else is still fully tested |
| D2 | Amendments A1–A6 | **Approved with refinements**; implemented (§9); awaiting re-review |
| D3 | Target name and plan; the org can host one more Free project without pausing or changing either Meridian validation project | open; target not created |
| D4 | Recovery time / recovery point targets (Gate 1 founder item 15) | open; this run records the time only |
| D5 | Keep or delete the target afterwards | recommended: keep until the evidence review closes |

---

## 1. Credentials and `.env` (item 3)

Values go only into the git-ignored `.env` in `C:\xampp\htdocs\meridian`. Gavin never sees or types them; the
pre-commit hook blocks secret keys. URL-encode passwords inside URIs (`@` → `%40`, `#` → `%23`, `/` → `%2F`).

| Variable | Value | Where | Used by |
|---|---|---|---|
| `SUPABASE_URL` | `https://xwopffsacsctvjjwnxnw.supabase.co` | already set | R-03, R-06 |
| `SUPABASE_SERVICE_ROLE_KEY` | source **secret** key (the rotated one) | already set | R-03, R-06 |
| `SOURCE_DB_URL` | source **Session pooler** URI | source → Connect → Session pooler | all SQL steps |
| `TARGET_SUPABASE_URL` | `https://<target-ref>.supabase.co` | target → Settings → API | R-06, R-15, R-16 |
| `TARGET_SERVICE_ROLE_KEY` | target **secret** key | target → Settings → API Keys | R-06, R-15, R-16 |
| `TARGET_SUPABASE_ANON_KEY` | target **publishable** key | target → Settings → API Keys | R-16 |
| `TARGET_DB_URL` | target **Session pooler** URI | target → Connect → Session pooler | all SQL steps |
| `PG_BIN` | optional; default `C:\Program Files\PostgreSQL\17\bin` (pg_dump 17.11 present) | | psql, pg_dump |

URI shape: `postgresql://postgres.<ref>:<password>@aws-<n>-ap-south-1.pooler.supabase.com:5432/postgres`. Port **5432**
(session), not 6543 (transaction): the restore sets `session_replication_role` inside one session. The user is
`postgres.<ref>`, so migrations run as `postgres` (spec L6).

---

## 2. Pre-flight (read-only everywhere)

| Step | Who | Action | Pass |
|---|---|---|---|
| P-1 | Gavin (MCP) | Source snapshot: 9 migrations, 30 public tables, 4 users / 4 identities, 3 index-only storage rows, 0 integration connections, 0 Vault secrets, `orphans.sql` 85 checks / 0 orphans | matches (all verified 8 Nov 2026) |
| P-2 | Founder | Create the target (D3); fill `.env` (§1) | |
| P-3 | Gavin (MCP) | Target empty: 0 public tables, 0 objects, 0 users, 0 buckets; Postgres 17.x | all zero |
| P-4 | Gavin (MCP) | `platform-schema.sql` on both: identical `tables` section (the drill repeats this as R-01a), and compare `platform_versions` (R-01b). The target is created later than the source, so Supabase may have updated GoTrue or Storage in between. If so, the difference is identified and reviewed **before** the run (§4 step 2) | identical, or reviewed and accepted |
| P-5 | Founder | Dry-run read of the source in your own terminal: `& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" "<SOURCE_DB_URL>" --data-only -t auth.users -f tests\recovery\.work\dryrun.sql`, then delete the file | exit 0, non-empty |

---

## 3. Backup of the source (item 1)

1. **R-03 sentinel, only with `--allow-source-sentinel` (D1).** 64 KB of random bytes to
   `company-vault/<business A>/recovery/sentinel-<ms>.bin` through the Storage API with the source secret key. Its
   key, size and sha256 go into the evidence. Without the flag the source is not written and R-03 is SKIPPED.
2. **R-04 data backup:**
   ```
   pg_dump <SOURCE_DB_URL> --data-only --no-owner --no-privileges
           -t 'public.*' -t auth.users -t auth.identities -t storage.objects
           -f tests/recovery/.work/data.sql
   ```
   - Data only: the schema comes from the repository migrations, never from the dump.
   - Included: all 30 public tables (no sequences exist), `auth.users`, `auth.identities`, the `storage.objects` index.
     Generated columns (`auth.users.confirmed_at`, `storage.objects.path_tokens`) are not dumped; Postgres recomputes them.
   - Excluded: sessions, refresh tokens, MFA claims, one-time tokens, audit log, the `qa` test schema, Supabase internals.
   - Dump size and sha256 are recorded.
3. File bytes are read from source Storage in R-06. Reading may update Storage's own `last_accessed_at` on source
   objects. With D1 not approved there are no byte-bearing objects, so no read happens.

The dump holds bcrypt hashes and every business record. It stays in `tests/recovery/.work/` (git-ignored) and is
deleted after the drill (§8 step 9).

---

## 4. Restore into the empty target (item 2)

0. **R-00** (local, before anything else). `supabase/migrations/` must contain **exactly** the 9 files listed in the committed
   `tests/recovery/approved-migrations.sha256`, each with the listed sha256. A missing, extra, renamed or changed file, or
   a manifest that is not exactly 9 well-formed, unique lines, stops the drill with nothing written. The 9 file names and
   hashes go into `evidence.migrations`. The manifest was generated on 8 Nov 2026 from the files last changed in commit
   `d1b884e`; their MD5s equal the statements applied on `xwopffsacsctvjjwnxnw`.
1. **R-01** stop unless the target has 0 public tables, 0 objects, 0 Auth users, 0 buckets.
2. **R-01a (A1)** before any write, `platform-schema.sql` on both projects. For `auth.users`, `auth.identities` and
   `storage.objects` it compares, per column, the type with modifiers, nullability, the default or generation
   expression, identity, generated flag and collation, plus every constraint, index and trigger definition. Any
   difference stops the drill with nothing written.
   **R-01b** GoTrue and Storage migration levels must be identical. If they differ, the drill **stops with nothing
   written**, even when every definition matches, unless `tests/recovery/accepted-platform-versions.json` contains an
   entry for exactly that source/target version pair with a reason, a reviewer and a date. An entry is added only after
   the difference has been identified (what changed between the versions) and explicitly reviewed. It is committed, so
   the acceptance is in git history, and it is copied into `evidence.differences.platform_version`. The file is empty today.
3. **R-02** apply the migrations in filename order with psql, each in its own transaction with `ON_ERROR_STOP`,
   recording each version. The **bytes verified in R-00 are piped to psql**, so a file cannot change between the check
   and the apply. From here the evidence marks the target **dirty** (A6), and that state is written to disk first.
4. **R-05** restore in **one transaction**:
   ```
   SET session_replication_role = replica;
   TRUNCATE public.installation_settings;   -- migration default row; the source row is restored
   \i data.sql
   SET session_replication_role = origin;
   ```
   Replica mode stops guard, immutability and activity triggers from re-firing on reloaded history. It also skips FK
   triggers, so integrity is re-checked in R-14. CHECK, NOT NULL and UNIQUE are still enforced. Any error rolls the
   whole restore back. `installation_settings.max_workspaces` comes back as 2, the validation value.

---

## 5. Auth users and relationships (item 4)

- `auth.users` and `auth.identities` are restored row for row: same ids, emails, confirmation state, bcrypt hashes.
  These rows were created by GoTrue (Admin API), so no column GoTrue needs is NULL, unlike the earlier HTTP 500 case.
- **R-09** compares both tables as full rows (`to_jsonb` per row, md5 of all rows in id order): any changed column fails.
- **R-14** checks `auth.identities.user_id → auth.users.id` explicitly, plus the 84 public foreign keys, which
  include `profiles.id → auth.users` and `businesses.created_by_user_id → auth.users`.
- Not restored: sessions and refresh tokens. Users sign in again; source tokens are not valid on the target.
- **R-15** GoTrue's Admin API on the target lists exactly the source user ids, all confirmed (a read).
- **R-16, intentional deviation.** To prove a restored user can sign in, the drill sets a **new random password on one
  restored user on the target** (the lowest user id) through the target Admin API, then signs in with the target
  publishable key. This changes that user's `encrypted_password`, `updated_at` and `last_sign_in_at`, and adds session
  and audit rows on the target only. The sequence:
  1. the deviation record (user, fields, reason, `state: recorded, not yet applied`) is written to
     `evidence/recovery-drill.json` and **fsync'd** (temp file + rename) **before** the API call;
  2. the password-reset outcome (`password_reset`: time, HTTP status, returned user id; `state`) is recorded and flushed;
  3. the sign-in outcome (`sign_in`: time, status, token issued, `returned_user_id`, `token_sub`, `same_user`, error
     code) is recorded and flushed.
  R-16 passes only if the reset returned the selected id, the sign-in issued a token, and **both** the `user.id` in the
  sign-in response and the token's `sub` equal the selected restored user's id. A crash at any point leaves the deviation
  on disk. All fingerprints are taken **before** R-16, so the comparison is unaffected. R-15 and R-16 do not run if any
  earlier step failed, so a failed target stays as it was for diagnosis.
- Nothing is written to Auth tables outside the single restore transaction and R-16. No Auth schema object is changed.

---

## 6. Vault and Storage objects (item 5)

| Layer | Source of truth | How it moves |
|---|---|---|
| Index rows (`storage.objects`, all 15 columns) | the dump | restored in R-05 |
| File bytes | source Storage | R-06: GET with the source secret key; POST to the same path on the target with the target secret key, the **source's mimetype and Cache-Control**, `x-upsert: true` (the row already exists); GET back and compare sha256 |

- URLs: bucket and object name are percent-encoded **per segment**, keeping `/` (`paths.mjs`). Spaces, Unicode and
  reserved characters (`# ? % & = + : @ ; , \ [ ]`) cannot turn into a query, fragment or different path. Empty, `.` and
  `..` segments are refused. This applies to the R-03 upload and every R-06 read, upload and read-back.
- A row is treated as index-only only if its source `metadata` is NULL **and** Storage answers 400 not-found. Today
  that is the 3 SQL-test rows. Any other read failure fails R-06.
- **R-10** compares every column of every object, keyed by bucket/name: id, owner, owner_id, created_at, updated_at,
  last_accessed_at, version, metadata (size, mimetype, eTag, cacheControl, contentLength, lastModified, httpStatusCode),
  user_metadata, path_tokens, archived_at, is_delete_marker, is_versioned.

Field classification (`compare.mjs`):

| Class | Fields | Rule |
|---|---|---|
| **platform_generated** | `updated_at`, `last_accessed_at`, `version`, `metadata.lastModified` | allowed to differ **only on objects R-06 re-uploaded**; each listed in the evidence with its reason |
| **exact** (everything else) | `id`, `owner`, `owner_id`, `created_at`, `metadata.size`, `metadata.mimetype`, `metadata.eTag`, `metadata.cacheControl`, `metadata.contentLength`, `user_metadata`, `path_tokens`, flags | any difference fails |
| index-only rows | all fields | any difference fails |

  If Storage's upsert turns out to replace `id` or rewrite `owner_id`, R-10 **fails**; it is not pre-accepted. The
  founder then decides whether that is acceptable, and the classification is changed only with that approval.
- `public.documents` (1 SQL fixture row, with no bytes in the source either) is compared in R-08, and its sha256 list in R-11.
- The bucket comes from migration 6; R-12 compares id, public flag and the 50 MB limit.
- External connector files: none, out of scope. Supabase Vault secrets: 0; they cannot be copied (project-bound key).
- With D1 not approved, no object has bytes, so the platform_generated class cannot occur and every storage field must be exact.

---

## 7. Verification and acceptance criteria (item 6)

Result vocabulary in `evidence/recovery-drill.json`:

| Result | Meaning |
|---|---|
| `PASS_EXACT` | every step PASS, zero differences of any class |
| `PASS_WITH_CLASSIFIED_DIFFERENCES` | every step PASS; only `platform_generated` / `platform_version` differences, each listed with its reason |
| `INCOMPLETE` | no failure, but a step was SKIPPED or NOT_PROVEN (the D1 case) |
| `FAIL` | any `unexpected` difference or any failed step |

| Area | Step | Compared | Pass |
|---|---|---|---|
| Migration files | R-00 | exactly 9 files; sha256 equal to the approved manifest | identical; hashes in evidence |
| Target clean | R-01 | public tables, objects, users, buckets | all 0 |
| Platform tables | R-01a | full definitions of `auth.users`, `auth.identities`, `storage.objects` | identical |
| Platform versions | R-01b | GoTrue and Storage migration levels | identical, or a reviewed entry in `accepted-platform-versions.json` |
| Schema | R-02, R-07 | 9 verified files applied; version list | identical |
| Security posture | R-12 | see below | identical |
| Every record | R-08 | 30 public tables: row count + md5 of full rows | identical |
| Financial | R-11 | per business: available cash, every account balance (as of 2100-01-01), live transaction sum, all as `numeric(15,2)` **text**; reversed count | identical |
| Allocations | R-08, R-11 | `payment_allocations` rows; live allocation sum (text) | identical |
| Commitments | R-08, R-11 | `funding_commitments` rows; derived status counts | identical |
| Activity | R-08 | `activity_records` rows (also proves no trigger fired) | identical |
| Auth | R-09 | `auth.users`, `auth.identities` full rows | identical |
| Storage index | R-10 | every field of every object, classified as in §6 | no unexpected |
| Files | R-06 | bytes copied, sha256 read back from the target | copied = verified ≥ 1 (NOT_PROVEN without D1) |
| Documents | R-11 | md5 of sorted `documents.sha256` per business | identical |
| Overall | R-13 | all areas | 0 unexpected |
| Integrity | R-14 | `orphans.sql` on the target | 85 checks, 0 orphans |
| Auth usable | R-15, R-16 | GoTrue lists the same ids, all confirmed; one user signs in | 200 + token; deviation recorded |

**R-12 security posture** (`reconcile.sql` → `security`), every item compared exactly:

| Item | Content |
|---|---|
| `relation_acl` | every table, view, sequence in `public`: kind, owner, full ACL, **including PUBLIC (`=…`) entries** (36 today) |
| `column_acl` | every column-level grant in `public` (196) |
| `rls` | per table: RLS enabled **and FORCE RLS** (30, all forced today) |
| `view_options` | `reloptions` of every view, e.g. `security_invoker=true` (6) |
| `schema_acl` | owner and ACL of schemas `public` and `storage`, including PUBLIC usage |
| `default_acl` | default privileges for future objects: global and `public`, every role (7 entries, including migration 8's global PUBLIC EXECUTE revoke) |
| `policies` | public and storage: permissive/restrictive, roles, command, USING, WITH CHECK (31) |
| `functions` | every `public` function: md5 of `pg_get_functiondef` (body, language, SECURITY DEFINER, `SET search_path`), plus security_definer, config, volatility, leakproof, owner, ACL (27) |
| `triggers` | every non-internal trigger outside `qa`: enabled state + md5 of its definition (67) |
| `buckets` | the complete `storage.buckets` row (public, size limit, MIME types, type, versioning, lifecycle, owner, …) |

Deliberate exclusions, which are not compared: functions, grants and ACLs inside `auth`, `storage`, `extensions` and other
Supabase-owned schemas (platform-managed; the three tables the restore writes are covered by R-01a); the `qa` test
schema (never restored); bucket `created_at` and `updated_at` (set when migration 6 runs on each project).

Gavin's read-only follow-up on the target via MCP: `orphans.sql` again; the security advisor (expected 0008 ×1 INFO,
0029 ×8 WARN, leaked-password ×1 WARN, no 0011 because `qa` is not restored); `qa` absent.

Evidence: `evidence/recovery-drill.json`, with steps, result, target state, dump size and sha256, sentinel
(or null), file copy lists, platform versions, every classified difference, intentional deviations and duration.
Fingerprints: `tests/recovery/.work/fingerprints.json` (not committed).

---

## 8. Sequence and who does what (item 8)

| # | Founder | Gavin |
|---|---|---|
| 1 | Review revision 2 and the scripts; decide D1 and D3–D5 | Done: A1–A6 implemented; SQL verified read-only on the source; `compare.test.mjs` passes |
| 2 | | P-1 (done 8 Nov 2026; repeated just before the run) |
| 3 | Create the target; fill `.env` | |
| 4 | | P-3, P-4 on the target (read-only) |
| 5 | P-5 dry-run read; report the exit code | |
| 6 | Run **one** of: `node tests/recovery/drill.mjs` (D1 not approved → INCOMPLETE at best) or `node tests/recovery/drill.mjs --allow-source-sentinel` (D1 approved). Paste the full output | |
| 7 | | Analyse; §7 follow-ups; classify any difference |
| 8 | | Update the Gate 1 report, evidence and manifest; commit |
| 9 | `Remove-Item -Recurse -Force tests\recovery\.work` | Confirm it is gone and was never committed |
| 10 | D5 | |

Gavin does not: hold or enter credentials, run the credentialed scripts, create, pause, reset or delete projects,
or write to either validation project.

---

## 9. Amendments (approved with refinements; implemented, not executed)

| # | Implemented as |
|---|---|
| A1 | R-01a + `platform-schema.sql`: full column definitions (type, nullability, default/generation, identity, generated, collation), constraints, indexes, triggers; stops before any write; versions recorded as classified |
| A2 | R-15 (read) and R-16 (one password reset on the target, recorded first as an intentional deviation; runs only if everything before passed) |
| A3 | `reconcile.sql` storage section: every column of every object; `compare.mjs` field classification (§6) |
| A4 | R-14 + `orphans.sql`, now including `auth.identities.user_id → auth.users.id` |
| A5 | `--allow-source-sentinel`; without it R-03 is SKIPPED and the result cannot be PASS |
| A6 | `target_state` in the evidence and output: `dirty: recreate the target before any re-run` from R-02 onwards |

Revision 3 corrections: R-00 migration manifest; R-01b reviewed-only version differences; R-12 extended; per-segment
path encoding; R-16 deviation flushed to disk before the change, outcomes recorded separately, signed-in identity
verified. See the change report.

Also changed in revision 2: money in the fingerprint is compared as exact text (a scale difference such as `1500.0` versus
`1500.00` would previously have been hidden by `JSON.parse`); Auth rows are compared in full, not ids and emails only;
reconciliation steps R-07…R-14 all run and report before the drill stops, so one failure does not hide another.

---

## 10. Failure handling, abort and cutover (item 7)

The drill is **not re-entrant**: from R-02 the target is dirty and R-01 will refuse it. Every failure ends with "stop;
record; recreate the target". The target is never repaired by hand.

| Fails at | State left | Source written? | Action |
|---|---|---|---|
| R-00 | nothing written anywhere | no | the repository or manifest disagrees with the approved migrations: stop and report; never edit the manifest to make it pass |
| R-01 / R-01a | nothing written | no | new empty target; for R-01a, report the definition difference, which is a platform finding |
| R-01b | nothing written | no | identify what changed between the GoTrue/Storage versions; review; only then add an accepted entry and re-run against the same (still empty) target |
| R-02 | target partly migrated (each file all-or-nothing) | no | record the file and error; recreate the target. A migration defect is fixed only by a **new** forward migration, with approval |
| R-03 | target migrated | no (upload failed) | check the source key; recreate the target; re-run |
| R-04 | target migrated; sentinel present if D1 | sentinel only | fix the connection or version; recreate the target |
| R-05 | restore rolled back | sentinel only | record the psql error; recreate the target |
| R-06 | restored, some files copied | sentinel only | record the object and status; recreate the target |
| R-07…R-14 | loaded but different | sentinel only | keep the target untouched (R-15/R-16 do not run); Gavin diffs the fingerprints and classifies the cause (drill, product, platform) |
| R-15 / R-16 | loaded; R-16 may have reset one password | sentinel only | record; the deviation is already in the evidence |

The source is never written except the sentinel (D1). A failed drill never needs a source rollback. To abort at any
time, press Ctrl+C; the target is disposable; then delete `tests/recovery/.work`.

**Cutover:** none in this drill. The source stays the system of record and nothing is pointed at the target. For a real recovery later:
1. freeze writes on the source and take the final backup (the recovery point);
2. run R-00…R-16 against the new project, requiring `PASS_EXACT` or `PASS_WITH_CLASSIFIED_DIFFERENCES` with each difference accepted;
3. re-enter Vault and integration secrets, redeploy Edge Functions and their secrets, re-point connector keys;
4. switch the app's `SUPABASE_URL` and publishable key; users sign in again;
5. smoke test: sign-in, own business, available cash equal to R-11, one Vault download;
6. keep the old project read-only until the agreed period (D4) has passed.

**Abort a cutover:** before step 4, stop; the source is unchanged and authoritative. After step 4, switch the
config back; writes stay frozen until step 5 passes, so nothing made on the new project is lost.

---

## 11. Expected duration

Source database 14 MB, 4 users, 0–1 byte-bearing files. A few minutes, dominated by the psql migration calls and
network round trips. It is measured (`duration_seconds`), not judged, until D4 sets a target.
