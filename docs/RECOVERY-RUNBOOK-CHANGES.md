# Recovery runbook: change report

For independent review. Nothing was executed in any round: no target project, no drill run, no write to either
validation project, no D1, migrations unchanged, Gate 2 paused.

## P-6 cleanup hardening (8 Nov 2026): P-6 still OPEN — UNVERIFIED

**Defect found in review.** After a failed `pg_ctl stop`, the harness treated **any** failure of `pg_ctl status` as
"not running". That covered exit 4, exit 1, a launch failure and a timeout, not only the documented exit 3. So cleanup
could be reported as successful while a server might still be running, and the data directory was then deleted anyway.

**Correction** (`pgctl.mjs`, used by `psql.test.mjs`):
- **Status classification:** `pg_ctl status` exit 0 = running, exit 3 = stopped (the documented code). Everything else
  is **unknown**: exit 4, exit 1, a launch failure, a timeout, or death by signal.
- **Status after every stop:** status is checked after every stop attempt, even one that reported success. If the
  server is not confirmed stopped after the graceful stop (`-m fast`), an immediate stop follows and is checked again.
- **Folder deletion:** the temp folder is deleted only if no start was attempted or the server is confirmed stopped.
  Otherwise the data directory is **preserved**, its exact path printed, and the test fails.
- **Hard assertion:** the exit code is non-zero unless the server is confirmed stopped **and** the folder is removed.
  The last line is `RESULT PASS` or `RESULT FAIL`, with the assertion and cleanup outcomes.
- **Timeouts:** every `pg_ctl`, `initdb`, `postgres` and `psql` call in the test has a 120 s timeout.
- **Expected failures must be genuine:** a test step that expects failure now counts only a genuine non-zero psql
  exit. A timeout, signal or launch failure is re-thrown, so it can't pass as the rollback being tested.
- **One shared-module change:** `psql.mjs` `run()` takes an optional options argument. `drill.mjs` passes none, so the
  drill's calls are unchanged.
- **Wording:** comments and the runbook no longer say `psql.test.mjs` "proves" atomicity. **Not changed** (outside
  this round's scope): `drill.mjs` line 135 still says "proven by psql.test.mjs"; correct it with the next authorised
  drill change.

**Tests run on this machine** (Windows, Node 24.15, PostgreSQL 17.11 client tools only; nothing installed; no Supabase):

| Test | Result |
|---|---|
| `pgctl.test.mjs` part 1, classification: exit 3 → stopped; exit 4, 1, 2 → unknown; ENOENT, EACCES, timeout, signal and empty errors → unknown; no error → running | pass |
| `pgctl.test.mjs` part 1, cleanup decisions with a scripted `pg_ctl` (cases below) | pass |
| `pgctl.test.mjs` part 2, **installed** `pg_ctl` 17.11 on throwaway folders: missing folder → `unknown (4)`; non-cluster folder → `unknown (4)`; cluster with no PID file → `stopped`; stale PID file → `stopped`; missing binary → `unknown (ENOENT)`; temp folder removed | pass |
| `compare`, `migrations`, `paths`, `evidence` tests | pass |
| `psql.test.mjs`, the only path reachable here (`initdb` fails: no `postgres.bki`) | `cleanup: start_attempted false, server "not started", dir_removed true, ok true`; `RESULT FAIL (assertions did not complete; cleanup ok)`; **exit 1**; 0 leftover temp folders |

**Cleanup behaviour by case** (scripted `pg_ctl`; the real lifecycle is still untested):

| Case | pg_ctl calls | Folder | ok |
|---|---|---|---|
| no start attempted (initdb failed) | none | removed | yes, but the test still fails because the assertions did not run |
| normal: graceful stop ok, status 3 | stop fast, status | removed | yes |
| start never completed: stop fails (no PID file), status 3 | stop fast, status | removed | yes |
| graceful "ok" but status 0 | stop fast, status, stop immediate, status (3) | removed | yes |
| graceful timeout, server running, immediate ok | stop fast, status, stop immediate, status (3) | removed | yes |
| both stops fail, still running | + immediate, status (0) | **preserved**, path printed | **no** |
| status exit 4, exit 1, ENOENT or timeout after both stops | + immediate, status | **preserved**, path printed | **no** |
| confirmed stopped but folder removal fails or the folder remains | stop fast, status | not removed | **no** |

**Still untested, so P-6 cannot pass:**
- real `initdb` and `pg_ctl start`;
- the real start-failure path;
- shutdown after a successful run;
- a real "still running" or "unknown" state;
- every PostgreSQL atomicity assertion (listed in the P-6 evidence section below).

## P-6 evidence (8 Nov 2026): OPEN — UNVERIFIED, execution blocked

**Harness correction** (`tests/recovery/psql.test.mjs`):
- everything from `initdb` onwards runs inside `try/finally`, so the temp folder is removed even if `initdb` or `pg_ctl start` fails (deletion is retried 5 times);
- once a start has been attempted, `finally` always runs `pg_ctl stop`; if that fails, `pg_ctl status` reports whether the server is still running;
- the binary versions are printed first and a `cleanup:` line last;
- the test exits non-zero if the folder survives or a server is still running.

A leftover empty folder from the first attempt (the defect this fixes) was found and removed.

**Environment search:** none suitable.
- `C:\Program Files\PostgreSQL\17` is a client-tools install (17.11, no `share/postgres.bki`).
- No other PostgreSQL server files were found in Program Files, ProgramData, AppData, scoop, msys64, cygwin or xampp.
- `wsl.exe` has no distribution; no Docker, Podman or PostgreSQL service.
- A cloud environment was not usable: the repository has no remote, and installing PostgreSQL there needs approval.

Nothing was downloaded or installed. No Supabase connection was made.

**Tested: the `initdb`-failure cleanup path only.**

```
binaries: postgres (PostgreSQL) 17.11 | initdb (PostgreSQL) 17.11 | psql (PostgreSQL) 17.11
initdb: error: file "C:/Program Files/PostgreSQL/17/share/postgres.bki" does not exist
cleanup: {"dir":"C:\\Users\\kunwa\\AppData\\Local\\Temp\\meridian-psql-test-O7J0yp","server":"never started","dir_removed":true}
exit code: 1
leftover meridian-psql-test-* folders: 0
```

**Not tested; P-6 cannot pass until they are:**

| Untested | Why |
|---|---|
| `pg_ctl start` failure path (stop attempted, status reported, folder removed) | needs a working `initdb` first |
| server shutdown after a successful run | needs a running server |
| every PostgreSQL atomicity assertion: success commits file + history row; an error mid-file leaves neither; a failing history insert rolls back the file; a syntax error leaves nothing; an inner `COMMIT` leaves partial SQL; a failed restore leaves no rows and undoes the TRUNCATE; replica mode skips trigger and FK | needs a running server |

Until the full test passes, the atomicity of R-02 and R-05 rests on the PostgreSQL 17 psql documentation for `-1`, not on a test.

## Revision 3 → 4 (8 Nov 2026): final focused corrections

| # | Issue | How it is addressed | Where |
|---|---|---|---|
| 1 | R-01 emptiness | Six counts: public tables, `storage.objects`, `storage.buckets`, `auth.users`, **`auth.identities`**, **`supabase_migrations.schema_migrations` rows**. Any non-zero fails R-01 with nothing written. A missing history table or schema counts as 0: the count is guarded by `to_regclass`, and `query_to_xml` is volatile, so `CASE` never evaluates it for a missing table. All six go into `evidence.target_counts` | `drill.mjs` R-01 |
| 2 | R-02 invocation | The exact arguments now live in `psql.mjs` (`migrationArgs`, `restoreArgs`, shared `run`), used by both the drill and the test. Reviewed against the PostgreSQL 17 psql docs: `-1` puts `BEGIN` before the first `-c`/`-f` and `COMMIT` after the last, and sends `ROLLBACK` instead if anything fails with `ON_ERROR_STOP`. So the stdin file (`-f -`) and the history insert (`-c`) are one transaction. The docs name two exceptions. R-00 now refuses (a) transaction control inside a file and (b) psql meta-commands (`\q` would end stdin early and commit a partial file). Statements that cannot run in a transaction make the whole call fail, which is still atomic. **Isolated test:** `psql.test.mjs` | `psql.mjs`, `psql.test.mjs`, `migrations.mjs` `transactionHazard`, runbook §4 |
| 3 | R-12 trigger scope | Restricted to triggers on tables in `public`: 55 today. That removes 12 platform triggers in `storage` and `realtime`. Platform-table triggers that matter to the restore are compared in R-01a. Meridian creates no trigger or index on a platform table (migrations checked). SQL comment and runbook §7 now state the same scope | `reconcile.sql`, runbook §7 |
| 4 | R-16 crash states | Each call: `not_attempted` → `outcome_unknown` written to disk **immediately before** the call → `confirmed_applied` (2xx) or `confirmed_refused` (4xx) only once the response proves it. No response, crash, timeout or 5xx stays `outcome_unknown`. The deviation itself is still durably recorded before anything is attempted. The sign-in is attempted only after a `confirmed_applied` reset | `evidence.mjs` `apiOutcome`, `drill.mjs` R-16, runbook §5 |
| 5 | Folder flush | `writeDurable`: temp file, fsync, rename, then fsync of the folder. On Windows Node cannot open a folder for fsync. **Observed `EPERM` on this machine**: recorded as `not supported on win32 (EPERM); NTFS journals the rename` in `evidence.persistence.directory_flush`. On POSIX a failure is an error | `evidence.mjs`, runbook §7 |
| 6 | Partial R-06 evidence | `evidence.files` is the live state, written to disk before each read, upload and read-back (`in_progress`) and after each object. On failure, `failed` (object, phase: `path_encoding` / `source_read` / `target_upload` / `read_back` / `read_back_sha256`, detail, time) is recorded and persisted before the stop. `copied` and `verified` (object, size, sha256) keep everything done up to that point. Transport errors are caught per phase; an upload with no response is marked outcome unknown | `drill.mjs` R-06, runbook §6 |

### What was actually tested in this round

| Test | Where it ran | Result |
|---|---|---|
| `evidence.test.mjs`: durable write (create, replace, stale temp file), folder flush result, `apiOutcome` for 2xx, 4xx, 5xx, 3xx, 1xx, thrown, missing | this machine (Windows, Node 24) | **passes**; folder flush recorded as `not supported on win32 (EPERM)` |
| `migrations.test.mjs`: previous cases plus 14 transaction-control or meta-command lines refused, 5 harmless lookalikes accepted (PL/pgSQL BEGIN/END, comments, identifiers, strings), line number reported, the 9 approved files clean | this machine | **passes** |
| `compare.test.mjs`, `paths.test.mjs` | this machine | pass (unchanged) |
| R-01 history count: missing table → 0, missing schema → 0, present → 9; `query_to_xml` volatility `v` | source, read-only (MCP) | as expected |
| R-12 trigger query restricted to `public` | source, read-only | 55 triggers |
| migrations scanned for transaction control, `\` lines, CONCURRENTLY/VACUUM, triggers or indexes on platform tables | repository | none; only 2 policies on `storage.objects` (compared in R-12) |
| `drill.mjs` | | syntax check only |
| **`psql.test.mjs`** | | **not run.** This machine has only the PostgreSQL client tools (`initdb` fails: no server share files), and has no Docker or WSL. It needs PostgreSQL 15+ server binaries; it creates and deletes a throwaway cluster on 127.0.0.1 and never touches Supabase. Until it runs, the R-02/R-05 atomicity rests on the psql documentation, not on a test. Runbook P-6 makes it a pre-execution requirement |

### Still not verified

- The end-to-end drill against Supabase.
- `psql.test.mjs` (above).
- The R-16 and R-06 crash paths are implemented and reviewed by reading the code. Only their building blocks (`writeDurable`, `apiOutcome`) are tested automatically.

---

## Revision 2 → 3: implementation corrections

| # | Issue | Fix |
|---|---|---|
| 1 | R-16 record only in memory | deviation persisted (temp file, fsync, rename) before the reset; outcomes persisted separately |
| 2 | Migration integrity | committed `approved-migrations.sha256`; R-00 requires exactly the 9 files with matching sha256 before any write; hashes in evidence; verified bytes piped to psql |
| 3 | R-12 narrow | ACLs incl. PUBLIC, column ACLs, RLS forced, view options, schema ACLs, default privileges, policy roles, function definitions and config, trigger definitions, full bucket row |
| 4 | Path encoding | `paths.mjs`, per-segment encoding with tests |
| 5 | R-16 identity | reset id, response `user.id` and token `sub` must equal the selected user |
| 6 | Platform versions | R-01b stops on any difference unless a reviewed entry exists in `accepted-platform-versions.json` |

## Revision 1 → 2: reviewer refinements

A1 full definitions (`platform-schema.sql`); `auth.identities` FK check; Storage compared field by field with
classification; exact versus platform-generated differences, nothing ignored; the A2 password change recorded;
scripts supplied. Also: money compared as text, full-row Auth comparison, a stricter index-only rule, and a clean exit on Windows.
