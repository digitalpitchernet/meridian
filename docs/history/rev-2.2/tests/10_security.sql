-- Adversarial RLS, privilege, composite-FK and outbox isolation tests (spec 8.1 SEC-01..05 + extras).
-- Destructive probes run inside a sandbox block that is rolled back; results are collected first.

-- SEC-01: anon against every public table
DO $$
DECLARE t TEXT; r TEXT[] := '{}'; s_sel TEXT; s_ins TEXT; s_upd TEXT; s_del TEXT; leaks INT := 0; soft INT := 0;
BEGIN
    BEGIN
        PERFORM qa.login_anon();
        FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1 LOOP
            s_sel := qa.val(format('SELECT count(*)::text FROM public.%I', t));
            s_ins := qa.try(format('INSERT INTO public.%I DEFAULT VALUES', t));
            s_upd := qa.try(format('UPDATE public.%I SET id = id', t));
            s_del := qa.try(format('DELETE FROM public.%I', t));
            IF s_sel NOT IN ('0') AND s_sel NOT LIKE '42501%' THEN leaks := leaks + 1; END IF;
            IF s_upd NOT IN ('OK 0') AND s_upd NOT LIKE '42501%' THEN leaks := leaks + 1; END IF;
            IF s_del NOT IN ('OK 0') AND s_del NOT LIKE '42501%' THEN leaks := leaks + 1; END IF;
            IF s_ins LIKE 'OK%' THEN leaks := leaks + 1; END IF;
            IF s_upd = 'OK 0' OR s_del = 'OK 0' THEN soft := soft + 1; END IF;
            r := r || qa.r('SEC-01', 'anon on ' || t, NULL,
                'select=' || left(s_sel, 40) || ' | insert=' || left(s_ins, 40) || ' | update=' || left(s_upd, 40) || ' | delete=' || left(s_del, 40));
        END LOOP;
        s_sel := qa.val($q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'company_vault'$q$);
        r := r || qa.r('SEC-01', 'anon on storage.objects (company_vault)', s_sel IN ('0') OR s_sel LIKE '42501%', s_sel);
        r := r || qa.r('SEC-01', 'no anon data exposure or mutation on any table', leaks = 0, leaks || ' leaking operations');
        r := r || qa.r('SEC-01', 'spec criterion: every anon UPDATE/DELETE raises 42501', soft = 0,
            soft || ' tables return 0 rows silently instead of 42501 (anon still holds table privileges; RLS filters)');
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    END;
    PERFORM qa.flush(r);
END $$;

-- SEC-02: founder A against business B rows
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; t TEXT;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        FOREACH t IN ARRAY ARRAY['projects', 'funding_requirements', 'funding_commitments', 'financial_accounts', 'transactions',
                                 'activity_records', 'transactional_outbox', 'profiles'] LOOP
            s := qa.val(format('SELECT count(*)::text FROM public.%I WHERE business_id = %L', t, qa.id('biz_b')));
            r := r || qa.r('SEC-02', 'A reads B ' || t, s = '0', s);
        END LOOP;
        s := qa.val(format('SELECT count(*)::text FROM public.businesses WHERE id = %L', qa.id('biz_b')));
        r := r || qa.r('SEC-02', 'A reads B businesses row', s = '0', s);
        s := qa.try(format($q$UPDATE public.projects SET name = 'pwned' WHERE id = %L$q$, qa.id('proj_b')));
        r := r || qa.r('SEC-02', 'A updates B project', s = 'OK 0', s);
        s := qa.try(format('DELETE FROM public.projects WHERE id = %L', qa.id('proj_b')));
        r := r || qa.r('SEC-02', 'A deletes B project', s = 'OK 0', s);
        s := qa.try(format($q$UPDATE public.transactions SET amount = 1 WHERE id = %L$q$, qa.id('tx_b')));
        r := r || qa.r('SEC-02', 'A updates B transaction', s = 'OK 0', s);
        s := qa.try(format($q$UPDATE public.businesses SET business_name = 'pwned' WHERE id = %L$q$, qa.id('biz_b')));
        r := r || qa.r('SEC-02', 'A updates B business', s = 'OK 0', s);
        s := qa.try(format($q$INSERT INTO public.projects (business_id, name) VALUES (%L, 'planted')$q$, qa.id('biz_b')));
        r := r || qa.r('SEC-02', 'A inserts row stamped with B business_id', s LIKE '42501%', s);
        s := qa.try(format($q$UPDATE public.projects SET business_id = %L WHERE business_id = %L$q$, qa.id('biz_b'), qa.id('biz_a')));
        r := r || qa.r('SEC-02', 'A moves own rows into B (WITH CHECK)', s NOT LIKE 'OK%' OR s = 'OK 0', s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    END;
    PERFORM qa.flush(r);
END $$;

-- SEC-03: cross-business foreign key injection (A stamps own business_id, references B ids)
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a');
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        s := qa.try(format($q$INSERT INTO public.tasks (business_id, project_id, title) VALUES (%L, %L, 'Inject')$q$, ba, qa.id('proj_b')));
        r := r || qa.r('SEC-03', 'task -> B project', s LIKE '23503%', s);
        s := qa.try(format($q$INSERT INTO public.document_associations (business_id, document_id, project_id) VALUES (%L, %L, %L)$q$, ba, qa.id('doc_a'), qa.id('proj_b')));
        r := r || qa.r('SEC-03', 'document_association -> B project', s LIKE '23503%', s);
        s := qa.try(format($q$INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description) VALUES (%L, %L, '2026-02-01', 1, 'INR', 'income', 'x')$q$, ba, qa.id('acct_b_inr')));
        r := r || qa.r('SEC-03', 'transaction -> B account', s NOT LIKE 'OK%', s);
        s := qa.try(format($q$INSERT INTO public.funding_commitments (business_id, requirement_id, funder_name, committed_amount, currency) VALUES (%L, %L, 'x', 1, 'INR')$q$, ba, qa.id('req_b')));
        r := r || qa.r('SEC-03', 'commitment -> B requirement', s NOT LIKE 'OK%', s);
        s := qa.try(format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, transaction_amount, amount, currency) VALUES (%L, %L, %L, 1, 1, 'INR')$q$, ba, qa.id('commit_b'), qa.id('tx_b')));
        r := r || qa.r('SEC-03', 'payment_allocation -> B commitment + B transaction', s NOT LIKE 'OK%', s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    END;
    PERFORM qa.flush(r);
END $$;

-- SEC-04: direct client writes to ledger/outbox; worker functions; trigger-written activity
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; v UUID; ba UUID := qa.id('biz_a');
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        s := qa.try(format($q$INSERT INTO public.activity_records (business_id, actor_type, event_type, entity_table, entity_id, summary) VALUES (%L, 'system', 'x', 'x', gen_random_uuid(), 'forged')$q$, ba));
        r := r || qa.r('SEC-04', 'authenticated INSERT activity_records', s LIKE '42501%', s);
        s := qa.try('UPDATE public.activity_records SET summary = summary');
        r := r || qa.r('SEC-04', 'authenticated UPDATE activity_records', s LIKE '42501%', s);
        s := qa.try('DELETE FROM public.activity_records');
        r := r || qa.r('SEC-04', 'authenticated DELETE activity_records', s LIKE '42501%', s);
        s := qa.try(format($q$INSERT INTO public.transactional_outbox (business_id, activity_record_id, topic, payload, dedup_key) VALUES (%L, gen_random_uuid(), 'x', '{}', 'x')$q$, ba));
        r := r || qa.r('SEC-04', 'authenticated INSERT transactional_outbox', s LIKE '42501%', s);
        s := qa.try($q$UPDATE public.transactional_outbox SET status = 'dispatched'$q$);
        r := r || qa.r('SEC-04', 'authenticated UPDATE transactional_outbox', s LIKE '42501%', s);
        s := qa.try('DELETE FROM public.transactional_outbox');
        r := r || qa.r('SEC-04', 'authenticated DELETE transactional_outbox', s LIKE '42501%', s);
        s := qa.try('SELECT * FROM public.claim_outbox_batch(10)');
        r := r || qa.r('SEC-04', 'authenticated calls claim_outbox_batch()', s LIKE '42501%', s);
        s := qa.try(format('SELECT public.complete_outbox_item(%L, true)', gen_random_uuid()));
        r := r || qa.r('SEC-04', 'authenticated calls complete_outbox_item()', s LIKE '42501%', s);
        s := qa.try('SELECT public.record_domain_activity()');
        r := r || qa.r('SEC-04', 'authenticated calls record_domain_activity() directly', s NOT LIKE 'OK%', s);

        BEGIN
            INSERT INTO public.projects (business_id, name, status) VALUES (ba, 'Ledger probe', 'Active') RETURNING id INTO v;
            s := qa.val(format($q$SELECT actor_type || '/' || COALESCE(actor_id::text, 'null') || '/' || event_type FROM public.activity_records WHERE entity_id = %L$q$, v));
            r := r || qa.r('SEC-04', 'project insert writes activity_records via trigger', s = 'user/' || qa.id('user_a') || '/projects.insert', s);
            s := qa.val(format($q$SELECT o.status || '/' || o.topic FROM public.transactional_outbox o JOIN public.activity_records a ON a.id = o.activity_record_id WHERE a.entity_id = %L$q$, v));
            r := r || qa.r('SEC-04', 'project insert writes transactional_outbox via trigger', s = 'pending/domain.projects.insert', s);
        EXCEPTION WHEN OTHERS THEN
            r := r || qa.r('SEC-04', 'project insert under FORCE RLS writes ledger + outbox', FALSE, SQLSTATE || ' ' || SQLERRM);
        END;
        PERFORM qa.logout();

        PERFORM qa.login_anon();
        s := qa.try('SELECT * FROM public.claim_outbox_batch(10)');
        r := r || qa.r('SEC-04', 'anon calls claim_outbox_batch()', s LIKE '42501%', s);
        s := qa.try(format('SELECT public.get_current_business_id()'));
        r := r || qa.r('SEC-04', 'anon calls get_current_business_id()', s LIKE '42501%', s);
        PERFORM qa.logout();

        PERFORM qa.login_service();
        s := qa.try('SELECT * FROM public.claim_outbox_batch(1)');
        r := r || qa.r('SEC-04', 'service_role calls claim_outbox_batch()', s LIKE 'OK%', s);
        PERFORM qa.logout();
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    END;
    PERFORM qa.flush(r);
END $$;

-- SEC-05: composite FK deletion actions preserve business_id
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a');
    p UUID; m UUID; t UUID; d UUID; o UUID; ce UUID; ci UUID; fr UUID; d2 UUID; doc2 UUID; ct UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.projects (business_id, name) VALUES (ba, 'Doomed') RETURNING id INTO p;
        INSERT INTO public.milestones (business_id, project_id, title, due_date) VALUES (ba, p, 'M', '2026-12-01') RETURNING id INTO m;
        INSERT INTO public.tasks (business_id, project_id, milestone_id, title) VALUES (ba, p, m, 'T') RETURNING id INTO t;
        INSERT INTO public.decisions (business_id, project_id, title, context_background, decision_rationale) VALUES (ba, p, 'D', 'c', 'r') RETURNING id INTO d;
        INSERT INTO public.decision_options (business_id, decision_id, option_title) VALUES (ba, d, 'Opt') RETURNING id INTO o;
        UPDATE public.decisions SET selected_option_id = o WHERE id = d;
        INSERT INTO public.calendar_events (business_id, project_id, task_id, milestone_id, title, start_time, end_time)
            VALUES (ba, p, t, m, 'E', now(), now()) RETURNING id INTO ce;
        INSERT INTO public.contact_interactions (business_id, contact_id, project_id, interaction_type, summary)
            VALUES (ba, qa.id('contact_a'), p, 'Call', 'S') RETURNING id INTO ci;
        INSERT INTO public.funding_requirements (business_id, project_id, milestone_id, title, target_amount, currency)
            VALUES (ba, p, m, 'FR', 10, 'INR') RETURNING id INTO fr;

        s := qa.try(format('DELETE FROM public.decision_options WHERE id = %L', o));
        r := r || qa.r('SEC-05', 'delete selected decision_option', s = 'OK 1', s);
        s := qa.val(format($q$SELECT COALESCE(selected_option_id::text, 'null') || '/' || business_id FROM public.decisions WHERE id = %L$q$, d));
        r := r || qa.r('SEC-05', 'decision keeps business_id, selected_option_id -> NULL', s = 'null/' || ba, s);

        s := qa.try(format('DELETE FROM public.projects WHERE id = %L', p));
        r := r || qa.r('SEC-05', 'delete project with linked children', s = 'OK 1', s);
        s := qa.val(format($q$SELECT concat_ws(',',
            (SELECT COALESCE(project_id::text,'null') || ':' || COALESCE(milestone_id::text,'null') || ':' || business_id FROM public.tasks WHERE id = %L),
            (SELECT COALESCE(project_id::text,'null') || ':' || business_id FROM public.decisions WHERE id = %L),
            (SELECT COALESCE(project_id::text,'null') || ':' || COALESCE(task_id::text,'?') || ':' || COALESCE(milestone_id::text,'null') FROM public.calendar_events WHERE id = %L),
            (SELECT COALESCE(project_id::text,'null') FROM public.contact_interactions WHERE id = %L),
            (SELECT COALESCE(project_id::text,'null') || ':' || COALESCE(milestone_id::text,'null') FROM public.funding_requirements WHERE id = %L))$q$, t, d, ce, ci, fr));
        r := r || qa.r('SEC-05', 'children survive with only the optional FK nulled', s = format('null:null:%s,null:%s,null:%s:null,null,null:null', ba, ba, t), s);

        -- extra: delete a decision that owns options (two-way FK cycle)
        INSERT INTO public.decisions (business_id, title, context_background, decision_rationale) VALUES (ba, 'D2', 'c', 'r') RETURNING id INTO d2;
        INSERT INTO public.decision_options (business_id, decision_id, option_title) VALUES (ba, d2, 'Opt2') RETURNING id INTO o;
        UPDATE public.decisions SET selected_option_id = o WHERE id = d2;
        s := qa.try(format('DELETE FROM public.decisions WHERE id = %L', d2));
        r := r || qa.r('SEC-05x', 'delete decision that has a selected option (FK cycle)', s = 'OK 1', s);

        -- extra: selected_option_id pointing at another decision's option
        INSERT INTO public.decisions (business_id, title, context_background, decision_rationale) VALUES (ba, 'D3', 'c', 'r') RETURNING id INTO d2;
        INSERT INTO public.decision_options (business_id, decision_id, option_title) VALUES (ba, d, 'Other decision option') RETURNING id INTO o;
        s := qa.try(format('UPDATE public.decisions SET selected_option_id = %L WHERE id = %L', o, d2));
        r := r || qa.r('SEC-05x', 'cannot select an option that belongs to another decision', s NOT LIKE 'OK 1', s);

        -- extra: document version parent deletion
        INSERT INTO public.documents (business_id, parent_document_id, version_number, title, file_path, file_size_bytes, mime_type, storage_provider, category)
            VALUES (ba, qa.id('doc_a'), 2, 'v2', 'x/v2.pdf', 1, 'application/pdf', 'supabase', 'Legal') RETURNING id INTO doc2;
        s := qa.try(format('DELETE FROM public.documents WHERE id = %L', qa.id('doc_a')));
        r := r || qa.r('SEC-05x', 'delete parent document version', s = 'OK 1', s);
        s := qa.val(format($q$SELECT COALESCE(parent_document_id::text, 'null') FROM public.documents WHERE id = %L$q$, doc2));
        r := r || qa.r('SEC-05x', 'child document keeps business_id, parent -> NULL', s = 'null', s);

        -- extra: capital target with allocations is protected (RESTRICT)
        INSERT INTO public.capital_structures (business_id, agreed_capital_target, currency) VALUES (ba, 100, 'INR') RETURNING id INTO p;
        s := qa.try(format($q$INSERT INTO public.capital_targets (business_id, structure_id, name, target_amount, currency, phase) VALUES (%L, %L, 'T1', 50, 'INR', 'seed')$q$, ba, p));
        r := r || qa.r('SEC-05x', 'insert capital_target (shared currency trigger)', s LIKE 'OK%', s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    END;
    PERFORM qa.flush(r);
END $$;

-- SEC-07: storage policy behaviour with non-UUID object paths in other buckets
DO $$
DECLARE r TEXT[] := '{}'; s TEXT;
BEGIN
    BEGIN
        INSERT INTO storage.buckets (id, name, public) VALUES ('qa_other', 'qa_other', FALSE) ON CONFLICT DO NOTHING;
        INSERT INTO storage.objects (bucket_id, name) VALUES ('qa_other', 'avatars/me.png');
        INSERT INTO storage.objects (bucket_id, name) VALUES ('company_vault', qa.id('biz_a') || '/a.pdf');
        INSERT INTO storage.objects (bucket_id, name) VALUES ('company_vault', qa.id('biz_b') || '/b.pdf');
        INSERT INTO storage.objects (bucket_id, name) VALUES ('company_vault', 'not-a-uuid/c.pdf');
        PERFORM qa.login(qa.id('user_a'));
        s := qa.val($q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'company_vault'$q$);
        r := r || qa.r('SEC-07', 'A lists company_vault (expects only own folder = 1)', s = '1', s);
        s := qa.val($q$SELECT count(*)::text FROM storage.objects$q$);
        r := r || qa.r('SEC-07', 'A lists storage.objects across buckets without cast error', s NOT LIKE '22P02%', s);
        s := qa.try(format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('company_vault', %L)$q$, qa.id('biz_b') || '/planted.pdf'));
        r := r || qa.r('SEC-07', 'A uploads into B vault folder', s NOT LIKE 'OK%', s);
        PERFORM qa.logout();
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('SEC-07', 'storage probe setup', NULL, 'not executable here: ' || SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

-- SEC-08: privilege inventory (concern 6) -- actual grants, not the spec's description
DO $$
DECLARE r TEXT[] := '{}'; rec RECORD;
BEGIN
    FOR rec IN
        SELECT c.relname,
               string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type, ' ') AS grants
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
        WHERE n.nspname = 'public' AND c.relname IN ('activity_records', 'transactional_outbox', 'transactions', 'payment_allocations', 'businesses', 'profiles')
          AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
        GROUP BY c.relname ORDER BY 1
    LOOP
        r := r || qa.r('SEC-08', 'table grants: ' || rec.relname, NULL, rec.grants);
    END LOOP;
    r := r || qa.r('SEC-08', 'no PUBLIC table grants in schema public', NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname = 'public' AND a.grantee = 0), NULL);
    r := r || qa.r('SEC-08', 'anon holds no INSERT/UPDATE/DELETE/TRUNCATE on any public table', NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
          AND pg_get_userbyid(a.grantee) = 'anon' AND a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
        (SELECT count(DISTINCT c.relname) || ' relations' FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
           AND pg_get_userbyid(a.grantee) = 'anon' AND a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')));
    r := r || qa.r('SEC-08', 'authenticated holds no TRUNCATE on any public table (TRUNCATE bypasses RLS)', NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated') AND a.privilege_type = 'TRUNCATE'),
        (SELECT string_agg(DISTINCT c.relname, ',') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND pg_get_userbyid(a.grantee) = 'authenticated' AND a.privilege_type = 'TRUNCATE'));
    FOR rec IN
        SELECT p.oid::regprocedure::TEXT AS fn, pg_get_userbyid(p.proowner) AS owner, p.prosecdef,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
               EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS public_x
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (p.prosecdef OR p.prorettype <> 'trigger'::regtype) ORDER BY 1
    LOOP
        r := r || qa.r('SEC-08', 'function ' || rec.fn, NULL,
            'owner=' || rec.owner || ' secdef=' || rec.prosecdef || ' PUBLIC=' || rec.public_x || ' anon=' || rec.anon_x || ' authenticated=' || rec.auth_x);
    END LOOP;
    r := r || qa.r('SEC-08', 'role postgres / service_role', NULL,
        (SELECT string_agg(rolname || ' superuser=' || rolsuper || ' bypassrls=' || rolbypassrls, '; ') FROM pg_roles WHERE rolname IN ('postgres', 'service_role')));
    r := r || qa.r('SEC-08', 'tables with RLS enabled+forced / total', NULL,
        (SELECT sum((relrowsecurity AND relforcerowsecurity)::int) || '/' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'));
    PERFORM qa.flush(r);
END $$;

-- SEC-09: TRUNCATE is not governed by RLS; test on a table with no protected dependents
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; t UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_b'));
        INSERT INTO public.tasks (business_id, title) VALUES (qa.id('biz_b'), 'B task') RETURNING id INTO t;
        INSERT INTO public.subtasks (business_id, task_id, title) VALUES (qa.id('biz_b'), t, 'B subtask');
        PERFORM qa.logout();
        PERFORM qa.login(qa.id('user_a'));
        s := qa.try('TRUNCATE public.subtasks');
        r := r || qa.r('SEC-09', 'founder A runs TRUNCATE public.subtasks as authenticated', s NOT LIKE 'OK%', s);
        PERFORM qa.logout();
        s := qa.val(format('SELECT count(*)::text FROM public.subtasks WHERE business_id = %L', qa.id('biz_b')));
        r := r || qa.r('SEC-09', 'business B subtasks survive A''s TRUNCATE', s <> '0', 'B subtasks remaining = ' || s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    END;
    PERFORM qa.flush(r);
END $$;

SELECT test_id, check_name, status, left(detail, 200) AS detail FROM qa.results
WHERE test_id LIKE 'SEC%' ORDER BY seq;
