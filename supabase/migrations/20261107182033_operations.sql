-- =====================================================================================
-- Meridian V1 · Gate 1 · Migration 2/6: contacts, projects, milestones, tasks,
-- decisions, calendar. Ordinary editable workspace data (full CRUD for the founder).
-- =====================================================================================

CREATE TABLE public.contacts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    first_name      text NOT NULL CHECK (char_length(btrim(first_name)) BETWEEN 1 AND 120),
    last_name       text,
    organization    text,
    role            text,
    email           text,
    phone           text,
    category        text NOT NULL CHECK (category IN ('Investor', 'Client', 'Partner', 'Vendor', 'Advisor', 'Collaborator', 'Other')),
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_contacts_business UNIQUE (business_id, id)
);

CREATE TABLE public.projects (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    description     text,
    notes           text,
    status          text NOT NULL DEFAULT 'Planning' CHECK (status IN ('Planning', 'Active', 'On Hold', 'Completed', 'Archived')),
    priority        text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Critical')),
    start_date      date,
    target_date     date,
    completed_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_projects_business UNIQUE (business_id, id),
    CONSTRAINT chk_projects_dates CHECK (target_date IS NULL OR start_date IS NULL OR target_date >= start_date)
);

CREATE TABLE public.project_contacts (
    business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id          uuid NOT NULL,
    contact_id          uuid NOT NULL,
    relationship_role   text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id, project_id, contact_id),
    CONSTRAINT fk_pc_project FOREIGN KEY (business_id, project_id) REFERENCES public.projects(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_pc_contact FOREIGN KEY (business_id, contact_id) REFERENCES public.contacts(business_id, id) ON DELETE CASCADE
);

CREATE TABLE public.contact_interactions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    contact_id          uuid NOT NULL,
    project_id          uuid,
    interaction_type    text NOT NULL CHECK (interaction_type IN ('Meeting', 'Call', 'Email', 'Note', 'Other')),
    occurred_at         timestamptz NOT NULL DEFAULT now(),
    summary             text NOT NULL CHECK (char_length(btrim(summary)) > 0),
    details             text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_contact_interactions_business UNIQUE (business_id, id),
    CONSTRAINT fk_ci_contact FOREIGN KEY (business_id, contact_id) REFERENCES public.contacts(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_ci_project FOREIGN KEY (business_id, project_id) REFERENCES public.projects(business_id, id) ON DELETE SET NULL (project_id)
);

CREATE TABLE public.milestones (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id      uuid NOT NULL,
    title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    description     text,
    due_date        date NOT NULL,
    status          text NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Upcoming', 'In Progress', 'Achieved', 'Delayed', 'Cancelled')),
    achieved_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_milestones_business UNIQUE (business_id, id),
    CONSTRAINT fk_milestones_project FOREIGN KEY (business_id, project_id) REFERENCES public.projects(business_id, id) ON DELETE CASCADE
);

CREATE TABLE public.tasks (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id          uuid,
    milestone_id        uuid,
    title               text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    description         text,
    notes               text,
    status              text NOT NULL DEFAULT 'Inbox' CHECK (status IN ('Inbox', 'Next', 'In Progress', 'Waiting', 'Done')),
    priority            text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Critical')),
    due_date            date,
    recurrence_rule     text CHECK (recurrence_rule IN ('daily', 'weekly', 'monthly', 'quarterly', 'annually')),
    recurrence_interval integer CHECK (recurrence_interval BETWEEN 1 AND 365),
    completed_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_tasks_business UNIQUE (business_id, id),
    CONSTRAINT fk_tasks_project FOREIGN KEY (business_id, project_id) REFERENCES public.projects(business_id, id) ON DELETE SET NULL (project_id),
    CONSTRAINT fk_tasks_milestone FOREIGN KEY (business_id, milestone_id) REFERENCES public.milestones(business_id, id) ON DELETE SET NULL (milestone_id),
    CONSTRAINT chk_tasks_recurrence CHECK ((recurrence_rule IS NULL) = (recurrence_interval IS NULL))
);

-- Done <-> completed_at kept consistent server-side (completion history lives in activity_records)
CREATE FUNCTION public.sync_task_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'Done' AND NEW.completed_at IS NULL THEN
        NEW.completed_at := now();
    ELSIF NEW.status <> 'Done' THEN
        NEW.completed_at := NULL;
    END IF;
    RETURN NEW;
END $$;

CREATE TABLE public.subtasks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    task_id         uuid NOT NULL,
    title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    is_completed    boolean NOT NULL DEFAULT false,
    sort_order      integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_subtasks_business UNIQUE (business_id, id),
    CONSTRAINT fk_subtasks_task FOREIGN KEY (business_id, task_id) REFERENCES public.tasks(business_id, id) ON DELETE CASCADE
);

CREATE TABLE public.decisions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id          uuid,
    contact_id          uuid,
    title               text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    context             text NOT NULL DEFAULT '',
    problem             text NOT NULL DEFAULT '',
    rationale           text NOT NULL DEFAULT '',
    status              text NOT NULL DEFAULT 'Proposed' CHECK (status IN ('Proposed', 'Approved', 'Superseded', 'Rejected')),
    decision_date       date NOT NULL DEFAULT CURRENT_DATE,
    review_date         date,
    selected_option_id  uuid,
    superseded_by_id    uuid,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_decisions_business UNIQUE (business_id, id),
    CONSTRAINT fk_decisions_project FOREIGN KEY (business_id, project_id) REFERENCES public.projects(business_id, id) ON DELETE SET NULL (project_id),
    CONSTRAINT fk_decisions_contact FOREIGN KEY (business_id, contact_id) REFERENCES public.contacts(business_id, id) ON DELETE SET NULL (contact_id),
    CONSTRAINT fk_decisions_superseded_by FOREIGN KEY (business_id, superseded_by_id) REFERENCES public.decisions(business_id, id) ON DELETE SET NULL (superseded_by_id),
    CONSTRAINT chk_decisions_not_self_superseded CHECK (superseded_by_id IS DISTINCT FROM id)
);

CREATE TABLE public.decision_options (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    decision_id     uuid NOT NULL,
    title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    description     text,
    pros            text,
    cons            text,
    sort_order      integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_decision_options_business UNIQUE (business_id, id),
    CONSTRAINT uq_decision_options_owner UNIQUE (business_id, decision_id, id),
    CONSTRAINT fk_do_decision FOREIGN KEY (business_id, decision_id) REFERENCES public.decisions(business_id, id) ON DELETE CASCADE
);

-- the selected option must belong to the same decision (validated in Rev 2.2, SEC-05x)
ALTER TABLE public.decisions ADD CONSTRAINT fk_decisions_selected_option
    FOREIGN KEY (business_id, id, selected_option_id) REFERENCES public.decision_options(business_id, decision_id, id)
    ON DELETE SET NULL (selected_option_id);

CREATE TABLE public.calendar_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id      uuid,
    task_id         uuid,
    milestone_id    uuid,
    contact_id      uuid,
    title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    description     text,
    location        text,
    starts_at       timestamptz NOT NULL,
    ends_at         timestamptz NOT NULL,
    is_all_day      boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_calendar_events_business UNIQUE (business_id, id),
    CONSTRAINT chk_calendar_times CHECK (ends_at >= starts_at),
    CONSTRAINT fk_ce_project FOREIGN KEY (business_id, project_id) REFERENCES public.projects(business_id, id) ON DELETE SET NULL (project_id),
    CONSTRAINT fk_ce_task FOREIGN KEY (business_id, task_id) REFERENCES public.tasks(business_id, id) ON DELETE SET NULL (task_id),
    CONSTRAINT fk_ce_milestone FOREIGN KEY (business_id, milestone_id) REFERENCES public.milestones(business_id, id) ON DELETE SET NULL (milestone_id),
    CONSTRAINT fk_ce_contact FOREIGN KEY (business_id, contact_id) REFERENCES public.contacts(business_id, id) ON DELETE SET NULL (contact_id)
);

-- triggers
CREATE TRIGGER trg_tasks_completion BEFORE INSERT OR UPDATE OF status ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.sync_task_completion();

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['contacts', 'projects', 'contact_interactions', 'milestones', 'tasks', 'subtasks', 'decisions', 'calendar_events'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['projects', 'milestones', 'tasks', 'decisions'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%1$s_activity AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.record_activity()', t);
    END LOOP;

    -- RLS + tenant policy + explicit grants: full CRUD, never TRUNCATE, nothing for anon
    FOREACH t IN ARRAY ARRAY['contacts', 'projects', 'project_contacts', 'contact_interactions', 'milestones', 'tasks', 'subtasks',
                             'decisions', 'decision_options', 'calendar_events'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY %1$s_tenant ON public.%1$I FOR ALL TO authenticated USING (business_id = public.get_current_business_id()) WITH CHECK (business_id = public.get_current_business_id())', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
        EXECUTE format('REVOKE TRUNCATE ON public.%I FROM service_role', t);
    END LOOP;
END $$;

-- business_id / id are never client-updatable (keeps rows inside their tenant even if a policy regresses)
REVOKE UPDATE ON public.contacts, public.projects, public.contact_interactions, public.milestones, public.tasks, public.subtasks,
    public.decisions, public.decision_options, public.calendar_events, public.project_contacts FROM authenticated;
GRANT UPDATE (first_name, last_name, organization, role, email, phone, category, notes) ON public.contacts TO authenticated;
GRANT UPDATE (name, description, notes, status, priority, start_date, target_date, completed_at) ON public.projects TO authenticated;
GRANT UPDATE (relationship_role) ON public.project_contacts TO authenticated;
GRANT UPDATE (contact_id, project_id, interaction_type, occurred_at, summary, details) ON public.contact_interactions TO authenticated;
GRANT UPDATE (project_id, title, description, due_date, status, achieved_at) ON public.milestones TO authenticated;
GRANT UPDATE (project_id, milestone_id, title, description, notes, status, priority, due_date, recurrence_rule, recurrence_interval) ON public.tasks TO authenticated;
GRANT UPDATE (title, is_completed, sort_order) ON public.subtasks TO authenticated;
GRANT UPDATE (project_id, contact_id, title, context, problem, rationale, status, decision_date, review_date, selected_option_id, superseded_by_id) ON public.decisions TO authenticated;
GRANT UPDATE (title, description, pros, cons, sort_order) ON public.decision_options TO authenticated;
GRANT UPDATE (project_id, task_id, milestone_id, contact_id, title, description, location, starts_at, ends_at, is_all_day) ON public.calendar_events TO authenticated;

REVOKE ALL ON FUNCTION public.sync_task_completion() FROM PUBLIC, anon, authenticated;

CREATE INDEX idx_projects_business_status ON public.projects (business_id, status);
CREATE INDEX idx_milestones_project_due ON public.milestones (business_id, project_id, due_date);
CREATE INDEX idx_tasks_business_status_due ON public.tasks (business_id, status, due_date);
CREATE INDEX idx_tasks_project ON public.tasks (business_id, project_id);
CREATE INDEX idx_subtasks_task ON public.subtasks (business_id, task_id);
CREATE INDEX idx_contact_interactions_contact ON public.contact_interactions (business_id, contact_id, occurred_at DESC);
CREATE INDEX idx_decisions_business_status ON public.decisions (business_id, status, decision_date DESC);
CREATE INDEX idx_calendar_business_window ON public.calendar_events (business_id, starts_at, ends_at);
