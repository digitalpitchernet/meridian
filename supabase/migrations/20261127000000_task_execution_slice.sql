-- =====================================================================================
-- Meridian V1 · Task Execution Vertical Slice · Migration 10
-- Adds workspace-scoped task assignment (assigned_to_participant_id) and rich
-- task accountability logging (status transitions, assignments, completions).
-- =====================================================================================

ALTER TABLE public.tasks
    ADD COLUMN assigned_to_participant_id uuid;

-- Composite FK guarantees a task can only be assigned to a participant in the same workspace.
ALTER TABLE public.tasks
    ADD CONSTRAINT fk_tasks_assignee
    FOREIGN KEY (business_id, assigned_to_participant_id)
    REFERENCES public.participants(business_id, id)
    ON DELETE SET NULL (assigned_to_participant_id);

CREATE INDEX idx_tasks_assignee
    ON public.tasks (business_id, assigned_to_participant_id)
    WHERE assigned_to_participant_id IS NOT NULL;

GRANT UPDATE (assigned_to_participant_id) ON public.tasks TO authenticated;

-- Enforce that newly assigned participants belong to the same workspace and are active.
CREATE FUNCTION public.guard_task_assignee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_active boolean;
BEGIN
    IF NEW.assigned_to_participant_id IS NOT NULL AND (
        TG_OP = 'INSERT' OR NEW.assigned_to_participant_id IS DISTINCT FROM OLD.assigned_to_participant_id
    ) THEN
        SELECT p.is_active INTO v_active
        FROM public.participants p
        WHERE p.business_id = NEW.business_id
          AND p.id = NEW.assigned_to_participant_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'assignee must belong to the same workspace'
                USING ERRCODE = 'foreign_key_violation';
        END IF;
        IF NOT v_active THEN
            RAISE EXCEPTION 'cannot assign a task to an inactive workspace member'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_tasks_guard_assignee
    BEFORE INSERT OR UPDATE OF assigned_to_participant_id ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.guard_task_assignee();

REVOKE ALL ON FUNCTION public.guard_task_assignee() FROM PUBLIC, anon, authenticated;

-- Replace generic record_activity() on tasks with rich task accountability logging.
DROP TRIGGER IF EXISTS trg_tasks_activity ON public.tasks;

CREATE FUNCTION public.record_task_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_assignee_name text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.assigned_to_participant_id IS NOT NULL THEN
            SELECT p.full_name INTO v_assignee_name
            FROM public.participants p
            WHERE p.business_id = NEW.business_id AND p.id = NEW.assigned_to_participant_id;
        END IF;
        PERFORM public.log_activity(
            NEW.business_id,
            'tasks.insert',
            'tasks',
            NEW.id,
            'Task created: ' || NEW.title,
            jsonb_strip_nulls(jsonb_build_object(
                'status', NEW.status,
                'priority', NEW.priority,
                'assigned_to_participant_id', NEW.assigned_to_participant_id,
                'assignee_name', v_assignee_name
            ))
        );
        RETURN NULL;
    END IF;

    IF TG_OP = 'DELETE' THEN
        PERFORM public.log_activity(
            OLD.business_id,
            'tasks.delete',
            'tasks',
            OLD.id,
            'Task deleted: ' || OLD.title,
            jsonb_strip_nulls(jsonb_build_object('status', OLD.status))
        );
        RETURN NULL;
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM public.log_activity(
            NEW.business_id,
            CASE WHEN NEW.status = 'Done' THEN 'tasks.completed' ELSE 'tasks.status_changed' END,
            'tasks',
            NEW.id,
            CASE WHEN NEW.status = 'Done'
                THEN 'Task completed: ' || NEW.title
                ELSE 'Task moved ' || OLD.status || ' -> ' || NEW.status || ': ' || NEW.title
            END,
            jsonb_strip_nulls(jsonb_build_object(
                'from_status', OLD.status,
                'to_status', NEW.status,
                'status', NEW.status,
                'assigned_to_participant_id', NEW.assigned_to_participant_id,
                'completed_at', NEW.completed_at
            ))
        );
    ELSIF OLD.assigned_to_participant_id IS DISTINCT FROM NEW.assigned_to_participant_id THEN
        IF NEW.assigned_to_participant_id IS NOT NULL THEN
            SELECT p.full_name INTO v_assignee_name
            FROM public.participants p
            WHERE p.business_id = NEW.business_id AND p.id = NEW.assigned_to_participant_id;
        END IF;
        PERFORM public.log_activity(
            NEW.business_id,
            'tasks.assigned',
            'tasks',
            NEW.id,
            CASE WHEN NEW.assigned_to_participant_id IS NOT NULL
                THEN 'Task assigned to ' || COALESCE(v_assignee_name, 'member') || ': ' || NEW.title
                ELSE 'Task unassigned: ' || NEW.title
            END,
            jsonb_strip_nulls(jsonb_build_object(
                'from_assignee_id', OLD.assigned_to_participant_id,
                'to_assignee_id', NEW.assigned_to_participant_id,
                'assignee_name', v_assignee_name,
                'status', NEW.status
            ))
        );
    ELSE
        PERFORM public.log_activity(
            NEW.business_id,
            'tasks.update',
            'tasks',
            NEW.id,
            'Task updated: ' || NEW.title,
            jsonb_strip_nulls(jsonb_build_object(
                'status', NEW.status,
                'priority', NEW.priority,
                'assigned_to_participant_id', NEW.assigned_to_participant_id
            ))
        );
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_tasks_activity
    AFTER INSERT OR UPDATE OR DELETE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.record_task_activity();

REVOKE ALL ON FUNCTION public.record_task_activity() FROM PUBLIC, anon, authenticated;
