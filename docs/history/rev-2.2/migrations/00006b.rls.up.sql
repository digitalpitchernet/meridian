-- MER-ENG-SPEC-001 Rev 2.2, Section 7.2 -- transcribed verbatim.
-- PLACEMENT NOTE (defect V-01): the spec gives this SQL no migration number. 00006.down drops the
-- storage policies and 00001.down drops get_current_business_id(), so it is applied here, after 00006.

CREATE OR REPLACE FUNCTION public.get_current_business_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT business_id
    FROM public.profiles
    WHERE id = auth.uid()
    LIMIT 1;
$$;

ALTER FUNCTION public.get_current_business_id() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_current_business_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_business_id() TO authenticated, service_role;

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses FORCE ROW LEVEL SECURITY;

CREATE POLICY businesses_insert_bootstrap ON public.businesses
    FOR INSERT TO authenticated
    WITH CHECK (
        created_by_user_id = auth.uid()
        AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid())
    );

CREATE POLICY businesses_select_member ON public.businesses
    FOR SELECT TO authenticated
    USING (id = public.get_current_business_id() OR created_by_user_id = auth.uid());

CREATE POLICY businesses_update_member ON public.businesses
    FOR UPDATE TO authenticated
    USING (id = public.get_current_business_id())
    WITH CHECK (id = public.get_current_business_id() AND created_by_user_id = auth.uid());

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY profiles_insert_bootstrap ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK (
        id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.businesses b
            WHERE b.id = business_id AND b.created_by_user_id = auth.uid()
        )
    );

CREATE POLICY profiles_select_own ON public.profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid() OR business_id = public.get_current_business_id());

CREATE POLICY profiles_update_own ON public.profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid() AND business_id = public.get_current_business_id())
    WITH CHECK (id = auth.uid() AND business_id = public.get_current_business_id());

DO $$
DECLARE
    v_table TEXT;
    v_mutable_tables TEXT[] := ARRAY[
        'participants', 'contacts', 'projects', 'project_contacts',
        'contact_interactions', 'milestones', 'tasks', 'subtasks',
        'decisions', 'decision_options', 'calendar_events',
        'capital_structures', 'capital_targets', 'participant_capital_allocations',
        'funding_requirements', 'funding_commitments', 'financial_accounts',
        'financial_categories', 'import_batches', 'import_batch_rows',
        'recurring_transactions', 'documents', 'document_associations',
        'integration_connections'
    ];
BEGIN
    FOREACH v_table IN ARRAY v_mutable_tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_table);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', v_table);

        EXECUTE format(
            'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (business_id = public.get_current_business_id());',
            v_table, v_table
        );
        EXECUTE format(
            'CREATE POLICY %I_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (business_id = public.get_current_business_id());',
            v_table, v_table
        );
        EXECUTE format(
            'CREATE POLICY %I_update ON public.%I FOR UPDATE TO authenticated USING (business_id = public.get_current_business_id()) WITH CHECK (business_id = public.get_current_business_id());',
            v_table, v_table
        );
        EXECUTE format(
            'CREATE POLICY %I_delete ON public.%I FOR DELETE TO authenticated USING (business_id = public.get_current_business_id());',
            v_table, v_table
        );
    END LOOP;
END $$;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions FORCE ROW LEVEL SECURITY;
REVOKE DELETE, TRUNCATE ON public.transactions FROM anon, authenticated;
CREATE POLICY transactions_select ON public.transactions FOR SELECT TO authenticated USING (business_id = public.get_current_business_id());
CREATE POLICY transactions_insert ON public.transactions FOR INSERT TO authenticated WITH CHECK (business_id = public.get_current_business_id());
CREATE POLICY transactions_update ON public.transactions FOR UPDATE TO authenticated USING (business_id = public.get_current_business_id()) WITH CHECK (business_id = public.get_current_business_id());

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations FORCE ROW LEVEL SECURITY;
REVOKE DELETE, TRUNCATE ON public.payment_allocations FROM anon, authenticated;
CREATE POLICY payment_allocations_select ON public.payment_allocations FOR SELECT TO authenticated USING (business_id = public.get_current_business_id());
CREATE POLICY payment_allocations_insert ON public.payment_allocations FOR INSERT TO authenticated WITH CHECK (business_id = public.get_current_business_id());
CREATE POLICY payment_allocations_update ON public.payment_allocations FOR UPDATE TO authenticated USING (business_id = public.get_current_business_id()) WITH CHECK (business_id = public.get_current_business_id());

ALTER TABLE public.activity_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_records FORCE ROW LEVEL SECURITY;
CREATE POLICY activity_records_select ON public.activity_records
    FOR SELECT TO authenticated
    USING (business_id = public.get_current_business_id());

ALTER TABLE public.transactional_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactional_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY transactional_outbox_select ON public.transactional_outbox
    FOR SELECT TO authenticated
    USING (business_id = public.get_current_business_id());

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('company_vault', 'company_vault', FALSE, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY vault_storage_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'company_vault' AND (storage.foldername(name))[1]::UUID = public.get_current_business_id());

CREATE POLICY vault_storage_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'company_vault' AND (storage.foldername(name))[1]::UUID = public.get_current_business_id());

CREATE POLICY vault_storage_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'company_vault' AND (storage.foldername(name))[1]::UUID = public.get_current_business_id());
