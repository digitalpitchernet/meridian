# Meridian app (M1 to M4.3 + Task Execution live slice)

The Meridian application: vanilla HTML, CSS and JavaScript with native ES modules. No framework, no build step,
no third-party dependencies.

**Built:**
- M1: Command Centre, Projects, Tasks, the application shell and the Ctrl/Cmd+K launcher.
- M2: Calendar, Milestones, Contacts and Decisions.
- M3: Finances (accounts and cash, append-only transactions, funding, capital, CSV import).
- M4.1: Settings. M4.2: Company Vault (metadata only, no file storage). M4.3: Reports, and the Command Centre finance panels.
- Task Execution live slice (`feat/task-execution-slice`): Supabase/PostgreSQL adapter with GoTrue auth, workspace onboarding, participant assignment, status transitions, and task accountability history.

Live backend mode requires an explicit `app/app-config.json` (or local PostgreSQL via `node tools/serve.mjs`). Missing or unreachable backend configuration fails closed; fictional fixture mode is opt-in only (`--fixtures` or `?mode=dev`).

## M2: schema gaps and app-level rules (flagged for review)

Each item below is either not representable in the Gate 1 schema (so it was **not** built and no column was invented),
or is enforced by the app but not by the database.

| # | Item | What the app does | What it would need |
|---|---|---|---|
| G1 | Milestone **start date** | Not shown: `milestones` has only `due_date` | A migration adding `start_date` |
| G2 | **Archive** a contact | Not offered: `contacts` has no archive or active flag. Delete is offered, with its consequences listed | A migration adding an archive flag |
| G3 | **Preserve decided decisions** | Approved, Rejected and Superseded decisions are read-only in the UI. Course changes are recorded by superseding. Only proposals can be deleted | A database rule (trigger or column grants) so no client can overwrite a decided record |
| G4 | **Supersede atomically** | `decisions.supersede()` performs four writes: new decision, its options, approve it, mark the old one. A failure partway can leave a half-recorded replacement | An RPC that does it in one transaction; only the repository method changes |
| G5 | **Decision participants** | One project and one contact, as the schema allows | A link table, if more are wanted |
| G6 | **Rationale required** to record an outcome | Enforced in the app (`decisions.decide`) | Optional: a CHECK or RPC rule |
| G7 | `milestones.achieved_at` | Set when a milestone becomes Achieved, cleared when it stops being Achieved (same pattern as `projects.completed_at`) | A trigger, if the server should own it |
| G8 | **Decision reviews** in the Command Centre | Decisions whose `review_date` has arrived appear in "Needs attention"; upcoming reviews appear in the schedule | — |

**Founder decisions, 8 Nov 2026** (`docs/DECISION-REGISTER.md`):
- **Deferred:** G1.
- **Accepted:** G5.
- **Closed:** G8.
- **Approved for a future schema revision:** G2 (`archived_at` on contacts), G3 (database-level immutability of decided decisions), G4 (transactional supersede RPC), G6 (rationale enforced in the database) and G7 (database-owned `achieved_at`). The consolidated proposal is in progress.

Until that revision ships, the app keeps the behaviour in the table above.

## M3: Finances, contract notes (flagged for review)

Finances runs on the development adapter, which emulates migrations 3–5: every CHECK, every trigger guard, the
finance views and the RPCs (`get_available_cash`, `get_account_balances`, `reverse_transaction`,
`reverse_payment_allocation`, `revoke_funding_commitment`, `commit_import_batch`). Every write is atomic.
`tests/app/finance-parity.test.mjs` replays `tests/sql/20_financial.sql` and `30_csv_import.sql` with the same
hand-computed figures and SQLSTATEs. Screens never compute a balance, cash figure or status: they read views and RPCs.

Workflows the approved contracts cannot fully support. No workaround was built for any of these:

| # | Item | What the app does |
|---|---|---|
| F-1 | **Manual correction link** | `replaces_transaction_id` is not client-insertable (only CSV import sets it). A hand correction is a reversal with a reason plus a new, unlinked transaction |
| F-2 | **In-file CSV duplicates** | The server sets `duplicate_in_batch` only inside `commit_import_batch`, and a refused commit rolls it back. The screen shows "same as row N" from the server-computed `fingerprint` instead |
| F-3 | **Runway** | `countdown_preferences.show_runway_days` exists, but no runway definition or RPC is approved. Not shown |
| F-4 | **CSV formats** | Only ISO dates, positive amounts and an explicit income/expense column are accepted. Other bank formats are flagged invalid, never converted on the client |
| F-5 | **Recurring templates** | Shown as reminders. Posting an occurrence is Gate 2 |

## M4.2: Company Vault, contract notes (flagged for review)

The Vault follows migration 6: documents are archive-only (no delete for anyone), the client may change only
`title`, `category` and `is_archived`, versions chain through `previous_version_id`, and each `document_links` row
points at exactly one supported record (project, milestone, task, decision, contact, transaction, funding commitment,
funding requirement), once.

| # | Item | What the app does |
|---|---|---|
| V-1 | **No file bytes** | No Storage, Google Drive or external provider is connected. Every document is labelled *No file stored* and nothing offers a download. "Record document" reads a local file in the browser only to fill in its name, type, size and SHA-256; the bytes are not uploaded or kept |
| V-2 | **No "not yet uploaded" state** | The schema has none, so development records carry `storage_provider = supabase_storage` and a key under the business folder for an object that does not exist. In production the upload must precede the row |
| V-3 | **Linear history is an app rule** | The database allows two versions to point at the same previous version. The app adds versions only to the latest one |
| V-4 | **Archive is per row** | `is_archived` is stored per version. The app archives and restores the whole chain together |
| V-5 | **Integrations** | `integration_connections` is mirrored read-only (clients cannot write it). No Google Drive connection is built |
| V-6 | **Vault caching (A17)** | The approved no-residual-access design stays gated: no CDN, storage or infrastructure change is made, and it belongs to the future Vault engineering assurance work |

Fictional Vault fixtures: 14 document records (two version chains, two archived), 20 links. Their checksums are the
SHA-256 of a `fictional:` label, not of any real file.

## M4.3: Reports, calculation notes (flagged for review)

Reports and the Command Centre take every finance figure from one loader, `financeSnapshot()` in
`modules/reporting.js`. It reads the same RPCs and views as the Finances module, so all three screens show identical
figures for the same date (`tests/app/reports.test.mjs` checks this). Each report section states its scope: *for the
period*, *as of* a date, or *current*.

| # | Item | What the app does |
|---|---|---|
| R-1 | **Income and expenses for a period** | No approved view or RPC sums the ledger by period. `ledgerTotals()` adds up non-reversed rows by classification (operational income and expenses, capital, loans, grants, settlements, personal payments, transfers), never nets funding into income, and is tested by reconciling to `get_available_cash` |
| R-2 | **Burn and runway** | Not calculated: no approved definition (see F-3). The report and the Command Centre say so |
| R-3 | **Funding, capital and settlements are current** | Their views have no as-of date, so these sections show today's position, labelled as current, whatever the reporting period |
| R-4 | **Operational history** | Only `created_at`, `completed_at` and `achieved_at` are dated. "Open at a date" uses them; other statuses (Delayed, Cancelled, project status) are current state |
| R-5 | **Reversals** | A reversal removes a transaction from every period and as-of date, including earlier ones (register A12) |

Periods are inclusive business-local dates: this month, last month, this quarter, last 30 days, financial year to
date and last financial year (from `businesses.financial_year_start_month`), or a custom range that ends no later than today.
CSV exports use RFC 4180 quoting and guard against formula injection. Money is written as plain 2-decimal text with a
currency column. Every row carries a data-source column, and development files are named `meridian-DEVELOPMENT-fictional-…`.

## Run it

```bash
node tools/serve.mjs              # http://127.0.0.1:5180/   (local PostgreSQL 17 + RLS; exits cleanly if PostgreSQL server is unavailable)
node tools/serve.mjs --supabase   # http://127.0.0.1:5180/   (connects to SUPABASE_URL + SUPABASE_ANON_KEY from .env; never exposes service_role)
node tools/serve.mjs --fixtures   # http://127.0.0.1:5180/   (explicit fictional browser-only fixtures)
```

For a live Supabase project, provide `app/app-config.json` with `{ "supabaseUrl": "...", "supabaseAnonKey": "..." }`. Missing or unreachable `app/app-config.json` fails closed and never silently falls back to fictional fixtures (use `?mode=dev` or `--fixtures` explicitly).

With XAMPP's Apache running it is also at `http://localhost/meridian/app/`. `app/.htaccess` allows this folder;
the repository root stays denied.

```bash
node --test "tests/app/*.test.mjs"   # app unit, parity, and integration tests
```

## Data: live backend vs. explicit fixture mode

- **Live backend (`adapters/supabase.js`):** Selected when `app/app-config.json` provides `{ "supabaseUrl": "...", "supabaseAnonKey": "..." }` (or via `node tools/serve.mjs` when local PostgreSQL 17 is installed). Uses GoTrue JWT auth, automatic token refresh, and PostgREST with server-enforced RLS, column grants, and triggers.
- **Explicit fixture mode (`adapters/fixture.js`):** Selected **only** via `node tools/serve.mjs --fixtures`, `?mode=dev` / `?mode=fixtures`, or `{ "mode": "fixtures" }` in `app/app-config.json`. Everything shown is **fictional** (`data/fixtures/dev-fixtures.js`), persisted in `localStorage` (`meridian.dev.v1`), and never silently replaces a missing or unreachable live backend.

## Live validation (Task Execution slice)

1. **Preflight migration chain (read-only):**
   `node tools/check-migration-prereqs.mjs` (set `TEST_SUPABASE_URL` and `TEST_SUPABASE_ANON_KEY` to probe a disposable validation project; no service-role key required).
2. **Apply migrations 1–10** to the designated disposable Supabase validation project (with email confirmation enabled and `max_workspaces = 1` intact) and ensure a confirmed test user exists (`TEST_USER_A_EMAIL` / `TEST_USER_A_PASSWORD`).
3. **Run the remote integration test:**
   Set `MERIDIAN_DISPOSABLE_VALIDATION=1`, `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_USER_A_EMAIL`, `TEST_USER_A_PASSWORD` (and optionally `TEST_USER_B_*` if testing two workspaces), then run:
   `node --test tests/app/task-execution-pg.test.mjs`
   **Expected:** Task creation, inactive-member rejection (`23514`), invalid/foreign-member rejection (`23503`), simultaneous status + assignee activity logging (`tasks.status_changed` + `tasks.assigned`), server-side `completed_at` on `Done`, and reload persistence all pass.
4. **Manual browser check:** Serve with `app/app-config.json` pointing to the validation project, sign in, create a task, assign a workspace participant, move `Inbox` -> `In Progress` -> `Done`, verify the Activity section in the task panel, and reload the page to confirm persistence.

## Structure

```
app/
  index.html, app.js         bootstrap: workspace -> theme and accent -> shell -> router (hash routes)
  core/                      router, events, format (business/profile-driven), color, search, dom (textContent only)
  data/
    schema.js                mirror of the Gate 1 tables: columns, enums, CHECKs, grants, FKs, triggers
    repositories.js          the ONLY data API screens use; named after backend tables, views and RPCs
    adapters/fixture.js      development adapter (in-memory + localStorage, opt-in only)
    adapters/supabase.js     live Supabase / PostgREST + GoTrue adapter
    fixtures/dev-fixtures.js fictional seed data, dates relative to business-local today
    index.js                 fail-closed data source selector (supabase vs explicit fixture mode)
  modules/                   registry, command, projects, tasks, projections (pure), placeholder
  shell/                     sidebar, header, right panel, mobile drawer
  ui/                        icons, components, forms, overlay (menus, dialogs), status vocabulary, launcher, errors
  styles/                    tokens (themes, accent), base, shell, components, modules
```

### The backend boundary

Screens call `ctx.data.<repository>` only. Repositories call an adapter with `select / get / insert / update /
remove / rpc`. The development adapter enforces what the database enforces, so screens are built against the real
contract:
- column grants (for example, `tasks.completed_at` and `businesses.base_currency` are not client-writable);
- row-level business scoping;
- NOT NULL, CHECK (enums, lengths, dates), foreign keys with cascade or set null;
- the task-completion and `updated_at` triggers;
- append-only `activity_records`, written like `record_activity()`.

Errors carry the Postgres SQLSTATE (`23514`, `23502`, `23503`, `42501`), so `ui/errors.js` reads the same codes
from the future Supabase adapter. **`data/schema.js` mirrors the migrations; the migrations are the authority.**

The `supabase.js` adapter implements this exact interface (`select / get / insert / update / remove / rpc / subscribe`) so screens work identically across both backends.

## Interpretations to review (FO-VIS-CC-001 was not available in the repository)

1. **Command Centre composition and order** come from `profiles.widget_layout` (schema default: kpi, attention,
   projects, finance, funding, schedule, activity), and its `hidden` list is honoured.
2. **KPI strip:**
   - shown: open tasks, due today, overdue, active projects, milestones in the next 14 days (with the late count);
   - available cash today, from `financeSnapshot()` (labelled fictional in development).
3. **Needs attention:** overdue open tasks (Critical first), then late milestones (Delayed, or open and past due),
   then tasks due today, then Critical tasks with no due date. Up to 8, with a count of the rest.
4. **Finance and funding panels** show available cash today, account balances, what is owed to participants, and committed, received and outstanding funding, all from `financeSnapshot()`. They never show burn or runway (R-2).
5. **Schedule:**
   - covers the next 14 days in the business time zone;
   - lists calendar events, open task due dates and open milestone due dates;
   - shows the first 7 days that have items.
6. **Countdowns** follow `profiles.countdown_preferences.show_milestone_countdowns`.
7. **`projects.completed_at`** is client-writable but has no trigger. The app sets it when a project moves to
   Completed and clears it when it leaves, mirroring the server-side task rule.
8. **The "Current" projects view** is Planning + Active + On Hold, ordered Active, Planning, On Hold.
9. **State previews:** in development only, `#/command?state=loading|empty|error|stale` renders every Command Centre
   panel in that state, for design review.

## Settings: participant management

`participants` can be deleted by the client, but `transactions`, `funding_commitments` and
`participant_capital_allocations` reference it `ON DELETE RESTRICT`. Settings therefore checks first:
- **No financial records:** *Remove* is offered, with a confirmation that names the participant and states what is deleted (including any agreed equity).
- **Any transaction (reversed ones too), commitment or capital allocation:** the dialog lists them and offers *Deactivate* (`is_active`, an existing column) instead. Every record stays intact, and they can be reactivated.
- **Inactive participants** are not offered for new commitments or capital allocations. They remain available for new transactions while money is still owed to them, so loans and reimbursements can be repaid. Their figures stay in Capital and Reports, marked inactive.
- **App rule:** the participant linked to the signed-in founder's profile (`profile_id`) is the account owner's record and is neither removable nor deactivatable from Settings.

No schema change was needed.

## Known limits

- Repeating tasks store their rule. Creating the next occurrence is server work for later (Edge Function).
- Task assignment (`assigned_to_participant_id`) targets a workspace `participants` record (business record), not an authenticated team-member login. Multi-user team execution and per-assignee permissions remain out of scope for V1.
- The activity actor is always the signed-in founder (single-user V1).
- The launcher searches modules, actions, projects and tasks, not milestones, contacts or decisions (those modules have their own search).
- Contact interactions (`contact_interactions`) exist in the schema but are not surfaced: Contacts is deliberately a directory, not a CRM.
- Calendar events are listed per day in the week view, without an hourly grid.
- Dates are formatted with `profiles.date_format`. Native date pickers follow the browser's locale.
