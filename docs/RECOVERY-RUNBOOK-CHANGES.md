# Recovery runbook: change report, revision 1 → 2 (8 Nov 2026)

For independent review. Nothing was executed: no target project, no drill run, no write to either validation
project, migrations unchanged, Gate 2 not started. D1 (source sentinel) remains **not approved** and is enforced by the script.

## Reviewer refinements

| # | Requested | Done | Where |
|---|---|---|---|
| 1 | A1 must compare definitions, not names | Per column: type with modifiers, NOT NULL, default or generation expression, identity, generated flag, collation. Plus every constraint, index and trigger definition. For `auth.users` (35 columns), `auth.identities` (9), `storage.objects` (15). Stops before any write | `platform-schema.sql`, drill R-01a |
| 2 | Check `auth.identities.user_id → auth.users.id` explicitly | Added as an 85th check next to the 84 public foreign keys | `orphans.sql`, drill R-14 |
| 3 | Storage reconciliation: ids, owner, size, MIME, eTag, metadata; classify API-changed fields | Every column of every object compared individually. Only `updated_at`, `last_accessed_at`, `version` and `metadata.lastModified` may differ, and only on objects R-06 re-uploaded. id, owner, owner_id, size, mimetype, eTag, cacheControl and the rest must be exact. Re-uploads now send the source's mimetype and Cache-Control | `reconcile.sql`, `compare.mjs`, drill R-06/R-10, runbook §6 |
| 4 | Distinguish exact from acceptable platform differences; ignore nothing | Every difference is put in one of three lists in the evidence: `platform_generated` (with reason), `platform_version` (with reason), `unexpected` (fails). Results: `PASS_EXACT`, `PASS_WITH_CLASSIFIED_DIFFERENCES`, `INCOMPLETE`, `FAIL` | `compare.mjs`, drill `finish()`, runbook §7 |
| 5 | Document A2's password change and record it in the evidence | R-16 writes `intentional_deviations` (user, fields, reason, time, target-only) **before** changing anything. Fingerprints are taken before R-16. R-15/R-16 are skipped if anything earlier failed | drill R-16, runbook §5 |
| 6 | Provide the scripts, not only the runbook | Files below | |

## Files changed

| File | Change |
|---|---|
| `tests/recovery/drill.mjs` | rewritten: R-01a, R-03 gated by `--allow-source-sentinel`, stricter R-06, classified R-07…R-13 that all report before stopping, R-14, R-15, R-16, `target_state`, result vocabulary, clean exit on Windows |
| `tests/recovery/platform-schema.sql` | new (A1) |
| `tests/recovery/reconcile.sql` | full-row Auth fingerprints; per-object Storage fields; money as `numeric(15,2)` text |
| `tests/recovery/compare.mjs` | new: diff and classification |
| `tests/recovery/compare.test.mjs` | new: 7 groups of assertions |
| `tests/recovery/orphans.sql` | `auth.identities` check added |
| `docs/RECOVERY-RUNBOOK.md` | revision 2 |

## Additional issues found during this revision

1. **Money scale could be hidden.** `JSON.parse` turned `"1500.00"` into `1500` in the fingerprint, the same trap as
   HTTP H-FIN-06. Revision 1's claim that money was compared as text was therefore wrong. Now every amount is emitted as text.
2. **Exit code on Windows.** `process.exit()` with an open fetch socket aborts Node 24 on Windows (exit 127). The
   drill now exits through `process.exitCode`, as `run.mjs` and `provision-users.mjs` already do.
3. **The previous Auth check only covered ids and emails.** Now full rows.
4. **Index-only versus failed read.** Revision 1 treated any failed source read as index-only. Now only a NULL-metadata
   row with a 400 not-found counts; anything else fails R-06.
5. **R-06 reads may touch the source.** Storage may update `last_accessed_at` when an object is read. Documented. It
   cannot happen without D1, because there is nothing to read.

## Verification done (read-only, source only)

| Check | Result |
|---|---|
| `platform-schema.sql` on the source | ran; 35 / 9 / 15 columns; constraints, indexes and triggers captured; generated `confirmed_at` and `path_tokens` reported correctly |
| `orphans.sql` on the source | 85 checks, 0 orphans |
| `orphans.sql` detection | a deliberately orphaned composite-key temp-table row was counted, the NULL-key row ignored (rolled back, nothing left) |
| `reconcile.sql` on the source | ran; 30 tables, 9 migrations, 4 users / 4 identities as full-row md5, 3 objects field by field, amounts as text (`"1500.00"`) |
| `compare.test.mjs` | all assertions pass |
| `drill.mjs` | syntax check only |

## Not verified

`drill.mjs` has **not been run end to end**. That needs the target and your credentials. In particular, these are
unproven until the run:
- the psql and pg_dump calls against the pooler;
- the Storage upsert behaviour on a restored row (whether `id` and `owner_id` survive, which R-10 will report);
- the R-15/R-16 Auth calls on the target.

The `auth.identities` orphan row is a plain `NOT EXISTS` and was not separately tested against a deliberate orphan,
because the real Auth tables must not be altered.
