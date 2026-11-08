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

---

## 8 Nov 2026: Gate 1 founder approvals (GATE-1-REPORT.md §9 — 17 items)

Reconciliation of the 17 items from the Gate 1 report. Items already implemented in code are **Accepted**; items requiring future migrations are **Approved: schema revision**; items not in V1 are **Deferred**; items fully resolved are **Closed**.

| ID | Topic | Decision | Status | Follow-up |
|---|---|---|---|---|
| A1 | Commitment status derived, not stored | The view `vw_funding_commitment_status` computes status from payments vs. committed amount. No status column on `funding_commitments`. Confirmed as designed. | **Accepted** | none (implemented in migration 4, view in migration 5) |
| A2 | Transactions fully immutable | Append-only: only `category_id`, `description`, `reference`, `notes` editable. Amount, date, type, account immutable. Corrections via reversal RPC + new entry. Enforced by column grants + CHECK + triggers. | **Accepted** | none (implemented in migrations 3-5, column grants + SEC-COL tests) |
| A3 | No `is_cleared` / bank reconciliation flag in V1 | Bank reconciliation not in V1 scope. Can be added in a future milestone if needed. | **Deferred** | Future milestone |
| A4 | Transactional outbox omitted | Activity records come from triggers (`record_activity`) on key tables. No separate outbox table. Service-role sees all activity; clients see own only. | **Accepted** | none (implemented in migration 2, SEC-ACT tests) |
| A5 | Recurring transactions are templates only until Gate 2 | `recurring_transactions` table exists (migration 3) but nothing posts them. Scheduler deferred to Gate 2 (Edge Function). | **Deferred** | Gate 2: Edge Function scheduler |
| A6 | Google Drive present in schema only; integration deferred | `storage_providers` enum includes `google_drive`; `documents.provider` column allows it. No integration code. | **Deferred** | Gate 2+: authorisation + integration |
| A7 | Vault documents are archive-only; file deletion server-only | `documents` table has no client `DELETE`. Deletion requires `service_role` via Storage API (or future Edge Function). Archive-only by design. | **Accepted** | none (enforced by RLS + SEC-STO tests); Gate 2 Edge Function for UI delete |
| A8 | Base currency cannot be changed after onboarding | `businesses.base_currency` set once at onboarding. No UI to change; column grant excludes UPDATE. Settings module shows it as readonly. | **Accepted** | none (implemented: column grant + settings UI readonly) |
| A9 | CSV duplicate decisions take two steps (stage → decide → commit) | Import flow: stage batch+rows → decide per row (skip/import/replace) → commit batch atomically via RPC. Not a single-step decision. | **Accepted** | none (implemented in migration 5 + `imports` repository) |
| A10 | Validation environment owner | Decided 8 Nov 2026: Meridian infrastructure is DPN-owned. LiqrIt org no longer used. | **Closed** | none |
| A11 | `max_workspaces` = 1 by default | `max_workspaces` defaults to 1 in `businesses`. Validation project uses 2 for tenant isolation tests. Production installs get 1. | **Accepted** | none (implemented in migration 1) |
| A12 | Reversals are not dated (L1) | A reversal removes the transaction from cash at every as-of date, including dates before the reversal. Historic cash reports change after a correction. | **Deferred** | Gate 2: add `reversal_effective_date` if historic statements must stay fixed |
| A13 | Vault MIME allow-list: none today | `documents.mime_type` stored but no allow-list enforced. Any file type can be uploaded to `company-vault` bucket. | **Deferred** | Founder decision: allow-list or open? |
| A14 | Leaked-password protection in Supabase Auth | Supabase Auth leaked-password protection is plan-dependent (off on Free). Requires Pro+ plan or custom check. | **Deferred** | Founder decision before production; enable on Pro plan or custom |
| A15 | Recovery targets (RPO/RTO) | What recovery point and recovery time are acceptable? Not yet defined. | **Deferred** | Founder decision: define RPO/RTO targets |
| A16 | Second empty DPN project for recovery drill | Founder must create a second empty DPN project (like the validation project) as the recovery drill target. | **Deferred** | Founder action: create DPN project |
| A17 | Vault caching (L16) — no residual access to deleted/revoked documents | CDN serves deleted files to tokens that already downloaded them. Direction (8 Nov 2026): no residual access; change in Gate 2 (not Gate 1). Options: download via Meridian function, or plan with CDN invalidation. | **Approved: schema revision** | Gate 2 design: download proxy function or paid plan with purge API |

A17 constraint (founder, M4.2 authorisation): the approved Vault caching design (no residual access to deleted or revoked
documents) does not authorise any production CDN, storage or infrastructure change. Its implementation stays gated and is
part of the future Vault engineering assurance work. The development Vault stores no files, so nothing is cached.

## 8 Nov 2026: M4.2 Company Vault dispositions (app/README.md, "M4.2: Company Vault, contract notes")

Accepted with M4.2 at `5c35ea5`. No migration or backend change follows from any of them.

| ID | Topic | Decision | Status | Follow-up |
|---|---|---|---|---|
| V-1 | Metadata-only behaviour | Keep the explicit "metadata only / no file stored" warnings. Never imply a file is stored or downloadable when it is not | **Accepted** | Applies until real storage integration is authorised |
| V-2 | No "not yet uploaded" state in `documents` | Deferred until real storage integration | **Deferred** | Assess with the storage integration (upload must precede the row) |
| V-3 | Linear version history | Accepted as a V1 application rule (new versions only on the latest version) | **Accepted** | Database enforcement to be assessed in future schema hardening |
| V-4 | `is_archived` is per version row | Whole-chain archive and restore accepted for V1 | **Accepted** | none |
| V-6 | Vault caching (= A17) | Design approval retained; no infrastructure implementation is authorised | **Accepted** (design only) | Future Vault engineering assurance work |
