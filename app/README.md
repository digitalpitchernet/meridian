# Meridian app (M1 + M2)

The Meridian application: vanilla HTML, CSS and JavaScript with native ES modules. No framework, no build step,
no dependencies, no external requests.

**Built:**
- M1: Command Centre, Projects, Tasks, the application shell and the Ctrl/Cmd+K launcher.
- M2: Calendar, Milestones, Contacts and Decisions.

**Not built yet:** Finances (M3); Company Vault, Reports and Settings (M4). They appear in the navigation as honest
"not built yet" pages, never as mock screens.

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

## Run it

```bash
node tools/serve.mjs          # http://127.0.0.1:5180/   (serves app/ only, on 127.0.0.1 only)
```

With XAMPP's Apache running it is also at `http://localhost/meridian/app/`. `app/.htaccess` allows this folder;
the repository root stays denied.

```bash
node --test "tests/app/*.test.mjs"   # 38 tests: core, data adapter rules, projections, calendar, contacts, decisions
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
4. **Finance and funding panels** show an explicit "not connected yet" state until M3. No estimated figures.
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
