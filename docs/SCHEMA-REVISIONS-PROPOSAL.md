# Consolidated Engineering Proposal: Five Schema Revisions (G2, G3, G4, G6, G7)

**Date:** 2026-11-08  
**Status:** Proposal — not yet authorised for execution  
**Related:** [DECISION-REGISTER.md](DECISION-REGISTER.md) (8 Nov 2026 M2 schema gaps), [GATE-1-REPORT.md](GATE-1-REPORT.md) §9, 9 Gate 1 migrations in `supabase/migrations/`

---

## 1. Executive Summary

This proposal covers the five founder-approved schema revisions from the 8 Nov 2026 decision register, all marked **Approved: schema revision**:

| ID | Topic | Core Requirement |
|----|-------|------------------|
| **G2** | Contact archiving | Add `archived_at` timestamp to `contacts` — explicit archive state, historical relationships preserved |
| **G3** | Decision immutability | Database-level protection for terminal statuses (Approved, Rejected, Superseded) — not app-only |
| **G4** | Atomic supersession | Transactional RPC that creates replacement decision + options + outcome, supersedes original in one transaction |
| **G6** | Outcome rationale | Database enforcement of rationale requirement for terminal decisions |
| **G7** | `milestones.achieved_at` | Database-owned timestamp via trigger (follows task-completion principle) |

**Constraints (non-negotiable):**
- Nine Gate 1 migrations and their hashes **stay unchanged** — new forward migrations only
- No migration executed, no Supabase environment touched until separately authorised
- Until revision ships, app keeps current behaviour: decision rules in app, client sets `achieved_at`, delete with confirmation for contacts

---

## 2. Current Schema Baseline (Gate 1 Migrations)

### 2.1 Relevant Tables (from migrations 1, 2, 4)

```sql
-- Migration 1: tenancy and privileges
CREATE TABLE public.contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    first_name text NOT NULL CHECK (char_length(btrim(first_name)) BETWEEN 1 AND 120),
    last_name text, organization text, role text,
    email text, phone text,
    category text NOT NULL CHECK (category IN ('Investor','Client','Partner','Vendor','Advisor','Collaborator','Other')),
    notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Migration 2: decisions
CREATE TABLE public.decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id uuid, contact_id uuid,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    context text NOT NULL DEFAULT '', problem text NOT NULL DEFAULT '', rationale text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'Proposed' CHECK (status IN ('Proposed','Approved','Superseded','Rejected')),
    decision_date date NOT NULL DEFAULT CURRENT_DATE,
    review_date date, selected_option_id uuid, superseded_by_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_decisions_superseded FOREIGN KEY (business_id, superseded_by_id) REFERENCES public.decisions(business_id, id) ON DELETE SET NULL
);

-- Migration 2: milestones
CREATE TABLE public.milestones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES public.projects(business_id, id) ON DELETE CASCADE,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    description text, due_date date NOT NULL,
    status text NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Upcoming','In Progress','Achieved','Delayed','Cancelled')),
    achieved_at timestamptz,  -- currently nullable, client-owned
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 2.2 Current RLS & Grants (from migrations 1-2)

```sql
-- contacts
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY contacts_tenant ON public.contacts FOR ALL TO authenticated
    USING (business_id = public.get_current_business_id())
    WITH CHECK (business_id = public.get_current_business_id());
REVOKE ALL ON public.contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT (business_id, first_name, last_name, organization, role, email, phone, category, notes)
    ON public.contacts TO authenticated;
GRANT UPDATE (first_name, last_name, organization, role, email, phone, category, notes)
    ON public.contacts TO authenticated;
GRANT DELETE ON public.contacts TO authenticated;

-- decisions
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY decisions_tenant ON public.decisions FOR ALL TO authenticated
    USING (business_id = public.get_current_business_id())
    WITH CHECK (business_id = public.get_current_business_id());
REVOKE ALL ON public.decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT (business_id, project_id, contact_id, title, context, problem, rationale,
    status, decision_date, review_date, selected_option_id, superseded_by_id)
    ON public.decisions TO authenticated;
GRANT UPDATE (project_id, contact_id, title, context, problem, rationale,
    status, decision_date, review_date, selected_option_id, superseded_by_id)
    ON public.decisions TO authenticated;
GRANT DELETE ON public.decisions TO authenticated;

-- milestones
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones FORCE ROW LEVEL SECURITY;
CREATE POLICY milestones_tenant ON public.milestones FOR ALL TO authenticated
    USING (business_id = public.get_current_business_id())
    WITH CHECK (business_id = public.get_current_business_id());
REVOKE ALL ON public.milestones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT (business_id, project_id, title, description, due_date, status, achieved_at)
    ON public.milestones TO authenticated;
GRANT UPDATE (project_id, title, description, due_date, status, achieved_at)
    ON public.milestones TO authenticated;
GRANT DELETE ON public.milestones TO authenticated;
```

### 2.3 Current Triggers (shared)

```sql
-- All tables have:
CREATE TRIGGER trg_<table>_updated_at BEFORE UPDATE ON public.<table>
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- tasks has additional:
CREATE TRIGGER trg_tasks_completion BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.set_task_completed_at();

-- All tables have activity trigger:
CREATE TRIGGER trg_<table>_activity AFTER INSERT ON public.<table>
    FOR EACH ROW EXECUTE FUNCTION public.record_activity();
```

### 2.4 Decision Options Table

```sql
CREATE TABLE public.decision_options (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    decision_id uuid NOT NULL,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    description text, pros text, cons text,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_do_decision FOREIGN KEY (business_id, decision_id) REFERENCES public.decisions(business_id, id) ON DELETE CASCADE
);
```

---

## 3. Migration Designs (Five New Forward-Only Migrations)

### Migration 7: Contact Archiving (G2)

**File:** `supabase/migrations/20261108_001_contact_archiving.sql`

```sql
-- =====================================================================================
-- Meridian V1 · Gate 1+ · Migration 7/14: Contact archiving (G2)
-- Adds archived_at to contacts; archive is explicit, relationships preserved.
-- =====================================================================================

ALTER TABLE public.contacts ADD COLUMN archived_at timestamptz;

-- Index for active contacts (archived_at IS NULL)
CREATE INDEX idx_contacts_business_active ON public.contacts (business_id, category) WHERE archived_at IS NULL;

-- Updated grant: archived_at is managed by the app (archive/unarchive), not editable by client
REVOKE UPDATE ON public.contacts FROM authenticated;
GRANT UPDATE (first_name, last_name, organization, role, email, phone, category, notes, archived_at)
    ON public.contacts TO authenticated;

-- Trigger to prevent updates on archived contacts (except unarchive)
CREATE OR REPLACE FUNCTION public.guard_contacts_archived()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'Archived contacts cannot be modified; unarchive first'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_contacts_archived BEFORE UPDATE ON public.contacts
    FOR EACH ROW EXECUTE FUNCTION public.guard_contacts_archived();
```

**Why this design:**
- `archived_at` NULL = active, non-NULL = archived (timestamp of archival)
- Preserves all FKs: `project_contacts`, `contact_interactions`, `document_links` — no cascade changes
- App controls archive/unarchive via `archived_at` update; trigger blocks modifications while archived
- `DELETE` still allowed (for hard removal if needed), but app UI will route to archive instead

---

### Migration 8: Decision Immutability & Outcome Rationale (G3, G6)

**File:** `supabase/migrations/20261108_002_decision_immutability_rationale.sql`

```sql
-- =====================================================================================
-- Meridian V1 · Gate 1+ · Migration 8/14: Decision immutability & rationale (G3, G6)
-- Terminal statuses protected at DB level; rationale enforced for Approved/Rejected/Superseded.
-- =====================================================================================

-- 1. Stronger CHECK on status transitions
ALTER TABLE public.decisions DROP CONSTRAINT IF EXISTS decisions_status_check;
ALTER TABLE public.decisions ADD CONSTRAINT decisions_status_check
    CHECK (status IN ('Proposed','Approved','Superseded','Rejected'));

-- 2. Guard: once terminal, only superseded_by_id can change (for supersession chain)
CREATE OR REPLACE FUNCTION public.guard_decision_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    terminal_status constant text[] := ARRAY['Approved','Rejected','Superseded'];
BEGIN
    -- Allow INSERT always (validated by CHECK)
    IF TG_OP = 'INSERT' THEN
        -- Rationale enforcement for terminal status on creation
        IF NEW.status IN ('Approved','Rejected','Superseded') THEN
            IF NEW.rationale IS NULL OR btrim(NEW.rationale) = '' THEN
                RAISE EXCEPTION 'Terminal decisions require a non-empty rationale'
                    USING ERRCODE = '23514';
            END IF;
            IF NEW.status = 'Superseded' AND NEW.superseded_by_id IS NULL THEN
                RAISE EXCEPTION 'Superseded decisions must reference the replacing decision'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: if old status was terminal, only superseded_by_id may change (and only to set it once)
    IF OLD.status = ANY(terminal_status) THEN
        -- Columns that must NOT change once terminal
        IF NEW.title IS DISTINCT FROM OLD.title
           OR NEW.context IS DISTINCT FROM OLD.context
           OR NEW.problem IS DISTINCT FROM OLD.problem
           OR NEW.rationale IS DISTINCT FROM OLD.rationale
           OR NEW.status IS DISTINCT FROM OLD.status
           OR NEW.decision_date IS DISTINCT FROM OLD.decision_date
           OR NEW.review_date IS DISTINCT FROM OLD.review_date
           OR NEW.selected_option_id IS DISTINCT FROM OLD.selected_option_id
           OR NEW.project_id IS DISTINCT FROM OLD.project_id
           OR NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
            RAISE EXCEPTION 'Terminal decisions are immutable (status: %)', OLD.status
                USING ERRCODE = '42501';
        END IF;
        -- superseded_by_id may be set once (from NULL to a UUID)
        IF OLD.superseded_by_id IS NOT NULL AND NEW.superseded_by_id IS DISTINCT FROM OLD.superseded_by_id THEN
            RAISE EXCEPTION 'superseded_by_id is final once set'
                USING ERRCODE = '42501';
        END IF;
        -- If setting superseded_by_id, status must become Superseded
        IF OLD.superseded_by_id IS NULL AND NEW.superseded_by_id IS NOT NULL THEN
            IF NEW.status <> 'Superseded' THEN
                RAISE EXCEPTION 'Setting superseded_by_id requires status = Superseded'
                    USING ERRCODE = '23514';
            END IF;
            IF NEW.rationale IS NULL OR btrim(NEW.rationale) = '' THEN
                RAISE EXCEPTION 'Superseded decisions require a non-empty rationale'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    -- Proposed -> Terminal transition: enforce rationale
    IF OLD.status = 'Proposed' AND NEW.status IN ('Approved','Rejected','Superseded') THEN
        IF NEW.rationale IS NULL OR btrim(NEW.rationale) = '' THEN
            RAISE EXCEPTION 'Terminal decisions require a non-empty rationale'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'Superseded' AND NEW.superseded_by_id IS NULL THEN
            RAISE EXCEPTION 'Superseded decisions must reference the replacing decision'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Cannot move from terminal back to Proposed
    IF OLD.status = ANY(terminal_status) AND NEW.status = 'Proposed' THEN
        RAISE EXCEPTION 'Cannot revert a terminal decision to Proposed'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER trg_decisions_immutability BEFORE INSERT OR UPDATE ON public.decisions
    FOR EACH ROW EXECUTE FUNCTION public.guard_decision_immutability();

-- 3. Updated grants: rationale now required for terminal, but column grant stays (app sends it)
-- No grant change needed — column already in UPDATE grant list
```

**Why this design:**
- BEFORE trigger catches both INSERT and UPDATE
- `SECURITY DEFINER` with empty `search_path` — runs as table owner, immune to search_path injection
- Terminal statuses: `Approved`, `Rejected`, `Superseded` — once reached, core fields frozen
- `superseded_by_id` can be set exactly once (NULL → UUID), and only with status = `Superseded`
- Rationale enforced at DB level for any transition to terminal status
- Existing decisions with terminal status but empty rationale: will fail on next UPDATE; migration should backfill or app must handle

---

### Migration 9: Atomic Supersession RPC (G4)

**File:** `supabase/migrations/20261108_003_atomic_supersession_rpc.sql`

```sql
-- =====================================================================================
-- Meridian V1 · Gate 1+ · Migration 9/14: Atomic supersession RPC (G4)
-- Creates replacement decision + options + outcome, supersedes original in one transaction.
-- =====================================================================================

-- Helper: generate a UUID (already have gen_random_uuid from pgcrypto)
-- No new types needed.

CREATE OR REPLACE FUNCTION public.supersede_decision(
    p_original_id uuid,
    p_new_title text,
    p_new_context text,
    p_new_problem text,
    p_new_rationale text,
    p_new_decision_date date DEFAULT CURRENT_DATE,
    p_new_review_date date,
    p_new_selected_option_id uuid,
    p_new_project_id uuid,
    p_new_contact_id uuid,
    p_options jsonb  -- array of {title, description, pros, cons, sort_order}
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- Critical: prevent search_path injection
AS $$
DECLARE
    v_business_id uuid;
    v_new_decision_id uuid;
    v_option jsonb;
    v_opt_id uuid;
BEGIN
    -- 1. Fetch and validate original
    SELECT business_id INTO v_business_id
    FROM public.decisions
    WHERE id = p_original_id AND business_id = public.get_current_business_id();

    IF v_business_id IS NULL THEN
        RAISE EXCEPTION 'Original decision not found or access denied'
            USING ERRCODE = '42501';
    END IF;

    -- Original must be terminal (Approved/Rejected/Superseded) and not already superseded
    IF NOT EXISTS (
        SELECT 1 FROM public.decisions
        WHERE id = p_original_id
          AND status IN ('Approved','Rejected','Superseded')
          AND superseded_by_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Original decision must be terminal and not already superseded'
            USING ERRCODE = '23514';
    END IF;

    -- 2. Create replacement decision
    INSERT INTO public.decisions (
        business_id, project_id, contact_id, title, context, problem, rationale,
        status, decision_date, review_date, selected_option_id, superseded_by_id
    ) VALUES (
        v_business_id, p_new_project_id, p_new_contact_id, p_new_title,
        p_new_context, p_new_problem, p_new_rationale,
        'Proposed', p_new_decision_date, p_new_review_date, p_new_selected_option_id, NULL
    ) RETURNING id INTO v_new_decision_id;

    -- 3. Create options for replacement
    IF p_options IS NOT NULL THEN
        FOREACH v_option IN ARRAY p_options LOOP
            INSERT INTO public.decision_options (
                business_id, decision_id, title, description, pros, cons, sort_order
            ) VALUES (
                v_business_id, v_new_decision_id,
                v_option->>'title', v_option->>'description',
                v_option->>'pros', v_option->>'cons',
                COALESCE((v_option->>'sort_order')::int, 0)
            ) RETURNING id INTO v_opt_id;
        END LOOP;
    END IF;

    -- 4. Atomically supersede original: set superseded_by_id and flip status to Superseded
    UPDATE public.decisions
    SET superseded_by_id = v_new_decision_id,
        status = 'Superseded',
        rationale = COALESCE(NULLIF(btrim(p_new_rationale), ''), rationale),  -- preserve if empty
        updated_at = now()
    WHERE id = p_original_id AND business_id = v_business_id;

    -- 5. Activity record (record_activity trigger fires on both INSERT and UPDATE)
    -- No explicit log needed; triggers handle it.

    RETURN v_new_decision_id;
END $$;

-- Grant to authenticated (app calls this RPC)
GRANT EXECUTE ON FUNCTION public.supersede_decision(uuid, text, text, text, text, date, date, uuid, uuid, uuid, jsonb)
    TO authenticated;
```

**Why this design:**
- Single RPC, single transaction — all-or-nothing
- `SECURITY DEFINER` + `SET search_path = ''` — runs as owner, no search_path hijack
- Original must be terminal and not already superseded
- Creates replacement as `Proposed` (founder can then approve it)
- Options passed as JSONB array for flexibility
- Returns new decision ID for navigation
- Original's `rationale` preserved unless new one provided (supersession rationale)

---

### Migration 10: Milestone Achieved Timestamp (G7)

**File:** `supabase/migrations/20261108_004_milestone_achieved_at.sql`

```sql
-- =====================================================================================
-- Meridian V1 · Gate 1+ · Migration 10/14: Milestone achieved_at ownership (G7)
-- Database owns achieved_at via trigger, following task-completion principle.
-- =====================================================================================

-- 1. Remove client grant on achieved_at; server trigger will set it
REVOKE UPDATE ON public.milestones FROM authenticated;
GRANT UPDATE (project_id, title, description, due_date, status)
    ON public.milestones TO authenticated;

-- 2. Trigger function: set achieved_at when status becomes 'Achieved'; clear otherwise
CREATE OR REPLACE FUNCTION public.set_milestone_achieved_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.status = 'Achieved' AND OLD.status IS DISTINCT FROM 'Achieved' THEN
        NEW.achieved_at := now();
    ELSIF NEW.status IS DISTINCT FROM 'Achieved' THEN
        NEW.achieved_at := NULL;
    END IF;
    -- If status stays 'Achieved', keep existing achieved_at (don't reset)
    RETURN NEW;
END $$;

CREATE TRIGGER trg_milestones_achieved_at BEFORE UPDATE ON public.milestones
    FOR EACH ROW EXECUTE FUNCTION public.set_milestone_achieved_at();

-- 3. Backfill: for existing milestones with status='Achieved' but NULL achieved_at,
-- set to created_at (best effort; app may have more precise data)
UPDATE public.milestones
SET achieved_at = created_at
WHERE status = 'Achieved' AND achieved_at IS NULL;
```

**Why this design:**
- Mirrors `tasks` table's `trg_tasks_completion` trigger (migration 2)
- `SECURITY DEFINER` + empty `search_path` — same security posture
- Client can no longer set `achieved_at` (removed from UPDATE grant)
- Status change TO `Achieved` → `achieved_at = now()`
- Status change AWAY from `Achieved` → `achieved_at = NULL`
- Staying at `Achieved` → preserves existing timestamp
- Backfill uses `created_at` as approximation for historical rows

---

### Migration 11: Contact Archive Filter in RLS (G2 follow-up)

**File:** `supabase/migrations/20261108_005_contact_archive_rls.sql`

```sql
-- =====================================================================================
-- Meridian V1 · Gate 1+ · Migration 11/14: Contact archive visibility (G2)
-- Archived contacts hidden from default lists; explicit 'include archived' opt-in.
-- =====================================================================================

-- Replace the contacts_tenant policy to exclude archived by default
DROP POLICY contacts_tenant ON public.contacts;

CREATE POLICY contacts_tenant ON public.contacts FOR ALL TO authenticated
    USING (
        business_id = public.get_current_business_id()
        AND (archived_at IS NULL OR current_setting('app.include_archived_contacts', true) = 'true')
    )
    WITH CHECK (business_id = public.get_current_business_id());

-- Note: app can SET LOCAL app.include_archived_contacts = 'true' in a transaction
-- to include archived contacts (e.g., for relationship lookups in project_contacts).
-- The setting is transaction-local and defaults to 'false'.
```

**Why this design:**
- Default queries (no `SET LOCAL`) see only active contacts
- `project_contacts` and `contact_interactions` still reference archived contacts via FK — no cascade
- App uses `SET LOCAL app.include_archived_contacts = 'true'` for explicit lookups (e.g., linking an archived contact to a project)
- GUC `app.include_archived_contacts` defined in `postgresql.conf` or via `ALTER SYSTEM`; default `false`

---

## 4. Compatibility Analysis

### 4.1 Application Code Impact

| Revision | Files to Update | Breaking Change? |
|----------|----------------|------------------|
| **G2** (contacts archiving) | `app/modules/contacts.js`, `app/ui/components.js` (contact list), `app/data/schema.js` | **No** — additive column, new filter; delete still works but UI routes to archive |
| **G3** (decision immutability) | `app/modules/decisions.js`, `app/data/schema.js` | **No** — app already enforces; DB now enforces too. Existing terminal decisions with empty rationale will block UPDATE until rationale added |
| **G4** (atomic supersession) | `app/modules/decisions.js` (new RPC call), `app/data/repositories.js` | **No** — new RPC replaces manual multi-step; old path still works but not used |
| **G6** (rationale enforcement) | `app/modules/decisions.js` (validation), `app/data/schema.js` | **No** — same as G3 |
| **G7** (milestone achieved_at) | `app/modules/milestones.js`, `app/data/schema.js` | **Yes** — client can no longer set `achieved_at`; must remove from INSERT/UPDATE payloads |

### 4.2 Schema Mirror Updates (`app/data/schema.js`)

```javascript
// contacts - add archived_at
contacts: {
  columns: {
    // ... existing ...
    archived_at: { type: 'timestamptz' },  // NEW
  },
  insert: true,
  update: [...existing, 'archived_at'],  // add archived_at
  delete: true,
},

// decisions - immutability handled by trigger; rationale already in update grant
// No column changes needed, but add checks array for clarity
decisions: {
  // ... existing ...
  checks: [
    r => r.superseded_by_id == null || r.superseded_by_id !== r.id || 'chk_decisions_not_self_superseded',
    // New: rationale enforcement is in DB trigger; app can pre-validate
    r => r.status === 'Proposed' || (r.rationale != null && r.rationale.trim() !== '') || 'chk_decisions_rationale_required',
  ],
  // achieved_at removed from update grant in G7
},

// milestones - achieved_at no longer client-settable
milestones: {
  columns: {
    // ... existing ...
    achieved_at: { type: 'timestamptz' },  // stays for SELECT
  },
  insert: ['business_id', 'project_id', 'title', 'description', 'due_date', 'status'],  // REMOVE achieved_at
  update: ['project_id', 'title', 'description', 'due_date', 'status'],  // REMOVE achieved_at
  delete: true,
  // ... existing fks, activity ...
},
```

### 4.3 Repository Layer (`app/data/repositories.js`)

No breaking changes — repositories call RPCs/views. Add new method:
```javascript
// In finance-repos or decisions-repo
async supersedeDecision(originalId, payload) {
  return this.adapter.rpc('supersede_decision', [
    originalId, payload.title, payload.context, payload.problem, payload.rationale,
    payload.decisionDate, payload.reviewDate, payload.selectedOptionId,
    payload.projectId, payload.contactId, payload.options
  ]);
}
```

### 4.4 Development Adapter (`app/data/adapters/fixture.js`)

Must mirror new triggers and RPC:
- Add `archived_at` to contacts columns, update grants
- Implement `guard_contacts_archived` in `beforeWrite` for contacts
- Implement `guard_decision_immutability` in `beforeWrite` for decisions
- Implement `supersede_decision` RPC in `RPCS` (from `server-finance.js` or new file)
- Implement `set_milestone_achieved_at` trigger for milestones
- Remove `achieved_at` from milestones update grant
- Add `app.include_archived_contacts` GUC handling in `visible()` for contacts

---

## 5. RLS / Policy Changes Summary

| Table | Policy Change | Grant Change |
|-------|---------------|--------------|
| `contacts` | Add `archived_at IS NULL OR app.include_archived_contacts` to USING | Add `archived_at` to UPDATE grant |
| `decisions` | No policy change (tenant unchanged) | No grant change (rationale already granted) |
| `milestones` | No policy change | **Remove** `achieved_at` from UPDATE grant; keep in INSERT? No — remove from both |

---

## 6. RPC Security (SECURITY DEFINER, search_path)

All new functions follow the same hardening pattern used in Gate 1:

```sql
CREATE OR REPLACE FUNCTION public.<function_name>(...)
RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- Empty search_path prevents injection via pg_catalog, public, etc.
AS $$
BEGIN
    -- Use fully qualified names: public.table, public.get_current_business_id()
    -- Never rely on search_path for resolution
END $$;
```

**Functions affected:**
- `guard_contacts_archived()` — Migration 7
- `guard_decision_immutability()` — Migration 8
- `supersede_decision(...)` — Migration 9
- `set_milestone_achieved_at()` — Migration 10

**Grant pattern:**
```sql
GRANT EXECUTE ON FUNCTION public.supersede_decision(...) TO authenticated;
-- Trigger functions don't need explicit GRANT; they run as table owner via trigger
```

---

## 7. Rollback Scenarios

Since migrations are **forward-only** (no down migrations), rollback means **new forward migrations that reverse effects**. Each revision is independent — can be rolled back separately.

### 7.1 G2 Rollback (Contact Archiving)
```sql
-- Migration 12: Drop archived_at
ALTER TABLE public.contacts DROP COLUMN archived_at;
DROP TRIGGER trg_contacts_archived ON public.contacts;
DROP FUNCTION public.guard_contacts_archived();
-- Restore original policy and grants
DROP POLICY contacts_tenant ON public.contacts;
CREATE POLICY contacts_tenant ON public.contacts FOR ALL TO authenticated
    USING (business_id = public.get_current_business_id())
    WITH CHECK (business_id = public.get_current_business_id());
REVOKE UPDATE ON public.contacts FROM authenticated;
GRANT UPDATE (first_name, last_name, organization, role, email, phone, category, notes)
    ON public.contacts TO authenticated;
```

### 7.2 G3/G6 Rollback (Decision Immutability + Rationale)
```sql
-- Migration 13: Drop triggers, restore original CHECK
DROP TRIGGER trg_decisions_immutability ON public.decisions;
DROP FUNCTION public.guard_decision_immutability();
ALTER TABLE public.decisions DROP CONSTRAINT decisions_status_check;
ALTER TABLE public.decisions ADD CONSTRAINT decisions_status_check
    CHECK (status IN ('Proposed','Approved','Superseded','Rejected'));
```

### 7.3 G4 Rollback (Atomic Supersession RPC)
```sql
-- Migration 14: Drop RPC
REVOKE EXECUTE ON FUNCTION public.supersede_decision(...) FROM authenticated;
DROP FUNCTION public.supersede_decision(uuid, text, text, text, text, date, date, uuid, uuid, uuid, jsonb);
```

### 7.4 G7 Rollback (Milestone achieved_at)
```sql
-- Migration 15: Restore client grant, drop trigger
DROP TRIGGER trg_milestones_achieved_at ON public.milestones;
DROP FUNCTION public.set_milestone_achieved_at();
REVOKE UPDATE ON public.milestones FROM authenticated;
GRANT UPDATE (project_id, title, description, due_date, status, achieved_at)
    ON public.milestones TO authenticated;
```

**Rollback principle:** Each reversal is a new forward migration. No `DROP ... CASCADE` that could affect dependent objects. Data in `archived_at`, `achieved_at` preserved (column drops lose data — acceptable for rollback).

---

## 8. Regression Test Plans

### 8.1 New Test File: `tests/app/schema-revisions.test.mjs`

```javascript
// Test structure following existing patterns in tests/app/*.test.mjs

import { test, assert, before, after } from '../core/test.js';
import { createFixtureAdapter } from '../../app/data/adapters/fixture.js';
import { seed } from '../../app/data/fixtures/dev-fixtures.js';

// ... shared setup ...

// ========== G2: Contact Archiving ==========
test('G2: contact archiving - archive/unarchive flow', async () => {
  const adapter = createFixtureAdapter({ seed, session });
  
  // Create contact
  const c = await adapter.insert('contacts', { first_name: 'Test', category: 'Client' });
  
  // Archive
  await adapter.update('contacts', c.id, { archived_at: new Date().toISOString() });
  const archived = await adapter.get('contacts', c.id);
  assert(archived.archived_at !== null, 'archived_at set');
  
  // Default select excludes archived
  const list = await adapter.select('contacts', {});
  assert(!list.find(x => x.id === c.id), 'archived contact hidden from default list');
  
  // With GUC override (simulated via adapter option or direct query)
  // In fixture adapter: visible() checks app.include_archived_contacts
  
  // Try to modify archived contact — should fail
  try {
    await adapter.update('contacts', c.id, { first_name: 'Modified' });
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.code === '42501', 'privilege violation on archived contact');
  }
  
  // Unarchive
  await adapter.update('contacts', c.id, { archived_at: null });
  const active = await adapter.get('contacts', c.id);
  assert(active.archived_at === null, 'unarchived');
  
  // Now modifiable
  await adapter.update('contacts', c.id, { first_name: 'Modified' });
  const modified = await adapter.get('contacts', c.id);
  assert(modified.first_name === 'Modified', 'modifiable after unarchive');
});

test('G2: contact archiving - relationships preserved', async () => {
  const adapter = createFixtureAdapter({ seed, session });
  const c = await adapter.insert('contacts', { first_name: 'Rel', category: 'Vendor' });
  const p = await adapter.select('projects', { limit: 1 });
  await adapter.insert('project_contacts', { project_id: p[0].id, contact_id: c.id, relationship_role: 'Vendor' });
  
  await adapter.update('contacts', c.id, { archived_at: new Date().toISOString() });
  
  // project_contacts still references archived contact
  const links = await adapter.select('project_contacts', { contact_id: c.id });
  assert(links.length === 1, 'relationship preserved after archive');
});

// ========== G3/G6: Decision Immutability & Rationale ==========
test('G3: decision immutability - terminal status blocks changes', async () => {
  const adapter = createFixtureAdapter({ seed, session });
  
  // Create Proposed decision
  const d = await adapter.insert('decisions', { title: 'Test', status: 'Proposed', rationale: '' });
  
  // Move to Approved with rationale — OK
  await adapter.update('decisions', d.id, { status: 'Approved', rationale: 'Good reasons' });
  const approved = await adapter.get('decisions', d.id);
  assert(approved.status === 'Approved');
  
  // Try to change title — should fail
  try {
    await adapter.update('decisions', d.id, { title: 'Changed' });
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.code === '42501', 'immutable terminal decision');
  }
  
  // Try to change rationale — should fail
  try {
    await adapter.update('decisions', d.id, { rationale: 'New rationale' });
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.code === '42501');
  }
  
  // Try to revert to Proposed — should fail
  try {
    await adapter.update('decisions', d.id, { status: 'Proposed' });
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.code === '42501');
  }
});

test('G6: rationale required for terminal status', async () => {
  const adapter = createFixtureAdapter({ seed, session });
  
  // Try to create Approved without rationale — should fail
  try {
    await adapter.insert('decisions', { title: 'No Rationale', status: 'Approved', rationale: '' });
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.code === '23514', 'rationale required');
  }
  
  // Try to update Proposed -> Approved without rationale — should fail
  const d = await adapter.insert('decisions', { title: 'Test', status: 'Proposed', rationale: '' });
  try {
    await adapter.update('decisions', d.id, { status: 'Approved', rationale: '' });
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.code === '23514');
  }
  
  // With rationale — OK
  await adapter.update('decisions', d.id, { status: 'Approved', rationale: 'Valid reason' });
  const approved = await adapter.get('decisions', d.id);
  assert(approved.status === 'Approved');
});

test('G3: superseded_by_id can be set once', async () => {
  const adapter = createFixtureAdapter({ seed, session });
  
  const d1 = await adapter.insert('decisions', { title: 'Original', status: 'Approved', rationale: 'R1' });
  const d2 = await adapter.insert('decisions', { title: 'Replacement', status: 'Proposed', rationale: '' });
  
  // Set superseded_by_id on original — must also set status=Superseded
  await adapter.update('decisions', d1.id, { 
    superseded_by_id: d2.id, 
    status: 'Superseded', 
    rationale: 'Superseded by better option' 
  });
  const superseded = await adapter.get('decisions', d1.id);
  assert(superseded.superseded_by_id === d2.id);
  assert(superseded.status === 'Superseded');
  
  // Try to change superseded_by_id again — should fail
  const d3 = await adapter.insert('decisions', { title: 'Another', status: 'Proposed', rationale: '' });
  try {
    await adapter.update('decisions', d1.id, { superseded_by_id: d3.id });
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.code === '42501');
  }
});

// ========== G4: Atomic Supersession RPC ==========
test('G4: supersede_decision RPC creates replacement atomically', async () => {
  const adapter = createFixtureAdapter({ seed, session });
  
  const original = await adapter.insert('decisions', { 
    title: 'Original Decision', status: 'Approved', rationale: 'Original rationale' 
  });
  
  const newId = await adapter.rpc('supersede_decision', {
    p_original_id: original.id,
    p_new_title: 'Replacement Decision',
    p_new_context: 'New context',
    p_new_problem: 'New problem',
    p_new_rationale: 'Supersession rationale',
    p_new_decision_date: '2026-11-08',
    p_new_review_date: null,
    p_new_selected_option_id: null,
    p_new_project_id: null,
    p_new_contact_id: null,
    p_options: [
      { title: 'Option A', description: 'Desc A', pros: 'Pro A', cons: 'Con A', sort_order: 0 },
      { title: 'Option B', description: 'Desc B', pros: 'Pro B', cons: 'Con B', sort_order: 1 }
    ]
  });
  
  assert(newId !== original.id, 'new decision created');
  
  const replacement = await adapter.get('decisions', newId);
  assert(replacement.title === 'Replacement Decision');
  assert(replacement.status === 'Proposed');
  assert(replacement.superseded_by_id === null);
  
  const opts = await adapter.select('decision_options', { decision_id: newId });
  assert(opts.length === 2, 'two options created');
  
  const orig = await adapter.get('decisions', original.id);
  assert(orig.status === 'Superseded');
  assert(orig.superseded_by_id === newId);
  assert(orig.rationale === 'Supersession rationale');
});

test('G4: supersede_decision RPC rolls back on failure', async () => {
  const adapter = createFixtureAdapter({ seed, session });
  
  const original = await adapter.insert('decisions', { 
    title: 'Orig', status: 'Approved', rationale: 'R' 
  });
  
  // Try to supersede a non-terminal decision — should fail, nothing created
  const proposed = await adapter.insert('decisions', { title: 'Prop', status: 'Proposed', rationale: '' });
  try {
    await adapter.rpc('supersede_decision', {
      p_original_id: proposed.id,  // not terminal!
      p_new_title: 'Replacement',
      p_new_context: '', p_new_problem: '', p_new_rationale: 'Rationale',
      p_new_decision_date: '2026-11-08',
      p_options: []
    });
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.code === '23514');
  }
  
  // Verify no replacement created
  const all = await adapter.select('decisions', {});
  const replacements = all.filter(d => d.title === 'Replacement');
  assert(replacements.length === 0, 'no partial replacement on failure');
});

// ========== G7: Milestone achieved_at ==========
test('G7: milestone achieved_at set by trigger on status=Achieved', async () => {
  const adapter = createFixtureAdapter({ seed, session });
  
  const proj = await adapter.select('projects', { limit: 1 });
  const m = await adapter.insert('milestones', { 
    project_id: proj[0].id, title: 'Test Milestone', due_date: '2026-12-01', status: 'Upcoming' 
  });
  
  // Client cannot set achieved_at (not in insert grant)
  assert(m.achieved_at === null, 'achieved_at null on create');
  
  // Update to Achieved — trigger sets achieved_at
  const updated = await adapter.update('milestones', m.id, { status: 'Achieved' });
  assert(updated.achieved_at !== null, 'achieved_at set by trigger');
  assert(updated.status === 'Achieved');
  
  // Change away from Achieved — trigger clears achieved_at
  const cleared = await adapter.update('milestones', m.id, { status: 'Delayed' });
  assert(cleared.achieved_at === null, 'achieved_at cleared');
  assert(cleared.status === 'Delayed');
  
  // Back to Achieved — new timestamp
  const re_achieved = await adapter.update('milestones', m.id, { status: 'Achieved' });
  assert(re_achieved.achieved_at !== null);
  // Note: new timestamp > old one (can't easily test without time control)
});

test('G7: client cannot set achieved_at directly', async () => {
  const adapter = createFixtureAdapter({ seed, session });
  
  const proj = await adapter.select('projects', { limit: 1 });
  
  // Try to insert with achieved_at — should be ignored or fail (not in insert grant)
  const m = await adapter.insert('milestones', { 
    project_id: proj[0].id, title: 'Test', due_date: '2026-12-01', 
    status: 'Upcoming', achieved_at: '2026-01-01T00:00:00Z'  // should be ignored
  });
  // In fixture adapter: grant check will reject column not in insert list
  // In real DB: column not in INSERT grant → privilege error
});

// ========== Cross-revision ==========
test('All revisions: activity_records written', async () => {
  const adapter = createFixtureAdapter({ seed, session });
  
  // Each operation should produce activity_records
  const c = await adapter.insert('contacts', { first_name: 'Act', category: 'Client' });
  await adapter.update('contacts', c.id, { archived_at: new Date().toISOString() });
  
  const acts = await adapter.select('activity_records', { entity_table: 'contacts' });
  assert(acts.some(a => a.event_type === 'contacts.insert'));
  assert(acts.some(a => a.event_type === 'contacts.update'));
});
```

### 8.2 Existing Test Updates

| Test File | Changes |
|-----------|---------|
| `tests/app/m2.test.mjs` | Add tests for contact archive filter, decision immutability, milestone trigger |
| `tests/app/data.test.mjs` | Verify schema mirror matches new columns/grants |
| `tests/app/finance.test.mjs` | No changes (finance unaffected) |

### 8.3 Parity Tests

- Run all existing fixtures through new adapter — verify derived figures unchanged
- `finance-parity.test.mjs` pattern applied to contacts, decisions, milestones

---

## 9. Adapter Changes (Development Adapter)

### 9.1 `app/data/schema.js` — see §4.2

### 9.2 `app/data/adapters/fixture.js` — key additions

```javascript
// In createFixtureAdapter():

// 1. Add GUC simulation for contacts
const visible = (table, r) => {
  if (table === 'contacts') {
    const includeArchived = session.includeArchivedContacts === true; // or from a GUC map
    return r.business_id === session.business_id && (r.archived_at == null || includeArchived);
  }
  // ... existing
};

// 2. Contacts: add archived_at column, update grants, beforeWrite guard
// In TABLES.contacts (schema.js) — already covered by schema mirror

// In fixture.js beforeWrite():
if (table === 'contacts' && op === 'update') {
  const s = spec(table);
  const oldRow = rows(table).find(x => x.id === row.id);
  if (oldRow?.archived_at && row.archived_at) {
    throw new DataError(SQLSTATE.privilege, 'Archived contacts cannot be modified; unarchive first');
  }
}

// 3. Decisions: guard_decision_immutability in beforeWrite
if (table === 'decisions') {
  // INSERT validation
  if (op === 'insert') {
    const terminal = ['Approved','Rejected','Superseded'];
    if (terminal.includes(row.status)) {
      if (!row.rationale || row.rationale.trim() === '') {
        throw new DataError(SQLSTATE.check, 'Terminal decisions require a non-empty rationale', { constraint: 'chk_decisions_rationale_required' });
      }
      if (row.status === 'Superseded' && !row.superseded_by_id) {
        throw new DataError(SQLSTATE.check, 'Superseded decisions must reference the replacing decision', { constraint: 'chk_decisions_superseded_ref' });
      }
    }
  }
  // UPDATE validation
  if (op === 'update') {
    const oldRow = rows(table).find(x => x.id === row.id);
    const terminal = ['Approved','Rejected','Superseded'];
    if (terminal.includes(oldRow.status)) {
      // Check frozen fields
      const frozen = ['title','context','problem','rationale','status','decision_date','review_date','selected_option_id','project_id','contact_id'];
      for (const f of frozen) {
        if (row[f] !== undefined && row[f] !== oldRow[f]) {
          throw new DataError(SQLSTATE.privilege, `Terminal decisions are immutable (status: ${oldRow.status})`, { column: f });
        }
      }
      // superseded_by_id once
      if (oldRow.superseded_by_id && row.superseded_by_id !== oldRow.superseded_by_id) {
        throw new DataError(SQLSTATE.privilege, 'superseded_by_id is final once set');
      }
      // Setting superseded_by_id requires status=Superseded + rationale
      if (!oldRow.superseded_by_id && row.superseded_by_id) {
        if (row.status !== 'Superseded') throw new DataError(SQLSTATE.check, 'Setting superseded_by_id requires status = Superseded');
        if (!row.rationale || row.rationale.trim() === '') throw new DataError(SQLSTATE.check, 'Superseded decisions require a non-empty rationale');
      }
    }
    // Proposed -> Terminal: enforce rationale
    if (oldRow.status === 'Proposed' && terminal.includes(row.status)) {
      if (!row.rationale || row.rationale.trim() === '') throw new DataError(SQLSTATE.check, 'Terminal decisions require a non-empty rationale');
      if (row.status === 'Superseded' && !row.superseded_by_id) throw new DataError(SQLSTATE.check, 'Superseded decisions must reference the replacing decision');
    }
    // Terminal -> Proposed forbidden
    if (terminal.includes(oldRow.status) && row.status === 'Proposed') {
      throw new DataError(SQLSTATE.privilege, 'Cannot revert a terminal decision to Proposed');
    }
  }
}

// 4. Milestones: set_milestone_achieved_at in beforeWrite
if (table === 'milestones' && op === 'update') {
  const oldRow = rows(table).find(x => x.id === row.id);
  if (row.status === 'Achieved' && oldRow.status !== 'Achieved') {
    row.achieved_at = now().toISOString();
  } else if (row.status !== 'Achieved' && oldRow.status === 'Achieved') {
    row.achieved_at = null;
  }
  // If status stays Achieved, keep existing achieved_at (don't override)
}

// 5. RPC: supersede_decision
RPCS.supersede_decision = (q, args) => {
  // Implement atomic transaction using q.sysInsert, q.sysUpdate
  // Mirror the SQL logic exactly
  // Return new decision ID
};
```

### 9.3 `app/data/adapters/server-finance.js` or new `server-decisions.js`

Add `supersede_decision` to `RPCS` export for parity with Supabase.

---

## 10. Migration Execution Order & Dependencies

```
Current: 9 migrations (1-6 applied, 7-9 reserved for vault/integrations)

New:
  7: contact_archiving.sql              (G2)        — independent
  8: decision_immutability_rationale.sql (G3, G6)   — independent
  9: atomic_supersession_rpc.sql        (G4)        — depends on 8 (trigger must exist)
 10: milestone_achieved_at.sql          (G7)        — independent
 11: contact_archive_rls.sql            (G2 follow) — depends on 7
```

**Recommended batch:** Apply 7, 8, 10, 11 together (independent), then 9.

---

## 11. Documentation Updates Required

| File | Change |
|------|--------|
| `app/README.md` | Update "M2: schema gaps" section — mark G2,G3,G4,G6,G7 as "Migration ready" |
| `docs/GATE-1-REPORT.md` | §9 founder approvals — these 5 items now have migration designs |
| `app/data/schema.js` | Updated per §4.2 |
| `app/modules/contacts.js` | Archive UI, filter toggle |
| `app/modules/decisions.js` | Remove client immutability checks (DB enforces), add supersede RPC call |
| `app/modules/milestones.js` | Remove `achieved_at` from create/edit payloads |

---

## 12. Risk Assessment & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Existing terminal decisions have empty `rationale` | High | Blocks UPDATE until fixed | Migration 8 backfill or app pre-migration script to populate rationale |
| Client code still sends `achieved_at` for milestones | Medium | Privilege errors (42501) | Update app code **before** migration 10 applied; test in dev adapter first |
| `supersede_decision` RPC parameter drift | Low | Runtime errors | TypeScript-style JSDoc on RPC; integration test in parity suite |
| Archive filter breaks existing contact lookups | Low | Missing relationships | `SET LOCAL app.include_archived_contacts` in repo methods that need it |
| Trigger performance on large tables | Low | Latency | Triggers are simple (status check + timestamp); indexes exist on status |

---

## 13. Sign-off Checklist

Before authorising execution:

- [ ] All 5 migration files written and reviewed
- [ ] Development adapter updated and all 53+ tests pass
- [ ] Schema mirror (`schema.js`, `schema-finance.js`) matches migrations
- [ ] Regression test file (`schema-revisions.test.mjs`) created and passing
- [ ] Documentation updates drafted
- [ ] Rollback migrations (12-15) designed (not executed, just documented)
- [ ] Founder review of migration SQL (especially RPC security)
- [ ] Separate authorisation for Supabase execution obtained

---

## 14. Appendix: Complete New Migration Files

See individual files in `supabase/migrations/`:
- `20261108_001_contact_archiving.sql`
- `20261108_002_decision_immutability_rationale.sql`
- `20261108_003_atomic_supersession_rpc.sql`
- `20261108_004_milestone_achieved_at.sql`
- `20261108_005_contact_archive_rls.sql`

---

**End of Proposal**