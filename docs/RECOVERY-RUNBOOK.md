# Meridian Gate 1 Recovery Drill: Runbook (for review, not yet executed)

Status: **draft for independent review, 8 Nov 2026.** Nothing in this runbook has been run. The recovery target
does not exist yet. The nine migrations, both validation projects and Gate 2 are untouched.

Purpose: show that Meridian can be rebuilt in a separate, empty Supabase project from **the repository plus one
backup**, with the database, Auth users, stored files and security posture all identical to the source.
Automation: `tests/recovery/drill.mjs` (steps R-01…R-13), `tests/recovery/reconcile.sql` (fingerprint),
`tests/recovery/orphans.sql` (referential integrity).

| | Source | Target |
|---|---|---|
| Project | `meridian-g1-validation-clean`, ref `xwopffsacsctvjjwnxnw` | new, empty, created by the founder (name proposed: `meridian-g1-recovery-target`) |
| Org / region / plan | DigitalPitcherNetworks, ap-south-1, Free | same org, **same region**, Free |
| Role during the drill | read, except one sentinel file (decision D1) | written, disposable |
| Postgres | 17.11 | must be 17.x (checked in P-4) |

Not involved at any point: `ahphlozxsgifgwbtwoqb` (preserved), the paused Rev 2.2 project, LiqrIt, production.

---

## 0. Decisions needed before execution

| # | Decision | Recommendation |
|---|---|---|
| D1 | Allow the drill to write **one** 64 KB sentinel file into source Storage (`<business A>/recovery/sentinel-<time>.bin`). Without it the byte copy cannot be proven: the source holds 3 storage rows from SQL tests and **no file bytes** at all | Approve. It touches Storage only (no public table row, no document record). Keep it afterwards as evidence |
| D2 | Approve the script amendments A1–A6 (§9) before the run | Approve; I implement them, then this runbook is re-reviewed |
| D3 | Target project name and plan; the founder confirms the org can host one more Free project without pausing or changing either Meridian validation project | Create it only after D1/D2 |
| D4 | Recovery time and recovery point targets (Gate 1 report, founder item 15) | Record the measured time this run; set targets afterwards |
| D5 | After the drill: keep the target for review, or delete it | Keep until the Gate 1 evidence review closes |

---

## 1. Credentials and `.env` (item 3)

All values go only into the git-ignored `.env` in `C:\xampp\htdocs\meridian`. Gavin never sees or types them; the
pre-commit hook blocks secret keys. Passwords inside a URI must be URL-encoded (`@` → `%40`, `#` → `%23`, `/` → `%2F`).

| Variable | Value | Where to find it | Used by |
|---|---|---|---|
| `SUPABASE_URL` | `https://xwopffsacsctvjjwnxnw.supabase.co` | already set | R-03, R-06 |
| `SUPABASE_SERVICE_ROLE_KEY` | source **secret** key (the rotated one) | already set | R-03, R-06 |
| `SOURCE_DB_URL` | source **Session pooler** URI | source dashboard → Connect → Session pooler | R-01…R-13 |
| `TARGET_SUPABASE_URL` | `https://<target-ref>.supabase.co` | target dashboard → Settings → API | R-06, A2 |
| `TARGET_SERVICE_ROLE_KEY` | target **secret** key | target → Settings → API Keys | R-06, A2 |
| `TARGET_SUPABASE_ANON_KEY` | target **publishable** key (new, for A2) | target → Settings → API Keys | A2 |
| `TARGET_DB_URL` | target **Session pooler** URI | target → Connect → Session pooler | R-01…R-13 |
| `PG_BIN` | optional; default `C:\Program Files\PostgreSQL\17\bin` (present, pg_dump 17.11) | | all psql/pg_dump calls |

Session pooler URI shape: `postgresql://postgres.<ref>:<password>@aws-<n>-ap-south-1.pooler.supabase.com:5432/postgres`.
Use port **5432 (session)**, not 6543 (transaction): the restore sets `session_replication_role` and needs one session.
The direct `db.<ref>.supabase.co` host is IPv6-only on Free and may not resolve. The user must be `postgres.<ref>`, so
migrations run as `postgres` (spec L6).

---

## 2. Pre-flight (all read-only; nothing is written anywhere)

| Step | Who | Action | Pass |
|---|---|---|---|
| P-1 | Gavin (MCP) | Snapshot the source: 9 migration versions, 30 public tables, 4 users / 4 identities, 3 storage rows, 0 integration connections, 0 Vault secrets, orphans.sql = 0 | matches the values in this runbook |
| P-2 | Founder | Create the target (D3); fill `.env` (§1) | |
| P-3 | Gavin (MCP) | Target is empty: 0 public tables, 0 `storage.objects`, 0 `auth.users`, no `company-vault` bucket; Postgres 17.x | all zero |
| P-4 | Gavin (MCP) | Column parity of `auth.users`, `auth.identities`, `storage.objects` between source and target (also A1 in the script) | identical column lists |
| P-5 | Founder | Dry-run backup, reads the source only. In your own terminal, with the source Session pooler URI in place of `<SOURCE_DB_URL>`: `& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" "<SOURCE_DB_URL>" --data-only -t auth.users -f tests\recovery\.work\dryrun.sql`, then delete the file | exits 0, file non-empty |

P-5 proves the pooler URI, the password and the `postgres` role's read access to `auth` before anything is written.

---

## 3. Backup procedure for the source (item 1)

Performed by `drill.mjs` R-03 and R-04:

1. **R-03 sentinel** (D1): upload 64 KB of random bytes to `company-vault/<business A>/recovery/sentinel-<ms>.bin` through
   the Storage API with the source secret key. Its sha256 is printed.
2. **R-04 data backup**:
   ```
   pg_dump <SOURCE_DB_URL> --data-only --no-owner --no-privileges
           -t 'public.*' -t auth.users -t auth.identities -t storage.objects
           -f tests/recovery/.work/data.sql
   ```
   - **Data only**: the schema comes from the repository migrations, never from the dump. That is the point of the drill.
   - Included: all 30 public tables (no sequences exist), `auth.users`, `auth.identities`, the `storage.objects` index.
   - Excluded on purpose: sessions, refresh tokens, MFA claims, one-time tokens, audit log (users sign in again on the target); the `qa` test schema; Supabase internal schemas.
   - The dump's size and sha256 go into the evidence, so the restored file is provably the backed-up file.
3. **File bytes** are not in the dump. They are read from source Storage in R-06 (§5).

The dump holds bcrypt password hashes of the 4 test users and every business record. It stays in
`tests/recovery/.work/` (git-ignored) and is deleted after the drill (§8, step 9).

---

## 4. Restore procedure into the empty target (item 2)

1. **R-01** stop unless the target has 0 public tables, 0 storage objects and 0 Auth users.
2. **R-02** apply `supabase/migrations/*.sql` in filename order with psql, each in its own transaction with
   `ON_ERROR_STOP`, recording each version in `supabase_migrations.schema_migrations`. This builds every table, function,
   grant, policy, trigger and the private `company-vault` bucket from the repository alone. MCP is not used on the target.
3. **R-05** restore the dump **in one transaction**:
   ```
   SET session_replication_role = replica;
   TRUNCATE public.installation_settings;   -- the migration's default row; the source row is restored
   \i data.sql
   SET session_replication_role = origin;
   ```
   Replica mode stops guard, immutability and activity triggers from firing on history that is being reloaded (otherwise
   reversed transactions would be refused and activity would be duplicated). It also skips foreign-key triggers, so
   referential integrity is re-checked afterwards (orphans.sql, A4). CHECK, NOT NULL and UNIQUE constraints are still
   enforced during the load. Any error rolls the whole restore back.

   Note: `installation_settings.max_workspaces` is restored as **2**, the validation value, because the target is a copy.

---

## 5. Auth users and relationships (item 4)

- `auth.users` and `auth.identities` are restored row for row: same ids, emails, confirmation state, and the same bcrypt
  hashes, so a user's password would work on the target. These rows were created by GoTrue itself (Admin API), so every
  column GoTrue needs is non-NULL. That is the opposite of the HTTP 500 case, where SQL-inserted users had NULL token columns.
- Relationships to `auth.users` from Meridian: `profiles.id` and `businesses.created_by_user_id`. Both come back with
  the same ids in the same transaction; orphans.sql checks both (they are among the 84 public foreign keys).
- Not restored: sessions and refresh tokens. Every user signs in again on the target, and access tokens issued by the
  source are not valid on the target, which has its own signing keys.
- Proof that GoTrue can use the restored users (A2): the Admin API on the target lists the same 4 ids, confirmed. Then
  one restored user gets a new random password through the target Admin API (a change to the target only) and signs in
  with the target publishable key: HTTP 200 and an access token.
- Nothing is written to Auth tables outside the single restore transaction. No Auth schema object is changed.

---

## 6. Vault and Storage objects (item 5)

Two layers are restored separately and then compared:

| Layer | Source of truth | How it moves |
|---|---|---|
| Index rows (`storage.objects`: id, bucket, name, owner, metadata) | the pg_dump | restored in R-05 |
| File bytes | source Storage | R-06: for each indexed object, GET the bytes with the source secret key, upload to the same path on the target with the target secret key (`x-upsert: true`, because the row already exists), GET it back from the target and compare sha256 |

- Rows with no bytes in the source (today: the 3 rows the SQL security suite inserted directly) are recorded as
  `metadata_only` and stay index-only, exactly as in the source.
- `public.documents` (1 SQL fixture row, whose storage key has no bytes in the source either) is restored with the
  other public tables; its sha256 list is compared in R-11.
- The bucket is not restored from data: migration 6 creates it, and R-12 compares id, public flag and the 50 MB limit.
- Known gap, checked by A3: re-uploading with the service key can rewrite `owner_id` and Storage-generated metadata on
  the row. In this drill every byte-bearing object (the sentinel) was uploaded by the service key, so nothing should
  differ. With real founder uploads it would, and that needs a Gate 2 decision (restore owner columns from the dump,
  or accept the change).
- External connector files (`storage_provider = 'external_connector'`) are out of scope: there are none, and they live
  on the founder's hosting, backed up there (connector README).
- Supabase Vault secrets cannot be copied (ciphertext is bound to the project key). There are 0 today. In a real
  recovery, integration secrets are entered again.

---

## 7. Verification and acceptance criteria (item 6)

`reconcile.sql` produces one JSON fingerprint per database. `drill.mjs` compares source and target field by field.
**Every row below must PASS; any difference fails the drill.** No tolerance applies to money: values are compared as
`numeric(15,2)` text.

| Area | Step | What is compared | Pass |
|---|---|---|---|
| Target clean | R-01 | public tables, storage objects, auth users on the target | all 0 before the restore |
| Schema | R-02, R-07 | 9 migration files applied; version list | identical 9 versions |
| Schema posture | R-12 | table grants, column grants, policies (public + storage), RLS-enabled tables, function ACLs + SECURITY DEFINER flags, triggers (excluding `qa`), bucket | identical hashes |
| Every record | R-08 | all 30 public tables: row count and md5 of every full row | identical for all 30 |
| Financial records | R-11 | per business: available cash and every account balance as of 2100-01-01, live transaction sum, reversed count | identical |
| Allocations | R-08, R-11 | `payment_allocations` full rows; live allocation sum per business | identical |
| Commitments | R-08, R-11 | `funding_commitments` full rows; derived status counts per business from `vw_funding_commitment_status` | identical |
| Activity history | R-08 | `activity_records` full rows (also proves no trigger fired during the restore) | identical row count and md5 |
| Auth | R-09, A2 | user ids + emails, identity count; GoTrue lists them; one restored user signs in on the target | identical; 200 + token |
| Storage index | R-10, A3 | bucket/name list; owner, size, mimetype, eTag per object | identical |
| Stored files | R-06 | every byte-bearing object copied and its sha256 re-read from the target; sentinel included | copied = verified ≥ 1 |
| Document hashes | R-11 | md5 of the sorted `documents.sha256` list per business | identical |
| Referential integrity | A4 | orphans.sql on the target | 0 for all 84 foreign keys |
| Overall | R-13 | the full fingerprint | zero differences |

Gavin's read-only follow-up on the target (MCP, after the script reports):
1. orphans.sql again, independently of the script;
2. the security advisor: expected 0008 ×1 INFO, 0029 ×8 WARN, leaked-password ×1 WARN, and **no** 0011 (`qa` is not restored);
3. `qa` schema absent on the target.

Evidence: `evidence/recovery-drill.json` (steps, dump size and sha256, sentinel key and sha256, duration). The fingerprints
go to `tests/recovery/.work/fingerprints.json` for diff analysis; they are not committed.

---

## 8. Execution sequence and who does what (item 8)

| # | Founder | Gavin |
|---|---|---|
| 1 | Review this runbook; decide D1–D5 | Implement A1–A6 once approved; re-test the script offline; update this runbook |
| 2 | | P-1 source snapshot (read-only) |
| 3 | Create the target project; fill `.env` (§1) | |
| 4 | | P-3, P-4 on the target (read-only) |
| 5 | P-5 dry-run backup; report exit code | |
| 6 | Run `node tests/recovery/drill.mjs --allow-source-sentinel`; paste the full output | |
| 7 | | Analyse; run the §7 follow-ups; classify any difference |
| 8 | | Update the Gate 1 report, evidence and manifest; commit |
| 9 | Delete `tests/recovery/.work` (`Remove-Item -Recurse -Force tests\recovery\.work`) | Confirm it is gone and was never committed |
| 10 | Decide D5 (keep or delete the target) | |

Gavin does not: hold or enter credentials, run the credentialed scripts, create, pause, reset or delete projects,
or write to either validation project.

---

## 9. Script amendments proposed before execution (D2)

The current `drill.mjs` covers R-01…R-13. Review found these gaps; none touches the migrations or product code.

| # | Amendment | Why |
|---|---|---|
| A1 | Before any write: compare the column lists of `auth.users`, `auth.identities`, `storage.objects` (source vs target) and stop on a difference | A Supabase platform version skew would otherwise fail mid-restore |
| A2 | After R-09: GoTrue Admin API on the target lists the 4 restored ids; set a random password on one restored user (target only) and sign in with `TARGET_SUPABASE_ANON_KEY` | Proves the restored users are usable by Auth, not just present as rows |
| A3 | Extend the `storage_objects` fingerprint with owner_id, size, mimetype and eTag | Detects ownership or metadata lost in the byte copy |
| A4 | Run orphans.sql on the target as R-14 | Replica mode skipped FK triggers |
| A5 | Refuse to write the sentinel unless `--allow-source-sentinel` is passed | Makes the only source write explicit (D1) |
| A6 | On any failure after R-01, state in the output and the evidence that the target is now dirty and must be recreated | Prevents re-running into a half-restored target |

---

## 10. Failure handling, abort and cutover (item 7)

The drill is **not re-entrant**: once R-02 starts, the target is no longer empty and R-01 will refuse it. Every failure
below ends with "stop; record; recreate the target"; the target is never repaired by hand.

| Fails at | State left behind | Source affected? | Action |
|---|---|---|---|
| R-01 | nothing written | no | find out why the target is not empty; use a new empty project |
| R-02 | target partly migrated (each file all-or-nothing) | no | record the failing file and error; recreate the target. A migration defect is a Gate 1 finding, fixed by a **new** forward migration only after approval |
| R-03 | nothing new | no (upload failed) | check the source secret key; re-run (target is migrated, so recreate it first) |
| R-04 | sentinel in source; target migrated, no data | sentinel only | fix the connection or version; recreate the target; re-run (a second sentinel is added) |
| R-05 | restore rolled back as a whole | sentinel only | record the psql error; recreate the target |
| R-06 | target restored, some files copied | sentinel only | record the object and status; recreate the target |
| R-07…R-14 | target fully loaded but different | sentinel only | do not fix; keep the target; Gavin diffs the fingerprints and classifies (drill defect vs product defect vs platform) |

The source is never written except the sentinel, so a failed drill never needs a source rollback. Abort at any time:
stop the script (Ctrl+C). The target is disposable; then delete `tests/recovery/.work`.

**Cutover** (none in this drill: the source stays the system of record and nothing is pointed at the target). For a real
recovery later, the documented procedure is:

1. Freeze writes on the source (maintenance notice; revoke client access) and take the final backup: this is the recovery point.
2. Run steps R-01…R-14 against the new project; all must PASS.
3. Re-enter Supabase Vault and integration secrets; redeploy Edge Functions and their secrets; re-point the PHP connector
   keys if used.
4. Switch the app's `SUPABASE_URL` and publishable key to the new project. Users sign in again.
5. Smoke test: sign-in, read own business, available cash equals R-11, one Vault download.
6. Keep the old project read-only, unchanged, until the new one has run cleanly for an agreed period (D4).

**Abort a cutover:** before step 4, simply stop: the source is unchanged and still authoritative. After step 4, switch the
app config back to the source; any writes made on the new project during the window must be exported and re-entered,
which is why writes stay frozen until step 5 passes.

---

## 11. Expected duration

Source database 14 MB, 4 users, 1 to 4 files. Expected drill time a few minutes, dominated by the 9 psql migration calls
and network round trips. It is measured and recorded (`duration_seconds`), not judged, until D4 sets a target.
