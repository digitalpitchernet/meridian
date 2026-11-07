# Rev 2.2 validation: recorded results (preservation copy)

These results were taken from `qa.results` on `meridian-rev22-validation` (ref `cnelrrpmnbhylhivyybs`, region ap-northeast-2 (Seoul), org DigitalPitcherNetworks, PostgreSQL 17.11) on 7 November 2026, before the project was paused. The row-level results, migration texts, snapshots and migration log also remain in schema `qa` of the paused project.

Every migration file was re-hashed at preservation time and still matches the hash recorded when it ran (see VALIDATION-REPORT.md §3). `down.all.sql` = `6a798a124eb9180f`.

## Counts per test (final query, all runs)

| Test | Counts | | Test | Counts |
|---|---|---|---|---|
| BOOT-01…08 | PASS 8 | | FIN-X1…X5 | FAIL 5 |
| FIXTURES | PASS 1 | | C1 | FAIL 1 |
| SEC-01 | PASS 2, FAIL 1, INFO 30 | | C2 | FAIL 4 |
| SEC-02 | PASS 15 | | C3 | FAIL 3, INFO 1 |
| SEC-03 | PASS 5 | | C4 | FAIL 1, INFO 2 |
| SEC-04 | PASS 14 | | C5 | PASS 1, FAIL 2, INFO 1 |
| SEC-05 | PASS 4 | | PV-01 | PASS 2 |
| SEC-05x | PASS 4, FAIL 1 | | PV-02 | PASS 2 |
| SEC-07 | PASS 1, FAIL 2 | | PV-03 | PASS 5 |
| SEC-08 | PASS 1, FAIL 2, INFO 13 | | PV-04 | PASS 3 |
| SEC-09 | FAIL 2 | | PV-05 | PASS 4 |
| FIN-01 | PASS 2 | | PV-06 | PASS 3 |
| FIN-02 | PASS 3 | | PV-06b | PASS 1 |
| FIN-03 | PASS 6 | | PV-07 | PASS 6 |
| FIN-04a | PASS 3 | | PV-08 | PASS 5 |
| FIN-04b | PASS 4 | | PV-09 | PASS 5 |
| FIN-05 | PASS 2 | | PV-10 | PASS 2 |
| FIN-06 | PASS 2 | | PV-REG | PASS 5 |
| FIN-06x | PASS 1, FAIL 1 | | | |
| FIN-07 | PASS 4 | | | |
| FIN-08 | PASS 5 | | | |

Totals for Rev 2.2 as specified (before patches): **88 PASS, 25 FAIL, 47 INFO**. Patch verification (after patches): **43 PASS, 0 FAIL**.

## Patch verification: all 43 checks

| ID | Check | Result | Recorded detail |
|---|---|---|---|
| PV-01 | capital_targets insert works | PASS | OK 1 |
| PV-01 | allocation against a capital target works | PASS | OK 1 |
| PV-02 | target-level view flags 300000 vs 200000 target | PASS | over_allocated/100000.00 |
| PV-02 | structure view: under-allocated overall, 1 target over, targets exceed structure by 100000 | PASS | under_allocated/1/1100000.00/100000.00 |
| PV-03 | capital_structures currency frozen once children exist | PASS | 23514 |
| PV-03 | childless capital_structure can still change currency | PASS | OK 1 |
| PV-03 | funding_requirements currency frozen once commitments exist | PASS | 23514 |
| PV-03 | financial_accounts currency frozen once transactions exist | PASS | 23514 |
| PV-03 | businesses.base_currency frozen once accounts/transactions exist | PASS | 23514 |
| PV-04 | EUR→INR transfer with disagreeing legs rejected | PASS | 23514 Transfer legs do not reconcile: 1000.00 EUR at 90 = 90000.00 INR, but transfer_to_amount is 50000.00 |
| PV-04 | EUR→INR transfer with reconciled legs accepted (FIN-04a regression) | PASS | OK 1 |
| PV-04 | non-base transaction left at default rate 1 rejected | PASS | 23514 |
| PV-REG | allocation still drives commitment status (FIN-01 regression) | PASS | fulfilled |
| PV-05 | shrinking an allocated transaction rejected (X1) | PASS | 23514 |
| PV-05 | retyping an allocated transaction rejected (X5) | PASS | 23514 |
| PV-05 | non-financial edit (description) still allowed | PASS | OK 1 |
| PV-REG | reversal still allowed and cascades (FIN-03 regression) | PASS | OK 1 |
| PV-REG | cascade reversed allocation and commitment back to pledged | PASS | true/pledged |
| PV-05 | un-reversing rejected (X2) | PASS | 23514 |
| PV-06 | manual status edit is overridden by derived status (X3) | PASS | OK 1 → pledged |
| PV-06 | lowering committed_amount re-derives status (X4) | PASS | OK 1 → fulfilled |
| PV-06 | revoke is still possible | PASS | OK 1 → revoked |
| PV-06b | reimbursable founder expense starts pending (FIN-06x) | PASS | pending |
| PV-07 | overwrite rejected: other account | PASS | P0001 … belongs to a different account |
| PV-07 | overwrite rejected: already reversed | PASS | P0001 … is already reversed |
| PV-07 | overwrite rejected: transfer | PASS | P0001 … is a transfer transaction |
| PV-07 | overwrite rejected: same target twice | PASS | P0001 … overwrites the same transaction from more than one row |
| PV-07 | valid overwrite still commits (FIN-08 regression) | PASS | OK 1 |
| PV-07 | valid overwrite target reversed | PASS | true |
| PV-08 | claim takes the item with a lease | PASS | 1 claimed, lease 05:00 |
| PV-08 | item is not double-claimed while its lease is live | PASS | 0 claimed |
| PV-08 | expired lease is reclaimed (attempt 2) | PASS | 1 reclaimed; attempts=2 |
| PV-08 | late failure report cannot reopen a dispatched item | PASS | status=dispatched |
| PV-08 | lease expiring on the final attempt parks the item in dead_letter | PASS | status=dead_letter |
| PV-09 | anon holds no privilege on any public table | PASS | |
| PV-09 | authenticated holds no TRUNCATE/TRIGGER/REFERENCES/MAINTAIN | PASS | |
| PV-09 | commit_import_batch not executable by anon/PUBLIC | PASS | |
| PV-09 | anon UPDATE now raises 42501 (SEC-01 criterion) | PASS | 42501 permission denied for table projects |
| PV-09 | authenticated TRUNCATE refused (SEC-09) | PASS | 42501 permission denied for table subtasks |
| PV-REG | A still cannot read B projects (SEC-02 regression) | PASS | 0 |
| PV-REG | activity trigger still writes as user (SEC-04 regression) | PASS | user/projects.insert |
| PV-10 | A lists only its own vault folder despite a non-UUID path | PASS | 1 |
| PV-10 | A still cannot upload into B folder | PASS | 42501 new row violates row-level security policy for table "objects" |

## Credentials check

At preservation time, every file in this folder was scanned for JWTs, `service_role`/`sb_secret`/`sb_publishable` keys, API keys, passwords and connection strings, and none were found. The only identifiers here are the project ref, organisation name, region and the fixture users' `*@meridian.test` addresses. None of these are secrets.
