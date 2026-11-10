-- MER-ENG-SPEC-001 Rev 2.2, Section 6.1 -- transcribed verbatim for disposable validation.
-- MIGRATION 00002.up.sql: CORE OPERATIONS (CONTACTS, PROJECTS, MILESTONES, TASKS, SUBTASKS, DECISIONS, CALENDAR)

CREATE TABLE public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL CHECK (char_length(trim(first_name)) > 0),
    last_name TEXT,
    organization TEXT,
    role TEXT,
    email TEXT,
    phone TEXT,
    category TEXT NOT NULL CHECK (category IN ('Investor', 'Client', 'Partner', 'Vendor', 'Advisor', 'Collaborator', 'Other')),
    notes TEXT,
    last_contacted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contacts_business_id UNIQUE (business_id, id)
);

CREATE TRIGGER trg_contacts_updated_at
BEFORE UPDATE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    description TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'Planning' CHECK (status IN ('Planning', 'Active', 'On Hold', 'Completed', 'Archived')),
    priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Critical')),
    start_date DATE,
    target_end_date DATE,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_projects_business_id UNIQUE (business_id, id),
    CONSTRAINT chk_projects_dates CHECK (target_end_date IS NULL OR start_date IS NULL OR target_end_date >= start_date)
);

CREATE TRIGGER trg_projects_updated_at
BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.project_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    contact_id UUID NOT NULL,
    relationship_role TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_contact UNIQUE (business_id, project_id, contact_id),
    CONSTRAINT fk_pc_project FOREIGN KEY (business_id, project_id)
        REFERENCES public.projects(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_pc_contact FOREIGN KEY (business_id, contact_id)
        REFERENCES public.contacts(business_id, id) ON DELETE CASCADE
);

CREATE TABLE public.contact_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL,
    project_id UUID,
    interaction_type TEXT NOT NULL CHECK (interaction_type IN ('Meeting', 'Call', 'Email', 'Note', 'Other')),
    interaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    summary TEXT NOT NULL CHECK (char_length(trim(summary)) > 0),
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contact_interactions_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_ci_contact FOREIGN KEY (business_id, contact_id)
        REFERENCES public.contacts(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_ci_project FOREIGN KEY (business_id, project_id)
        REFERENCES public.projects(business_id, id) ON DELETE SET NULL (project_id)
);

CREATE TRIGGER trg_contact_interactions_updated_at
BEFORE UPDATE ON public.contact_interactions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    description TEXT,
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Upcoming', 'In Progress', 'Achieved', 'Delayed', 'Cancelled')),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_milestones_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_milestones_project FOREIGN KEY (business_id, project_id)
        REFERENCES public.projects(business_id, id) ON DELETE CASCADE
);

CREATE TRIGGER trg_milestones_updated_at
BEFORE UPDATE ON public.milestones
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id UUID,
    milestone_id UUID,
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    description TEXT,
    status TEXT NOT NULL DEFAULT 'Inbox' CHECK (status IN ('Inbox', 'Next', 'In Progress', 'Waiting', 'Done')),
    priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Critical')),
    due_date DATE,
    is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
    recurrence_rule TEXT CHECK (recurrence_rule IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annually')),
    recurrence_interval INTEGER CHECK (recurrence_interval IS NULL OR recurrence_interval > 0),
    next_occurrence_date DATE,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tasks_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_tasks_project FOREIGN KEY (business_id, project_id)
        REFERENCES public.projects(business_id, id) ON DELETE SET NULL (project_id),
    CONSTRAINT fk_tasks_milestone FOREIGN KEY (business_id, milestone_id)
        REFERENCES public.milestones(business_id, id) ON DELETE SET NULL (milestone_id),
    CONSTRAINT chk_tasks_recurrence CHECK (
        (is_recurring = FALSE AND recurrence_rule IS NULL) OR
        (is_recurring = TRUE AND recurrence_rule IS NOT NULL)
    )
);

CREATE TRIGGER trg_tasks_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    task_id UUID NOT NULL,
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subtasks_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_subtasks_task FOREIGN KEY (business_id, task_id)
        REFERENCES public.tasks(business_id, id) ON DELETE CASCADE
);

CREATE TRIGGER trg_subtasks_updated_at
BEFORE UPDATE ON public.subtasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id UUID,
    contact_id UUID,
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    context_background TEXT NOT NULL,
    decision_rationale TEXT NOT NULL,
    outcome_notes TEXT,
    status TEXT NOT NULL DEFAULT 'Proposed' CHECK (status IN ('Proposed', 'Approved', 'Superseded', 'Rejected')),
    decision_date DATE NOT NULL DEFAULT CURRENT_DATE,
    review_date DATE,
    selected_option_id UUID,
    superseded_by_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_decisions_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_decisions_project FOREIGN KEY (business_id, project_id)
        REFERENCES public.projects(business_id, id) ON DELETE SET NULL (project_id),
    CONSTRAINT fk_decisions_contact FOREIGN KEY (business_id, contact_id)
        REFERENCES public.contacts(business_id, id) ON DELETE SET NULL (contact_id),
    CONSTRAINT fk_decisions_superseded_by FOREIGN KEY (business_id, superseded_by_id)
        REFERENCES public.decisions(business_id, id) ON DELETE SET NULL (superseded_by_id)
);

CREATE TRIGGER trg_decisions_updated_at
BEFORE UPDATE ON public.decisions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.decision_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    decision_id UUID NOT NULL,
    option_title TEXT NOT NULL CHECK (char_length(trim(option_title)) > 0),
    description TEXT,
    pros TEXT,
    cons TEXT,
    is_selected BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_decision_options_business_id UNIQUE (business_id, id),
    CONSTRAINT uq_decision_options_per_decision UNIQUE (business_id, decision_id, id),
    CONSTRAINT fk_do_decision FOREIGN KEY (business_id, decision_id)
        REFERENCES public.decisions(business_id, id) ON DELETE CASCADE
);

ALTER TABLE public.decisions
    ADD CONSTRAINT fk_decisions_selected_option
    FOREIGN KEY (business_id, id, selected_option_id)
    REFERENCES public.decision_options(business_id, decision_id, id)
    ON DELETE SET NULL (selected_option_id);

CREATE TABLE public.calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id UUID,
    task_id UUID,
    milestone_id UUID,
    contact_id UUID,
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    description TEXT,
    location TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    is_all_day BOOLEAN NOT NULL DEFAULT FALSE,
    source TEXT NOT NULL DEFAULT 'meridian' CHECK (source IN ('meridian', 'google_calendar_cache')),
    external_event_id TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_calendar_events_business_id UNIQUE (business_id, id),
    CONSTRAINT chk_calendar_times CHECK (end_time >= start_time),
    CONSTRAINT fk_ce_project FOREIGN KEY (business_id, project_id)
        REFERENCES public.projects(business_id, id) ON DELETE SET NULL (project_id),
    CONSTRAINT fk_ce_task FOREIGN KEY (business_id, task_id)
        REFERENCES public.tasks(business_id, id) ON DELETE SET NULL (task_id),
    CONSTRAINT fk_ce_milestone FOREIGN KEY (business_id, milestone_id)
        REFERENCES public.milestones(business_id, id) ON DELETE SET NULL (milestone_id),
    CONSTRAINT fk_ce_contact FOREIGN KEY (business_id, contact_id)
        REFERENCES public.contacts(business_id, id) ON DELETE SET NULL (contact_id)
);

CREATE TRIGGER trg_calendar_events_updated_at
BEFORE UPDATE ON public.calendar_events
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
