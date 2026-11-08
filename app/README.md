# Meridian app (M1 to M4.2)

The Meridian application: vanilla HTML, CSS and JavaScript with native ES modules. No framework, no build step,
no dependencies, no external requests.

**Built:**
- M1: Command Centre, Projects, Tasks, the application shell and the Ctrl/Cmd+K launcher.
- M2: Calendar, Milestones, Contacts and Decisions.
- M3: Finances (accounts and cash, append-only transactions, funding, capital, CSV import).
- M4.1: Settings. M4.2: Company Vault (metadata only, no file storage).

**Not built yet:** Reports (M4.3). It appears in the navigation as an honest "not built yet" page, never as a mock screen.

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

## Run it

```bash
node tools/serve.mjs          # http://127.0.0.1:5180/   (serves app/ only, on 127.0.0.1 only)
```

With XAMPP's Apache running it is also at `http://localhost/meridian/app/`. `app/.htaccess` allows this folder;
the repository root stays denied.

```bash
node --test "tests/app/*.test.mjs"   # 61 tests: core, data adapter, projections, M2, finance (incl. SQL parity), vault
```

## Data: development fixtures, no backend

- **No backend is connected.** There is no Supabase client and no network call. The shell always shows a
  "Development data · fictional · no backend" badge.
- Everything shown is **fictional** (`data/fixtures/dev-fixtures.js`): an invented studio, invented people and
  `.example` addresses. No real or financial data.
- Changes persist **in this browser only** (`localStorage` key `meridian.dev.v1`). To restore the fixtures, open the
  launcher and run **Reset development data**.

## Structure

```
app/
  index.html, app.js         bootstrap: workspace -> theme and accent -> shell -> router (hash routes)
  core/                      router, events, format (business/profile-driven), color, search, dom (textContent only)
  data/
    schema.js                mirror of the Gate 1 tables: columns, enums, CHECKs, grants, FKs, triggers
    repositories.js          the ONLY data API screens use; named after backend tables, views and RPCs
    adapters/fixture.js      development adapter (in-memory + localStorage)
    fixtures/dev-fixtures.js fictional seed data, dates relative to business-local today
    index.js                 selects the adapter (M1: development only)
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

Connecting the backend later means adding `adapters/supabase.js` with the same interface and selecting it in
`data/index.js`, after the backend gate is authorised. Screens do not change.

## Interpretations to review (FO-VIS-CC-001 was not available in the repository)

1. **Command Centre composition and order** come from `profiles.widget_layout` (schema default: kpi, attention,
   projects, finance, funding, schedule, activity), and its `hidden` list is honoured.
2. **KPI strip:**
   - shown: open tasks, due today, overdue, active projects, milestones in the next 14 days (with the late count);
   - available cash is shown as "Not connected".
3. **Needs attention:** overdue open tasks (Critical first), then late milestones (Delayed, or open and past due),
   then tasks due today, then Critical tasks with no due date. Up to 8, with a count of the rest.
4. **Finance and funding panels** in the Command Centre still show "not connected yet": wiring them to the Finances repositories (M3.5) is not done. No estimated figures are shown.
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

## Known limits

- Repeating tasks store their rule. Creating the next occurrence is server work for later (Edge Function).
- The activity actor is always the signed-in founder (single-user V1).
- The launcher searches modules, actions, projects and tasks, not milestones, contacts or decisions (those modules have their own search).
- Contact interactions (`contact_interactions`) exist in the schema but are not surfaced: Contacts is deliberately a directory, not a CRM.
- Calendar events are listed per day in the week view, without an hourly grid.
- Dates are formatted with `profiles.date_format`. Native date pickers follow the browser's locale.
