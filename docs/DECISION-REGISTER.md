# Meridian engineering decision register

Founder decisions that change or confirm product and engineering behaviour. Each entry states what was decided, what
it changes, and where the work is tracked. Earlier Gate 1 approval items are listed in `docs/GATE-1-REPORT.md` §9.

| Status | Meaning |
|---|---|
| **Accepted** | Current behaviour confirmed; no change |
| **Approved: schema revision** | To be implemented by a future, separately authorised migration (not yet written, not executed) |
| **Deferred** | Not in V1 unless revisited |
| **Closed** | Done; no further action |

## 8 Nov 2026: M2 schema gaps (app/README.md, "M2: schema gaps")

| ID | Topic | Decision | Status | Follow-up |
|---|---|---|---|---|
| G1 | Milestone start date | Keep the due-date-only model for V1. No migration | **Deferred** | none |
| G2 | Contact archiving | Contacts become archivable instead of relying on deletion. Prefer an `archived_at` timestamp, so the archive state is explicit and historical relationships are kept | **Approved: schema revision** | Schema-hardening proposal |
| G3 | Decision immutability | Approved, Rejected and Superseded decisions are protected **in the database**, not only by the app | **Approved: schema revision** | Schema-hardening proposal |
| G4 | Atomic supersession | A transactional RPC creates the replacement, its options and its outcome, and supersedes the original in one transaction. Any failure leaves the original unchanged and no partial replacement | **Approved: schema revision** | Schema-hardening proposal |
| G5 | Decision participants | V1 keeps one project and one contact per decision; no relationship table | **Accepted** | none |
| G6 | Outcome rationale | The rationale requirement is enforced in the database as well as the app | **Approved: schema revision** | Schema-hardening proposal |
| G7 | `milestones.achieved_at` | The database owns the timestamp (trigger or equivalent), following the task-completion principle | **Approved: schema revision** | Schema-hardening proposal |
| G8 | Decision reviews in the Command Centre | Current implementation accepted; no schema change | **Closed** | none |

Constraints on the follow-up:
- the nine Gate 1 migrations and their hashes stay unchanged (new forward migrations only);
- no migration is executed and no Supabase environment is touched until separately authorised;
- until the revision ships, the app keeps its current behaviour: decision rules in the app, the client sets `achieved_at`, and delete with confirmation for contacts.
