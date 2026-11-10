-- =====================================================================================
-- Security suite: anonymous access, tenant isolation, profile takeover, column privileges,
-- financial-history deletion, activity forgery, SECURITY DEFINER access, service_role,
-- storage policies, privilege and RLS inventory. Adversarial by design.
-- =====================================================================================
SELECT qa.suite('10_security');

-- SEC-ANON: anon has no privilege on any public relation or function
DO $$
DECLARE t text; r text; bad int := 0;
BEGIN
    PERFORM qa.as_anon();
    FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') ORDER BY 1 LOOP
        r := qa.run(format('SELECT 1 FROM public.%I LIMIT 1', t));
        IF r NOT LIKE '42501%' THEN bad := bad + 1; PERFORM qa.info('SEC-ANON', 'anon read ' || t, r); END IF;
    END LOOP;
    PERFORM qa.record('SEC-ANON-01', 'anon SELECT is refused on every public table and view', bad = 0, '0 readable', bad || ' readable');
    PERFORM qa.t('SEC-ANON-02', 'anon INSERT into projects refused', $q$INSERT INTO public.projects (business_id, name) VALUES (gen_random_uuid(), 'x')$q$, '42501');
    PERFORM qa.t('SEC-ANON-03', 'anon UPDATE refused', $q$UPDATE public.transactions SET description = 'x'$q$, '42501');
    PERFORM qa.t('SEC-ANON-04', 'anon DELETE refused', $q$DELETE FROM public.contacts$q$, '42501');
    PERFORM qa.t('SEC-ANON-05', 'anon cannot call get_available_cash()', $q$SELECT public.get_available_cash()$q$, '42501');
    PERFORM qa.t('SEC-ANON-06', 'anon storage query runs but is filtered by RLS', $q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'company-vault' AND name LIKE '%'$q$, 'ok');
    PERFORM qa.v('SEC-ANON-07', 'anon sees zero vault objects', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'company-vault'$q$, '0');
    PERFORM qa.as_admin();
    PERFORM qa.v('SEC-ANON-08', 'anon holds no privilege on any public relation (catalog)',
        $q$SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
           WHERE n.nspname = 'public' AND c.relkind IN ('r','v') AND a.grantee = 'anon'::regrole$q$, '0');
    PERFORM qa.v('SEC-ANON-09', 'anon can execute no public function (catalog)',
        $q$SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')$q$, '0');
    PERFORM qa.v('SEC-ANON-10', 'PUBLIC holds no privilege on any public relation (catalog)',
        $q$SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
           WHERE n.nspname = 'public' AND c.relkind IN ('r','v','S') AND a.grantee = 0$q$, '0');
END $$;

-- SEC-TEN: founder A against business B on every tenant table
DO $$
DECLARE t text; r text; leak int := 0; bb uuid := qa.id('biz_b');
BEGIN
    PERFORM qa.as_user('a');
    FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_attribute att ON att.attrelid = c.oid AND att.attname = 'business_id'
             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') ORDER BY 1 LOOP
        r := qa.val(format('SELECT count(*)::text FROM public.%I WHERE business_id = %L', t, bb));
        IF r <> '0' THEN leak := leak + 1; PERFORM qa.info('SEC-TEN', 'A reads B ' || t, r); END IF;
    END LOOP;
    PERFORM qa.record('SEC-TEN-01', 'A reads zero rows of business B in every tenant table and view', leak = 0, '0 leaks', leak || ' leaks');
    PERFORM qa.v('SEC-TEN-02', 'A cannot see business B', format($q$SELECT count(*)::text FROM public.businesses WHERE id = %L$q$, bb), '0');
    PERFORM qa.t('SEC-TEN-03', 'A updating B project affects 0 rows', format($q$UPDATE public.projects SET name = 'pwned' WHERE id = %L$q$, qa.id('project_b')), 'ok:0');
    PERFORM qa.t('SEC-TEN-04', 'A deleting B project affects 0 rows', format($q$DELETE FROM public.projects WHERE id = %L$q$, qa.id('project_b')), 'ok:0');
    PERFORM qa.t('SEC-TEN-05', 'A inserting a row stamped with B business_id is refused',
        format($q$INSERT INTO public.projects (business_id, name) VALUES (%L, 'planted')$q$, bb), '42501');
    PERFORM qa.t('SEC-TEN-06', 'A cannot reference B account from an A transaction (composite FK)',
        format($q$INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, description) VALUES (%L, %L, '2026-05-01', 1, 'income', 'x')$q$,
               qa.id('biz_a'), qa.id('acct_b')), 'err');
    PERFORM qa.t('SEC-TEN-07', 'A cannot allocate B transaction to B commitment',
        format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 1)$q$,
               bb, qa.id('commit_b'), qa.id('tx_b')), 'err');
    PERFORM qa.v('SEC-TEN-08', 'B allocation attempt left no row and no lock leak (A still sees nothing)',
        format($q$SELECT count(*)::text FROM public.payment_allocations WHERE business_id = %L$q$, bb), '0');
    PERFORM qa.t('SEC-TEN-09', 'A cannot reverse B transaction through the RPC',
        format($q$SELECT public.reverse_transaction(%L, 'attack')$q$, qa.id('tx_b')), 'P0002');
    PERFORM qa.t('SEC-TEN-10', 'A cannot revoke B commitment through the RPC',
        format($q$SELECT public.revoke_funding_commitment(%L, 'attack')$q$, qa.id('commit_b')), 'P0002');
    PERFORM qa.as_admin();
    PERFORM qa.v('SEC-TEN-11', 'B transaction is still active after the attempts',
        format($q$SELECT is_reversed::text FROM public.transactions WHERE id = %L$q$, qa.id('tx_b')), 'false');
END $$;

-- SEC-PROF: profile takeover (Rev 2.3.3 R-1) and business identity
DO $$
DECLARE ba uuid := qa.id('biz_a');
BEGIN
    PERFORM qa.as_user('c');
    PERFORM qa.t('SEC-PROF-01', 'stranger C cannot insert a profile into business A',
        format($q$INSERT INTO public.profiles (id, business_id, full_name, email) VALUES (auth.uid(), %L, 'Intruder', 'c@x.test')$q$, ba), '42501');
    PERFORM qa.v('SEC-PROF-02', 'stranger C resolves to no business', $q$SELECT COALESCE(public.get_current_business_id()::text, 'none')$q$, 'none');
    PERFORM qa.v('SEC-PROF-03', 'stranger C sees nothing', $q$SELECT (SELECT count(*) FROM public.businesses) + (SELECT count(*) FROM public.transactions)$q$, '0');
    PERFORM qa.as_admin();

    PERFORM qa.as_user('b');
    PERFORM qa.t('SEC-PROF-04', 'founder B cannot re-point own profile to business A (column privilege)',
        format($q$UPDATE public.profiles SET business_id = %L WHERE id = auth.uid()$q$, ba), '42501');
    PERFORM qa.t('SEC-PROF-05', 'founder B cannot change own profile id', $q$UPDATE public.profiles SET id = gen_random_uuid() WHERE id = auth.uid()$q$, '42501');
    PERFORM qa.t('SEC-PROF-06', 'founder B can still edit own display settings', $q$UPDATE public.profiles SET theme = 'light' WHERE id = auth.uid()$q$, 'ok:1');
    PERFORM qa.as_admin();

    PERFORM qa.as_service();
    PERFORM qa.t('SEC-PROF-07', 'even service_role cannot move a profile to another business (trigger)',
        format($q$UPDATE public.profiles SET business_id = %L WHERE id = %L$q$, ba, qa.id('user_b')), '23514');
    PERFORM qa.t('SEC-PROF-08', 'even service_role cannot change base_currency (trigger)',
        format($q$UPDATE public.businesses SET base_currency = 'USD' WHERE id = %L$q$, ba), '23514');
    PERFORM qa.as_admin();

    PERFORM qa.as_user('a');
    PERFORM qa.t('SEC-PROF-09', 'founder cannot change base_currency (column privilege)', $q$UPDATE public.businesses SET base_currency = 'USD'$q$, '42501');
    PERFORM qa.t('SEC-PROF-10', 'founder can rename the business', $q$UPDATE public.businesses SET business_name = 'Alpha Ventures Pvt Ltd'$q$, 'ok:1');
    PERFORM qa.t('SEC-PROF-11', 'founder cannot delete the business', $q$DELETE FROM public.businesses$q$, '42501');
    PERFORM qa.as_admin();
END $$;

-- SEC-COL: protected financial columns (Rev 2.3.3 R-2, G-03, G-04)
DO $$
BEGIN
    PERFORM qa.as_user('b');
    PERFORM qa.t('SEC-COL-01', 'client cannot set revoked_at on INSERT',
        format($q$INSERT INTO public.funding_commitments (business_id, requirement_id, funder_name, committed_amount, revoked_at, revocation_reason) VALUES (%L, %L, 'f', 1, now(), 'x')$q$,
               qa.id('biz_b'), qa.id('req_b')), '42501');
    PERFORM qa.t('SEC-COL-02', 'client cannot set revoked_at by UPDATE', format($q$UPDATE public.funding_commitments SET revoked_at = now(), revocation_reason = 'x' WHERE id = %L$q$, qa.id('commit_b')), '42501');
    PERFORM qa.v('SEC-COL-03', 'commitments have no writable status column at all',
        $q$SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'funding_commitments' AND column_name = 'status'$q$, '0');
    PERFORM qa.t('SEC-COL-04', 'client cannot change a transaction amount', format($q$UPDATE public.transactions SET amount = 1 WHERE id = %L$q$, qa.id('tx_b')), '42501');
    PERFORM qa.t('SEC-COL-05', 'client cannot mark a transaction reversed directly', format($q$UPDATE public.transactions SET is_reversed = true WHERE id = %L$q$, qa.id('tx_b')), '42501');
    PERFORM qa.t('SEC-COL-06', 'client cannot insert a pre-reversed transaction',
        format($q$INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, description, is_reversed) VALUES (%L, %L, '2026-05-02', 1, 'income', 'x', true)$q$,
               qa.id('biz_b'), qa.id('acct_b')), '42501');
    PERFORM qa.t('SEC-COL-07', 'client cannot forge import provenance on a transaction',
        format($q$INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, description, import_batch_id) VALUES (%L, %L, '2026-05-02', 1, 'income', 'x', gen_random_uuid())$q$,
               qa.id('biz_b'), qa.id('acct_b')), '42501');
    PERFORM qa.t('SEC-COL-08', 'client can still edit a transaction description', format($q$UPDATE public.transactions SET description = 'Beta angel tranche 1' WHERE id = %L$q$, qa.id('tx_b')), 'ok:1');
    PERFORM qa.t('SEC-COL-09', 'setting the old GUC changes nothing: status is still derived',
        $q$SELECT set_config('app.internal_commitment_mutation', 'true', true)$q$, 'ok');
    PERFORM qa.t('SEC-COL-10', '...and revoked_at is still not client-writable with the GUC set',
        format($q$UPDATE public.funding_commitments SET revoked_at = now(), revocation_reason = 'x' WHERE id = %L$q$, qa.id('commit_b')), '42501');
    PERFORM qa.as_admin();

    PERFORM qa.as_service();
    PERFORM qa.t('SEC-COL-11', 'even service_role cannot change a transaction amount (trigger)', format($q$UPDATE public.transactions SET amount = 1 WHERE id = %L$q$, qa.id('tx_b')), '23514');
    PERFORM qa.as_admin();
END $$;

-- SEC-DEL: financial history cannot be deleted or truncated (Rev 2.3.3 G-01)
DO $$
BEGIN
    PERFORM qa.as_user('b');
    PERFORM qa.t('SEC-DEL-01', 'founder cannot DELETE transactions', $q$DELETE FROM public.transactions$q$, '42501');
    PERFORM qa.t('SEC-DEL-02', 'founder cannot DELETE payment allocations', $q$DELETE FROM public.payment_allocations$q$, '42501');
    PERFORM qa.t('SEC-DEL-03', 'founder cannot DELETE funding commitments', $q$DELETE FROM public.funding_commitments$q$, '42501');
    PERFORM qa.t('SEC-DEL-04', 'founder cannot DELETE documents', $q$DELETE FROM public.documents$q$, '42501');
    PERFORM qa.t('SEC-DEL-05', 'founder cannot TRUNCATE anything', $q$TRUNCATE public.subtasks$q$, '42501');
    PERFORM qa.as_admin();
    PERFORM qa.as_service();
    PERFORM qa.t('SEC-DEL-06', 'service_role cannot DELETE transactions', $q$DELETE FROM public.transactions$q$, '42501');
    PERFORM qa.t('SEC-DEL-07', 'service_role cannot TRUNCATE transactions', $q$TRUNCATE public.transactions CASCADE$q$, '42501');
    PERFORM qa.as_admin();
    PERFORM qa.t('SEC-DEL-08', 'even the table owner is stopped by the no-delete trigger', $q$DELETE FROM public.transactions$q$, '42501');
    PERFORM qa.t('SEC-DEL-09', 'even the table owner is stopped by the no-truncate trigger', $q$TRUNCATE public.payment_allocations$q$, '42501');
    PERFORM qa.v('SEC-DEL-10', 'every transaction is still present', $q$SELECT (count(*) >= 1)::text FROM public.transactions$q$, 'true');
END $$;

-- SEC-ACT: activity ledger is server-written only (Rev 2.3.3 R-9)
DO $$
BEGIN
    PERFORM qa.as_user('b');
    PERFORM qa.t('SEC-ACT-01', 'founder cannot forge an activity record',
        format($q$INSERT INTO public.activity_records (business_id, actor_type, event_type, entity_table, entity_id, summary) VALUES (%L, 'system', 'funding_commitments.revoked', 'funding_commitments', %L, 'forged')$q$,
               qa.id('biz_b'), qa.id('commit_b')), '42501');
    PERFORM qa.t('SEC-ACT-02', 'founder cannot edit an activity record', $q$UPDATE public.activity_records SET summary = 'x'$q$, '42501');
    PERFORM qa.t('SEC-ACT-03', 'founder cannot delete an activity record', $q$DELETE FROM public.activity_records$q$, '42501');
    PERFORM qa.t('SEC-ACT-04', 'founder cannot call the internal writer', $q$SELECT public.log_activity(gen_random_uuid(), 'x', 'x', gen_random_uuid(), 'x')$q$, '42501');
    PERFORM qa.v('SEC-ACT-05', 'trigger-written activity names the real actor',
        format($q$SELECT actor_type || '/' || (actor_id = %L)::text FROM public.activity_records WHERE entity_id = %L AND event_type = 'projects.insert'$q$, qa.id('user_b'), qa.id('project_b')), 'user/true');
    PERFORM qa.as_admin();
    PERFORM qa.as_service();
    PERFORM qa.t('SEC-ACT-06', 'service_role cannot edit or delete activity either', $q$UPDATE public.activity_records SET summary = 'x'$q$, '42501');
    PERFORM qa.as_admin();
END $$;

-- SEC-FN: SECURITY DEFINER surface and service_role semantics (Rev 2.3.3 R-10)
DO $$
BEGIN
    PERFORM qa.v('SEC-FN-01', 'authenticated can execute exactly the intended public functions',
        $q$SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')$q$,
        'commit_import_batch,create_workspace,get_account_balances,get_available_cash,get_current_business_id,reverse_payment_allocation,reverse_transaction,revoke_funding_commitment');
    PERFORM qa.v('SEC-FN-02', 'every SECURITY DEFINER function pins search_path',
        $q$SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')$q$, '0');
    PERFORM qa.v('SEC-FN-03', 'every public function pins search_path (advisor lint 0011)',
        $q$SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')$q$, '0');
    PERFORM qa.as_service();
    PERFORM qa.v('SEC-FN-04', 'service_role reads cash by naming the business',
        format($q$SELECT public.get_available_cash_for_business(%L, '2026-06-30')::text$q$, qa.id('biz_b')), '1500.00');
    PERFORM qa.t('SEC-FN-05', 'service_role cannot use the user-scoped cash RPC', $q$SELECT public.get_available_cash()$q$, '42501');
    PERFORM qa.t('SEC-FN-06', 'service_role cannot use the user reversal RPC', format($q$SELECT public.reverse_transaction(%L, 'x')$q$, qa.id('tx_b')), '42501');
    PERFORM qa.as_admin();
    PERFORM qa.as_user('a');
    PERFORM qa.t('SEC-FN-07', 'founder cannot call the service-only cash function', format($q$SELECT public.get_available_cash_for_business(%L)$q$, qa.id('biz_b')), '42501');
    PERFORM qa.as_admin();
    PERFORM qa.as_user('c');
    PERFORM qa.t('SEC-FN-08', 'a user without a workspace gets an error, not another business''s cash', $q$SELECT public.get_available_cash()$q$, '42501');
    PERFORM qa.as_admin();
END $$;

-- SEC-STO: Supabase Storage policies (database level; HTTP level is tests/http)
DO $$
DECLARE ba text := qa.id('biz_a')::text; bb text := qa.id('biz_b')::text;
BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('company-vault', bb || '/b-secret.pdf'), ('company-vault', 'not-a-uuid/x.pdf');
    PERFORM qa.as_user('a');
    PERFORM qa.t('SEC-STO-01', 'A can upload into its own folder', format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('company-vault', %L)$q$, ba || '/a-doc.pdf'), 'ok:1');
    PERFORM qa.t('SEC-STO-02', 'A cannot upload into B folder', format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('company-vault', %L)$q$, bb || '/planted.pdf'), '42501');
    PERFORM qa.v('SEC-STO-03', 'A lists only its own object despite a malformed object name', $q$SELECT string_agg(name, ',') FROM storage.objects WHERE bucket_id = 'company-vault'$q$, ba || '/a-doc.pdf');
    PERFORM qa.t('SEC-STO-04', 'A cannot overwrite (UPDATE) its own object', format($q$UPDATE storage.objects SET name = name WHERE name = %L$q$, ba || '/a-doc.pdf'), 'ok:0');
    PERFORM qa.info('SEC-STO-05a', 'A attempts to delete its own object', qa.run(format($q$DELETE FROM storage.objects WHERE name = %L$q$, ba || '/a-doc.pdf')));
    PERFORM qa.as_admin();
    PERFORM qa.v('SEC-STO-05', 'the object survives: deletion is server-only', format($q$SELECT count(*)::text FROM storage.objects WHERE name = %L$q$, ba || '/a-doc.pdf'), '1');
    PERFORM qa.as_user('a');
    PERFORM qa.t('SEC-STO-06', 'A cannot register a document outside its folder',
        format($q$INSERT INTO public.documents (business_id, title, category, storage_provider, storage_key, original_filename, mime_type, size_bytes, sha256) VALUES (%L, 't', 'Legal', 'supabase_storage', %L, 'b.pdf', 'application/pdf', 1, %L)$q$,
               ba, bb || '/b-secret.pdf', repeat('a', 64)), '23514');
    PERFORM qa.as_admin();
    PERFORM qa.v('SEC-STO-07', 'company-vault bucket is private with a 50 MB limit', $q$SELECT public::text || '/' || file_size_limit FROM storage.buckets WHERE id = 'company-vault'$q$, 'false/52428800');
END $$;

-- SEC-INV: catalog-wide invariants
DO $$
BEGIN
    PERFORM qa.v('SEC-INV-01', 'every public table has RLS enabled and forced',
        $q$SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)$q$, '0');
    PERFORM qa.v('SEC-INV-02', 'authenticated holds no TRUNCATE, TRIGGER, REFERENCES or MAINTAIN anywhere',
        $q$SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
           WHERE n.nspname = 'public' AND a.grantee = 'authenticated'::regrole AND a.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')$q$, '0');
    PERFORM qa.v('SEC-INV-03', 'service_role holds no DELETE/TRUNCATE on financial history tables',
        $q$SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
           WHERE n.nspname = 'public' AND c.relname IN ('transactions', 'payment_allocations', 'funding_commitments', 'activity_records')
             AND a.grantee = 'service_role'::regrole AND a.privilege_type IN ('DELETE', 'TRUNCATE')$q$, '0');
    PERFORM qa.v('SEC-INV-04', 'tables without a tenant policy are only the server-only settings table',
        $q$SELECT string_agg(c.relname, ',') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)$q$,
        'installation_settings');
    PERFORM qa.v('SEC-INV-05', 'default privileges stay fail-closed for future objects (no anon/authenticated grants)',
        $q$SELECT count(*)::text FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
           WHERE n.nspname = 'public' AND d.defaclrole = 'postgres'::regrole AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)$q$, '0');
    -- added after migration 8: the global default must not give PUBLIC execute on new functions
    PERFORM qa.v('SEC-INV-06', 'global default privileges give PUBLIC no EXECUTE on functions postgres creates',
        $q$SELECT (EXISTS (SELECT 1 FROM pg_default_acl d WHERE d.defaclnamespace = 0 AND d.defaclrole = 'postgres'::regrole AND d.defaclobjtype = 'f')
                AND NOT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a WHERE d.defaclnamespace = 0 AND d.defaclrole = 'postgres'::regrole
                                AND d.defaclobjtype = 'f' AND a.grantee = 0))::text$q$, 'true');
END $$;

SELECT test_id, check_name, status, expected, actual FROM qa.results WHERE suite = '10_security' ORDER BY seq;
