# Review: M3 finance audit and schema-revisions proposal

**Date:** 8 Nov 2026 · **Reviewer:** Gavin (implementation) · **Baseline:** `277223f`

**Documents reviewed** (both written in a separate Claude Code run and committed alongside this review, unchanged):
- `docs/M3-FINANCES-AUDIT.md`
- `docs/SCHEMA-REVISIONS-PROPOSAL.md`

This review applies no migration and changes none of the nine Gate 1 migrations or their hashes. The corrections
below are proposals for the founder.

---

## 1. `M3-FINANCES-AUDIT.md`

### 1.1 Discrepancies in the audit itself

| # | Finding | Severity | Correction |
|---|---|---|---|
| A-1 | **Its F1–F12 table is not the approved F1–F12** (`ENGINEERING-SPEC.md` §4, "Financial model and invariants"). It invents its own twelve items (for example "F4 cash from views", "F5 CSV atomic", "F12 activity on every write"). Its conclusion "all 12 invariants verified" therefore says nothing about the real invariants | **High** | Replace with §1.2 below |
| A-2 | "F12: activity ledger on every write" is false and not an invariant: `record_activity()` is attached to selected operations only (for example transactions and allocations on INSERT only) | Medium | Drop |
| A-3 | "F1: `guard_transaction_update` trigger (42501)": wrong code. The trigger raises `23514`; `42501` comes from the column grants (FIN-27 vs FIN-38..40) | Low | Correct the code |
| A-4 | "Production-ready for the development adapter" overstates it: concurrency (F4's `FOR UPDATE`) cannot be exercised in the single-threaded development adapter, and the Supabase adapter does not exist | Medium | Say "complete on the development adapter; concurrency verified only by the SQL suite" |
| A-5 | "README says not built yet": since corrected (`ea4f5db`) | Closed | none |

### 1.2 M3 against the approved F1–F12

| ID | Invariant | Database / adapter | Screens | Evidence | Gap |
|---|---|---|---|---|---|
| F1 | A pledge is not money | `vw_funding_commitment_status.received_amount` = live allocations only | Commitments, Reports and the Command Centre label committed as pledges and show received separately | FIN-01; reports consistency test | none |
| F2 | Status derived, never stored | view only; no status column | read from the view everywhere | FIN-03/05/14/23/29/33 | none |
| F3 | Partial and multiple payments | `payment_allocations` many-to-many | allocate from a receipt or from a commitment, any amount | FIN-02..07 | none |
| F4 | No allocation beyond the receipt, even under concurrency | guard re-sums before insert | — | FIN-12 | **Concurrency is untestable in the development adapter** (single-threaded); covered only by the SQL suite on Postgres |
| F5 | Only eligible money | participant and contribution-type checks | picker pre-filters; server decides | FIN-08..11 | none |
| F6 | Append-only; correction = reversal + new transaction (`replaces_transaction_id`) | frozen columns, no delete | annotate or reverse only | FIN-20..27, repository test | **G-F1: a manual correction cannot set `replaces_transaction_id`** (not client-insertable; only `commit_import_batch` sets it), and "reverse then record" is two calls, not one transaction. README F-1 |
| F7 | Reversal final, cascades | cascade trigger, activity with count | reverse dialog states the cascade | FIN-21..25, 37..39 | none |
| F8 | Allocated history protected | no DELETE; revoke only after allocations reversed | revoke blocked with the reason | FIN-30..35, ledger test | none |
| F9 | Over-allocation visible | target/structure views | Capital and commitments show it in red | FIN-14, 73, 74 | none |
| F10 | Cash as of a date | `get_available_cash` / `get_account_balances` | as-of picker; Reports; Command Centre | CASH-01..18 | Reversals are undated (A12, deferred) |
| F11 | Loans and reimbursements separate from capital | `settles_transaction_id` + settlement views | owed list, settle flow, participant table | FIN-50..61 | none |
| F12 | CSV validated, duplicate-aware, atomic | prepare/commit emulated; atomic | stage, decide, commit | CSV-01..32 | **G-F2: in-file duplicates are flagged only inside the commit and rolled back when it refuses**; the screen derives them from `fingerprint`. README F-2 |

**Incomplete workflows (not invariant failures):**
- **Categories:** there is no screen to create or rename them; the repository supports it.
- **Recurring templates:** read-only (posting is Gate 2, A5).
- **Burn and runway:** not defined (README F-3, R-2).
- **CSV staging:** done row by row in the development adapter; the Supabase adapter should insert rows in one request.

---

## 2. `SCHEMA-REVISIONS-PROPOSAL.md` against the approved decisions

### 2.1 Blocking defects (the migrations as written would not work)

| # | Finding | Correction |
|---|---|---|
| S-1 | **Migration numbering collides with the baseline.** It labels the new files "Migration 7..11 of 14", but migrations 7, 8 and 9 already exist (`pin_function_search_path`, `close_function_default_execute`, `cash_result_scale`). Its file names `20261108_001_…`..`_005_…` all share the version prefix `20261108`, so the Supabase CLI would treat them as one duplicated version | Number them 10–14 with full 14-digit timestamps (for example `20261108120000_contact_archiving.sql`), after `20261107183617` |
| S-2 | **G3 trigger blocks G4.** On a terminal row any status change raises (`NEW.status IS DISTINCT FROM OLD.status`) before the `superseded_by_id` branch is reached, so Approved/Rejected → Superseded is impossible, including inside `supersede_decision()` (SECURITY DEFINER does not bypass triggers) | Allow exactly one terminal transition: `Approved`/`Rejected` → `Superseded`, with `superseded_by_id` set in the same UPDATE and every other column unchanged |
| S-3 | **G4 RPC does not compile.** (a) A parameter without a default follows one with a default (`p_new_decision_date DEFAULT …` then `p_new_review_date`); (b) `FOREACH … IN ARRAY p_options` over `jsonb` is invalid | Put defaulted parameters last; iterate with `jsonb_array_elements(p_options)` |

### 2.2 Discrepancies with the approved decisions

| Decision | Finding | Correction |
|---|---|---|
| **G2** (archive *instead of* deletion; historical relationships kept) | (a) Client `DELETE` is kept "for hard removal", which cascades away `project_contacts`, `document_links` and interactions: the history G2 protects. (b) `archived_at` is client-writable, so a client can back-date or forge it (contrary to the G7 principle that the database owns timestamps). (c) "Migration 11" changes RLS to hide archived contacts. That is outside G2, makes archived contacts unreadable wherever they are referenced (decisions, events, links), makes restore impossible (USING hides the row), and depends on a custom setting PostgREST requests cannot set | (a) Founder decision: revoke client DELETE on `contacts` (recommended) or keep it with a stated reason. (b) Client grant on a boolean or an `archive_contact` / `restore_contact` RPC; the database stamps `archived_at = now()` / NULL. (c) **Drop migration 11**; filter `archived_at IS NULL` in list queries |
| **G3** (decided decisions protected in the database) | (a) No DELETE protection: clients can still delete an Approved/Rejected/Superseded decision and its options. (b) `decision_options` of decided decisions stay editable and deletable. (c) Drops and re-adds the status CHECK with identical values under a guessed constraint name (no effect, may fail) | (a) BEFORE DELETE guard: only `Proposed` decisions are deletable. (b) Guard on `decision_options`: no insert/update/delete when the parent is not `Proposed`. (c) Remove the CHECK rewrite |
| **G4** (replacement, its options **and its outcome** in one transaction; any failure leaves the original unchanged) | (a) Creates the replacement as `Proposed`, with no outcome. (b) `p_new_selected_option_id` cannot reference an option created inside the call. (c) **Overwrites the original's `rationale`** with the new one, which destroys history. (d) No `FOR UPDATE` on the original. (e) "Not found" raises `42501`; existing RPCs use `P0002` | (a, b) Take the outcome as an index into `p_options`; insert the replacement as `Approved` with that option selected (the FK then holds). (c) Never touch the original except `status` and `superseded_by_id`. (d) Lock the original. (e) `P0002` |
| **G6** (rationale enforced in the database) | Enforced on every terminal row, including rows already terminal before the migration, which then cannot be superseded. The proposal leaves this to an unspecified backfill ("High" risk, §12): writing rationale text into historical records would fabricate history | Enforce only on the transition `Proposed` → `Approved`/`Rejected` (and on direct terminal inserts). Existing rows are left as recorded, and the supersede transition does not re-check the old row's rationale |
| **G7** (database owns `achieved_at`, following the task-completion principle) | (a) Trigger is `BEFORE UPDATE` only; `trg_tasks_completion` is `BEFORE INSERT OR UPDATE OF status`, so a milestone created as `Achieved` keeps a NULL `achieved_at`. (b) Backfill sets `achieved_at = created_at`, which fabricates an achievement date | (a) `BEFORE INSERT OR UPDATE OF status`. (b) No backfill: existing values were written by the app and are kept; NULL means "date unknown" (Reports already treats it so) |

### 2.3 Minor

- **SECURITY DEFINER on guard triggers:** the proposal puts it on functions that only modify `NEW`. The existing guards are plain functions; use least privilege.
- **Explicit grants:** follow the existing pattern — `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated` and then `GRANT EXECUTE … TO authenticated`, plus a privilege test like CASH-20. Migration 8's default-privilege revoke already applies, but the explicit pair is the house pattern.
- **Error codes:** use `23514` for business rules (as all existing guards do) and keep `42501` for privilege or permanent-provenance refusals.

### 2.4 Register reconciliation (G1, G5, G8 and the wider hardening list)

**What the proposal leaves out:** it never mentions G1, G5 or G8. Their recorded statuses stand and are not reopened:
- G1 Deferred;
- G5 Accepted;
- G8 Closed: decision reviews stay app-side, and the G3 guard above keeps `review_date` frozen on decided rows, consistent with the read-only app behaviour.

**Proposed scope:** the proposal should state that it covers G2, G3, G4, G6 and G7 only, and carry this list of items for the *assessment* stage of the future schema hardening. Every one stays at its recorded status; none is approved for implementation:

| Item | Source | Recorded status |
|---|---|---|
| V-3: database enforcement of linear document history (one successor per `previous_version_id`) | Vault dispositions | Accepted as app rule; DB enforcement to be assessed |
| G-F1: atomic correction RPC (reverse + replacement with `replaces_transaction_id`) | §1.2, F6 | New finding: needs a founder decision |
| G-F2: expose in-file CSV duplicates before commit | §1.2, F12 | New finding: needs a founder decision |
| A12: dated reversals (`reversal_effective_date`) | Register | Deferred (Gate 2) |
| V-2: upload state for documents | Vault dispositions | Deferred until storage integration |
| A17: Vault caching / no residual access | Register | Design approved; no implementation authorised |

### 2.5 Verdict

The proposal is **not ready for approval**: S-1..S-3 would fail on first execution, and the G2, G3, G4, G6 and G7
discrepancies above change approved behaviour. Its structure (forward-only migrations, rollback notes, test plan)
is sound and can be kept. Recommended next step: a corrected revision of the proposal document only (no migrations
written to `supabase/`), then founder approval.
