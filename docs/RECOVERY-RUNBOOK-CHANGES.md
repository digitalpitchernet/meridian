# Recovery runbook: change report

For independent review. Nothing was executed in either round: no target project, no drill run, no write to either
validation project, no D1, migrations unchanged, Gate 2 paused.

## Revision 2 → 3 (8 Nov 2026): implementation corrections

| # | Issue | How it is addressed | Where |
|---|---|---|---|
| 1 | R-16 deviation record only in memory | `persist()` writes `evidence/recovery-drill.json` through a temp file, `fsync` and rename. R-16 persists the deviation (`state: recorded, not yet applied`) **before** the password API call, then persists `password_reset` (time, status, returned id, state), then `sign_in` (time, status, token issued, ids, error), each separately. The target-dirty state is also persisted before R-02 | `drill.mjs` `persist()`, R-02, R-16; runbook §5 |
| 2 | Migration integrity | New committed manifest `tests/recovery/approved-migrations.sha256` (9 lines). **R-00** runs first, locally: exactly 9 `.sql` files, exactly the 9 listed, each sha256 equal, manifest well-formed with no duplicates; otherwise it stops with nothing written. Hashes go into `evidence.migrations`. The verified bytes are **piped** to psql, so the applied file is the hashed file | `migrations.mjs` + `migrations.test.mjs`, `drill.mjs` R-00/R-02; runbook §4 |
| 3 | R-12 too narrow | Now compares: relation ACLs with owner and **PUBLIC** entries; column ACLs; RLS enabled **and FORCE**; view `reloptions` (`security_invoker`); `public`/`storage` schema ACLs; default privileges (global + `public`, all roles); policies with permissive and roles; every `public` function's full definition md5 plus DEFINER, config, volatility, leakproof, owner, ACL; trigger definitions; the complete bucket row. Exclusions documented: platform schemas' internals, `qa`, bucket timestamps | `reconcile.sql` `security`; runbook §7 |
| 4 | Storage path encoding | `storagePath(bucket, name)`: each segment `encodeURIComponent`'d, `/` kept; empty, `.` and `..` segments refused. Used for the R-03 upload and every R-06 read, upload and read-back. R-06 now reads bucket and name as separate columns. Tests: spaces, NFC é, Devanagari, emoji, `# ? % & = + : @ ; , \ [ ]`, a literal `%2F`, bucket encoding, round trip, unsafe segments | `paths.mjs` + `paths.test.mjs`; `drill.mjs` R-03/R-06 |
| 5 | R-16 identity | Passes only if the reset response id, the sign-in response `user.id` **and** the access token's `sub` all equal the selected restored user's id. All three are recorded | `drill.mjs` R-16 |
| 6 | Platform versions auto-accepted | **R-01b** is separate from R-01a and stops (nothing written) on any GoTrue/Storage version difference, unless `tests/recovery/accepted-platform-versions.json` has an entry for exactly that pair with a reason, a reviewer and a date. The file is committed and empty. Accepted entries are copied into the evidence | `drill.mjs` R-01b; runbook §4, §10 |

Also found and fixed in this round: `ORDER BY 1` inside the fingerprint's aggregates sorted by a constant. Key order
doesn't affect the comparison (the diff walks keys by name), but the orders are now real, so `fingerprints.json` is deterministic.

Expected consequence: the target is created after the source, so a GoTrue or Storage update in between is plausible.
P-4 compares the versions read-only before the run, so any difference is reviewed beforehand rather than stopping the drill.

### Verification in this round

| Check | Result |
|---|---|
| `node tests/recovery/migrations.test.mjs` | passes: repository matches the manifest; changed byte, missing file, extra file, 8-line manifest, duplicate line, malformed line all caught; CRLF manifest accepted |
| `node tests/recovery/paths.test.mjs` | passes |
| `node tests/recovery/compare.test.mjs` | passes (unchanged rules) |
| extended R-12 `security` block on the source (read-only, MCP) | runs; 36 relation ACLs, 196 column ACLs, 30 tables all RLS-forced, 6 views, 2 schema ACLs, 7 default-ACL entries, 31 policies, 27 functions, 67 triggers, 1 bucket |
| manifest vs git | the 9 files are unchanged since `d1b884e`; their MD5s equal those verified on `xwopffsacsctvjjwnxnw` |
| `drill.mjs` | syntax check only |

### Still not verified

The end-to-end drill: psql and pg_dump against the pooler, psql reading migrations from stdin with `-f -`, Storage
upsert behaviour on a restored row, and the target Auth calls. `persist()` and the R-16 ordering are verified by
reading the code, not by an automated test.

---

## Revision 1 → 2 (8 Nov 2026): reviewer refinements

| # | Requested | Done |
|---|---|---|
| 1 | A1 must compare definitions | `platform-schema.sql`: per column type, nullability, default/generation, identity, generated, collation; all constraints, indexes, triggers; R-01a before any write |
| 2 | `auth.identities.user_id → auth.users.id` | added to `orphans.sql` (85 checks) |
| 3 | Storage: ids, owner, size, MIME, eTag, metadata; classify API-changed fields | every column of every object; only `updated_at`, `last_accessed_at`, `version`, `metadata.lastModified` may differ, and only on re-uploaded objects |
| 4 | Exact versus acceptable; nothing ignored | three evidence lists; results PASS_EXACT / PASS_WITH_CLASSIFIED_DIFFERENCES / INCOMPLETE / FAIL |
| 5 | Record A2's password change | `intentional_deviations` (now flushed to disk, revision 3) |
| 6 | Provide scripts | done |

Also fixed in revision 2: money compared as text (`JSON.parse` hid the scale), full-row Auth comparison, a stricter
definition of an index-only row, and a clean exit on Windows.
