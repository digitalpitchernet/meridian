-- MER-ENG-SPEC-001 Rev 2.2, Section 6.1 -- transcribed verbatim for disposable validation.
-- MIGRATION 00006.up.sql: COMPANY VAULT, INTEGRATIONS, ACTIVITY LEDGER TRIGGERS & OUTBOX WORKER ENGINE

CREATE TABLE public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    parent_document_id UUID,
    version_number INTEGER NOT NULL DEFAULT 1 CHECK (version_number >= 1),
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    file_path TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes >= 0),
    mime_type TEXT NOT NULL,
    checksum_sha256 CHAR(64),
    storage_provider TEXT NOT NULL CHECK (storage_provider IN ('supabase', 'local_fs', 'google_drive')),
    external_drive_id TEXT,
    provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    category TEXT NOT NULL CHECK (category IN ('Legal', 'Financial', 'Technical', 'Marketing', 'Administrative', 'Other')),
    tags TEXT[] NOT NULL DEFAULT '{}',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_documents_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_documents_parent FOREIGN KEY (business_id, parent_document_id)
        REFERENCES public.documents(business_id, id) ON DELETE SET NULL (parent_document_id)
);

CREATE TRIGGER trg_documents_updated_at
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.document_associations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    project_id UUID,
    milestone_id UUID,
    task_id UUID,
    decision_id UUID,
    contact_id UUID,
    transaction_id UUID,
    commitment_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_document_associations_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_da_document FOREIGN KEY (business_id, document_id)
        REFERENCES public.documents(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_da_project FOREIGN KEY (business_id, project_id)
        REFERENCES public.projects(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_da_milestone FOREIGN KEY (business_id, milestone_id)
        REFERENCES public.milestones(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_da_task FOREIGN KEY (business_id, task_id)
        REFERENCES public.tasks(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_da_decision FOREIGN KEY (business_id, decision_id)
        REFERENCES public.decisions(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_da_contact FOREIGN KEY (business_id, contact_id)
        REFERENCES public.contacts(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_da_transaction FOREIGN KEY (business_id, transaction_id)
        REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_da_commitment FOREIGN KEY (business_id, commitment_id)
        REFERENCES public.funding_commitments(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_document_single_target CHECK (
        (CASE WHEN project_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN milestone_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN task_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN decision_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN contact_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN transaction_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN commitment_id IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);

CREATE TABLE public.integration_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google_calendar', 'google_drive', 'gmail')),
    status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error', 'revoked')),
    scopes TEXT[] NOT NULL DEFAULT '{}',
    sync_cursor TEXT,
    last_synced_at TIMESTAMPTZ,
    last_error_code TEXT,
    last_error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_integration_connections_business_id UNIQUE (business_id, id),
    CONSTRAINT uq_business_provider UNIQUE (business_id, provider)
);

CREATE TRIGGER trg_integration_connections_updated_at
BEFORE UPDATE ON public.integration_connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.activity_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system', 'integration')),
    actor_id UUID,
    event_type TEXT NOT NULL,
    event_version SMALLINT NOT NULL DEFAULT 1,
    entity_table TEXT NOT NULL,
    entity_id UUID NOT NULL,
    summary TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_activity_records_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_activity_actor FOREIGN KEY (business_id, actor_id)
        REFERENCES public.profiles(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_activity_actor CHECK (
        (actor_type = 'user' AND actor_id IS NOT NULL) OR
        (actor_type IN ('system', 'integration') AND actor_id IS NULL)
    )
);

CREATE OR REPLACE FUNCTION public.prevent_activity_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'public.activity_records is strictly append-only; UPDATE and DELETE are prohibited.';
END;
$$;

CREATE TRIGGER trg_prevent_activity_mutation
BEFORE UPDATE OR DELETE ON public.activity_records
FOR EACH ROW EXECUTE FUNCTION public.prevent_activity_mutation();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.activity_records FROM anon, authenticated;

CREATE TABLE public.transactional_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    activity_record_id UUID NOT NULL,
    topic TEXT NOT NULL,
    payload JSONB NOT NULL,
    dedup_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'dispatched', 'failed', 'dead_letter')),
    attempts SMALLINT NOT NULL DEFAULT 0,
    last_error TEXT,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_outbox_dedup UNIQUE (business_id, dedup_key),
    CONSTRAINT fk_outbox_activity FOREIGN KEY (business_id, activity_record_id)
        REFERENCES public.activity_records(business_id, id) ON DELETE CASCADE
);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.transactional_outbox FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_domain_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_record RECORD;
    v_business_id UUID;
    v_entity_id UUID;
    v_actor_id UUID;
    v_actor_type TEXT;
    v_event_type TEXT;
    v_summary TEXT;
    v_metadata JSONB := '{}'::jsonb;
    v_activity_id UUID;
    v_dedup_key TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_record := OLD;
    ELSE
        v_record := NEW;
    END IF;

    v_business_id := v_record.business_id;
    v_entity_id := v_record.id;

    v_actor_id := auth.uid();
    IF v_actor_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.business_id = v_business_id AND p.id = v_actor_id
    ) THEN
        v_actor_type := 'user';
    ELSE
        v_actor_id := NULL;
        v_actor_type := COALESCE(NULLIF(current_setting('app.current_actor_type', TRUE), ''), 'system');
        IF v_actor_type NOT IN ('system', 'integration') THEN
            v_actor_type := 'system';
        END IF;
    END IF;

    v_event_type := TG_TABLE_NAME || '.' || lower(TG_OP);

    IF TG_TABLE_NAME = 'projects' THEN
        v_summary := 'Project "' || v_record.name || '" ' || lower(TG_OP) || ' (status: ' || v_record.status || ')';
        v_metadata := jsonb_build_object('status', v_record.status, 'priority', v_record.priority);
    ELSIF TG_TABLE_NAME = 'tasks' THEN
        v_summary := 'Task "' || v_record.title || '" ' || lower(TG_OP) || ' (status: ' || v_record.status || ')';
        v_metadata := jsonb_build_object('status', v_record.status, 'project_id', v_record.project_id);
    ELSIF TG_TABLE_NAME = 'milestones' THEN
        v_summary := 'Milestone "' || v_record.title || '" ' || lower(TG_OP) || ' (status: ' || v_record.status || ')';
        v_metadata := jsonb_build_object('status', v_record.status, 'project_id', v_record.project_id);
    ELSIF TG_TABLE_NAME = 'decisions' THEN
        v_summary := 'Decision "' || v_record.title || '" ' || lower(TG_OP) || ' (status: ' || v_record.status || ')';
        v_metadata := jsonb_build_object('status', v_record.status);
    ELSIF TG_TABLE_NAME = 'funding_commitments' THEN
        v_summary := 'Funding commitment from "' || v_record.funder_name || '" ' || lower(TG_OP) || ' (status: ' || v_record.status || ')';
        v_metadata := jsonb_build_object('status', v_record.status, 'committed_amount', v_record.committed_amount, 'currency', v_record.currency);
    ELSIF TG_TABLE_NAME = 'transactions' THEN
        IF TG_OP = 'UPDATE' AND OLD.is_reversed = FALSE AND NEW.is_reversed = TRUE THEN
            v_event_type := 'transactions.reversed';
            v_summary := 'Transaction reversed: ' || v_record.description || ' (' || v_record.amount || ' ' || v_record.currency || ')';
        ELSE
            v_summary := 'Transaction (' || v_record.type || ') recorded: ' || v_record.description || ' (' || v_record.amount || ' ' || v_record.currency || ')';
        END IF;
        v_metadata := jsonb_build_object('type', v_record.type, 'amount', v_record.amount, 'currency', v_record.currency, 'is_reversed', v_record.is_reversed);
    ELSIF TG_TABLE_NAME = 'payment_allocations' THEN
        IF TG_OP = 'UPDATE' AND OLD.is_reversed = FALSE AND NEW.is_reversed = TRUE THEN
            v_event_type := 'payment_allocations.reversed';
            v_summary := 'Payment allocation reversed (' || v_record.amount || ' ' || v_record.currency || ')';
        ELSE
            v_summary := 'Payment allocated (' || v_record.amount || ' ' || v_record.currency || ')';
        END IF;
        v_metadata := jsonb_build_object('commitment_id', v_record.commitment_id, 'transaction_id', v_record.transaction_id, 'amount', v_record.amount, 'currency', v_record.currency, 'is_reversed', v_record.is_reversed);
    ELSE
        v_summary := TG_TABLE_NAME || ' record ' || lower(TG_OP);
    END IF;

    INSERT INTO public.activity_records (
        business_id, actor_type, actor_id, event_type, event_version,
        entity_table, entity_id, summary, metadata
    ) VALUES (
        v_business_id, v_actor_type, v_actor_id, v_event_type, 1,
        TG_TABLE_NAME, v_entity_id, v_summary, v_metadata
    ) RETURNING id INTO v_activity_id;

    v_dedup_key := TG_TABLE_NAME || ':' || v_entity_id::TEXT || ':' || txid_current()::TEXT || ':' || v_activity_id::TEXT;

    INSERT INTO public.transactional_outbox (
        business_id, activity_record_id, topic, payload, dedup_key, status
    ) VALUES (
        v_business_id,
        v_activity_id,
        'domain.' || v_event_type,
        jsonb_build_object(
            'activity_id', v_activity_id,
            'business_id', v_business_id,
            'event_type', v_event_type,
            'entity_table', TG_TABLE_NAME,
            'entity_id', v_entity_id,
            'metadata', v_metadata
        ),
        v_dedup_key,
        'pending'
    );

    RETURN NULL;
END;
$$;

ALTER FUNCTION public.record_domain_activity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_domain_activity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_projects_activity
AFTER INSERT OR UPDATE OR DELETE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.record_domain_activity();

CREATE TRIGGER trg_tasks_activity
AFTER INSERT OR UPDATE OR DELETE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.record_domain_activity();

CREATE TRIGGER trg_milestones_activity
AFTER INSERT OR UPDATE OR DELETE ON public.milestones
FOR EACH ROW EXECUTE FUNCTION public.record_domain_activity();

CREATE TRIGGER trg_decisions_activity
AFTER INSERT OR UPDATE OR DELETE ON public.decisions
FOR EACH ROW EXECUTE FUNCTION public.record_domain_activity();

CREATE TRIGGER trg_funding_commitments_activity
AFTER INSERT OR UPDATE ON public.funding_commitments
FOR EACH ROW EXECUTE FUNCTION public.record_domain_activity();

CREATE TRIGGER trg_transactions_activity
AFTER INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.record_domain_activity();

CREATE TRIGGER trg_payment_allocations_activity
AFTER INSERT OR UPDATE ON public.payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.record_domain_activity();

CREATE OR REPLACE FUNCTION public.claim_outbox_batch(p_batch_size INTEGER DEFAULT 25)
RETURNS SETOF public.transactional_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    RETURN QUERY
    WITH claimed AS (
        SELECT id
        FROM public.transactional_outbox
        WHERE status IN ('pending', 'failed')
          AND available_at <= NOW()
          AND attempts < 5
        ORDER BY available_at ASC, created_at ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.transactional_outbox o
    SET status = 'processing',
        attempts = o.attempts + 1
    FROM claimed c
    WHERE o.id = c.id
    RETURNING o.*;
END;
$$;

ALTER FUNCTION public.claim_outbox_batch(INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_outbox_batch(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_batch(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_outbox_item(
    p_outbox_id UUID,
    p_success BOOLEAN,
    p_error_message TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF p_success THEN
        UPDATE public.transactional_outbox
        SET status = 'dispatched',
            dispatched_at = NOW(),
            last_error = NULL
        WHERE id = p_outbox_id;
    ELSE
        UPDATE public.transactional_outbox
        SET status = CASE WHEN attempts >= 5 THEN 'dead_letter' ELSE 'failed' END,
            last_error = COALESCE(p_error_message, 'Unknown dispatch failure'),
            available_at = NOW() + (power(2, LEAST(attempts, 6)) || ' seconds')::INTERVAL
        WHERE id = p_outbox_id;
    END IF;
END;
$$;

ALTER FUNCTION public.complete_outbox_item(UUID, BOOLEAN, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_outbox_item(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_outbox_item(UUID, BOOLEAN, TEXT) TO service_role;
