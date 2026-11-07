-- Patch verification: re-runs every failed case against R23-candidate.patches.sql, plus a regression
-- subset of the passing spec tests. All scenarios run as the founders through RLS in rolled-back sandboxes.

DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a'); acct UUID := qa.id('acct_a_inr');
    cs UUID; cs2 UUID; t1 UUID; rq UUID; cm UUID; a UUID; eur UUID; usd UUID; tx UUID; tx2 UUID; other UUID; b UUID; i INT;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));

        -- PV-01 / PV-02 capital targets
        INSERT INTO public.capital_structures (business_id, agreed_capital_target, currency) VALUES (ba, 1000000, 'INR') RETURNING id INTO cs;
        s := qa.try(format($q$INSERT INTO public.capital_targets (business_id, structure_id, name, target_amount, currency, phase) VALUES (%L, %L, 'Seed', 200000, 'INR', 'seed')$q$, ba, cs));
        r := r || qa.r('PV-01', 'capital_targets insert works', s = 'OK 1', s);
        SELECT id INTO t1 FROM public.capital_targets WHERE structure_id = cs;
        s := qa.try(format($q$INSERT INTO public.participant_capital_allocations (business_id, structure_id, capital_target_id, participant_id, allocated_amount, currency) VALUES (%L, %L, %L, %L, 300000, 'INR')$q$, ba, cs, t1, qa.id('part_a1')));
        r := r || qa.r('PV-01', 'allocation against a capital target works', s = 'OK 1', s);
        s := qa.val(format($q$SELECT allocation_status || '/' || over_allocated_amount FROM public.vw_capital_target_allocation_summary WHERE capital_target_id = %L$q$, t1));
        r := r || qa.r('PV-02', 'target-level view flags 300000 vs 200000 target', s = 'over_allocated/100000.00', s);
        s := qa.try(format($q$INSERT INTO public.capital_targets (business_id, structure_id, name, target_amount, currency, phase) VALUES (%L, %L, 'Series A', 900000, 'INR', 'a')$q$, ba, cs));
        s := qa.val(format($q$SELECT allocation_status || '/' || over_allocated_target_count || '/' || total_capital_targets || '/' || targets_exceed_structure_by FROM public.vw_capital_structure_allocation_summary WHERE structure_id = %L$q$, cs));
        r := r || qa.r('PV-02', 'structure view: under-allocated overall, 1 target over, targets exceed structure by 100000', s = 'under_allocated/1/1100000.00/100000.00', s);

        -- PV-03 parent currency freeze
        s := qa.try(format($q$UPDATE public.capital_structures SET currency = 'USD' WHERE id = %L$q$, cs));
        r := r || qa.r('PV-03', 'capital_structures currency frozen once children exist', s LIKE '23514%', s);
        INSERT INTO public.capital_structures (business_id, agreed_capital_target, currency) VALUES (ba, 1, 'INR') RETURNING id INTO cs2;
        s := qa.try(format($q$UPDATE public.capital_structures SET currency = 'USD' WHERE id = %L$q$, cs2));
        r := r || qa.r('PV-03', 'childless capital_structure can still change currency', s = 'OK 1', s);
        INSERT INTO public.funding_requirements (business_id, title, target_amount, currency) VALUES (ba, 'R', 10000, 'INR') RETURNING id INTO rq;
        INSERT INTO public.funding_commitments (business_id, requirement_id, funder_name, committed_amount, currency) VALUES (ba, rq, 'F', 10000, 'INR') RETURNING id INTO cm;
        s := qa.try(format($q$UPDATE public.funding_requirements SET currency = 'USD' WHERE id = %L$q$, rq));
        r := r || qa.r('PV-03', 'funding_requirements currency frozen once commitments exist', s LIKE '23514%', s);
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description) VALUES (ba, acct, '2026-06-01', 10000, 'INR', 'income', 'PV income') RETURNING id INTO tx;
        s := qa.try(format($q$UPDATE public.financial_accounts SET currency = 'USD', exchange_rate_to_base = 84 WHERE id = %L$q$, acct));
        r := r || qa.r('PV-03', 'financial_accounts currency frozen once transactions exist', s LIKE '23514%', s);
        s := qa.try(format($q$UPDATE public.businesses SET base_currency = 'USD' WHERE id = %L$q$, ba));
        r := r || qa.r('PV-03', 'businesses.base_currency frozen once accounts/transactions exist', s LIKE '23514%', s);

        -- PV-04 transfer reconciliation
        INSERT INTO public.financial_accounts (business_id, name, type, currency, opening_balance, opening_balance_date, exchange_rate_to_base)
            VALUES (ba, 'PV EUR', 'bank', 'EUR', 5000, '2026-01-01', 90) RETURNING id INTO eur;
        s := qa.try(format($q$INSERT INTO public.transactions (business_id, account_id, transfer_to_account_id, date, amount, currency, exchange_rate_to_base, transfer_to_amount, type, description) VALUES (%L, %L, %L, '2026-06-02', 1000, 'EUR', 90, 50000, 'transfer', 'bad legs')$q$, ba, eur, acct));
        r := r || qa.r('PV-04', 'EUR->INR transfer with disagreeing legs rejected', s LIKE '23514%', s);
        s := qa.try(format($q$INSERT INTO public.transactions (business_id, account_id, transfer_to_account_id, date, amount, currency, exchange_rate_to_base, transfer_to_amount, type, description) VALUES (%L, %L, %L, '2026-06-02', 1000, 'EUR', 90, 90000, 'transfer', 'good legs')$q$, ba, eur, acct));
        r := r || qa.r('PV-04', 'EUR->INR transfer with reconciled legs accepted (FIN-04a regression)', s = 'OK 1', s);
        s := qa.try(format($q$INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description) VALUES (%L, %L, '2026-06-02', 10, 'EUR', 'expense', 'rate left at default')$q$, ba, eur));
        r := r || qa.r('PV-04', 'non-base transaction left at default rate 1 rejected', s LIKE '23514%', s);

        -- PV-05 transaction history protection
        INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, transaction_amount, amount, currency) VALUES (ba, cm, tx, 10000, 10000, 'INR') RETURNING id INTO a;
        s := qa.val(format('SELECT status FROM public.funding_commitments WHERE id = %L', cm));
        r := r || qa.r('PV-REG', 'allocation still drives commitment status (FIN-01 regression)', s = 'fulfilled', s);
        s := qa.try(format('UPDATE public.transactions SET amount = 5000 WHERE id = %L', tx));
        r := r || qa.r('PV-05', 'shrinking an allocated transaction rejected (X1)', s LIKE '23514%', s);
        s := qa.try(format($q$UPDATE public.transactions SET type = 'expense' WHERE id = %L$q$, tx));
        r := r || qa.r('PV-05', 'retyping an allocated transaction rejected (X5)', s LIKE '23514%', s);
        s := qa.try(format($q$UPDATE public.transactions SET description = 'renamed' WHERE id = %L$q$, tx));
        r := r || qa.r('PV-05', 'non-financial edit (description) still allowed', s = 'OK 1', s);
        s := qa.try(format('UPDATE public.transactions SET is_reversed = TRUE WHERE id = %L', tx));
        r := r || qa.r('PV-REG', 'reversal still allowed and cascades (FIN-03 regression)', s = 'OK 1', s);
        s := qa.val(format($q$SELECT (SELECT is_reversed FROM public.payment_allocations WHERE id = %L) || '/' || (SELECT status FROM public.funding_commitments WHERE id = %L)$q$, a, cm));
        r := r || qa.r('PV-REG', 'cascade reversed allocation and commitment back to pledged', s = 'true/pledged', s);
        s := qa.try(format('UPDATE public.transactions SET is_reversed = FALSE WHERE id = %L', tx));
        r := r || qa.r('PV-05', 'un-reversing rejected (X2)', s LIKE '23514%', s);

        -- PV-06 derived commitment status
        s := qa.try(format($q$UPDATE public.funding_commitments SET status = 'fulfilled' WHERE id = %L$q$, cm));
        s := s || ' -> ' || qa.val(format('SELECT status FROM public.funding_commitments WHERE id = %L', cm));
        r := r || qa.r('PV-06', 'manual status edit is overridden by derived status (X3)', s LIKE '%-> pledged', s);
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description) VALUES (ba, acct, '2026-06-03', 6000, 'INR', 'income', 'PV income 2') RETURNING id INTO tx2;
        INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, transaction_amount, amount, currency) VALUES (ba, cm, tx2, 6000, 6000, 'INR');
        s := qa.try(format('UPDATE public.funding_commitments SET committed_amount = 6000 WHERE id = %L', cm));
        s := s || ' -> ' || qa.val(format('SELECT status FROM public.funding_commitments WHERE id = %L', cm));
        r := r || qa.r('PV-06', 'lowering committed_amount re-derives status (X4)', s LIKE '%-> fulfilled', s);
        s := qa.try(format($q$UPDATE public.funding_commitments SET status = 'revoked' WHERE id = %L$q$, cm));
        s := s || ' -> ' || qa.val(format('SELECT status FROM public.funding_commitments WHERE id = %L', cm));
        r := r || qa.r('PV-06', 'revoke is still possible', s LIKE '%-> revoked', s);

        -- PV-06b reimbursement default
        INSERT INTO public.transactions (business_id, account_id, participant_id, date, amount, currency, type, description, contribution_type, is_personal_founder_payment)
            VALUES (ba, NULL, qa.id('part_a1'), '2026-06-04', 1200, 'INR', 'expense', 'PV personal', 'reimbursable_expense', TRUE) RETURNING id INTO tx;
        s := qa.val(format('SELECT reimbursement_status FROM public.transactions WHERE id = %L', tx));
        r := r || qa.r('PV-06b', 'reimbursable founder expense starts pending (FIN-06x)', s = 'pending', s);

        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('PV', 'sandbox 1 aborted', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

-- PV-07 CSV overwrite validation: each bad target alone must abort; a good overwrite must still work
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a'); acct UUID := qa.id('acct_a_inr'); other UUID;
    t_other UUID; t_rev UUID; t_tr UUID; t_same UUID; t_ok UUID; b UUID; lbl TEXT; tgt UUID[]; k INT;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.financial_accounts (business_id, name, type, currency, opening_balance_date) VALUES (ba, 'PV other', 'bank', 'INR', '2026-01-01') RETURNING id INTO other;
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description) VALUES (ba, other, '2026-04-01', 100, 'INR', 'expense', 'other account') RETURNING id INTO t_other;
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description) VALUES (ba, acct, '2026-04-01', 100, 'INR', 'expense', 'to be reversed') RETURNING id INTO t_rev;
        UPDATE public.transactions SET is_reversed = TRUE WHERE id = t_rev;
        INSERT INTO public.transactions (business_id, account_id, transfer_to_account_id, date, amount, currency, transfer_to_amount, type, description) VALUES (ba, acct, other, '2026-04-01', 100, 'INR', 100, 'transfer', 'a transfer') RETURNING id INTO t_tr;
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description) VALUES (ba, acct, '2026-04-01', 100, 'INR', 'expense', 'twice') RETURNING id INTO t_same;
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description) VALUES (ba, acct, '2026-04-01', 100, 'INR', 'expense', 'good target') RETURNING id INTO t_ok;

        FOR k IN 1..5 LOOP
            lbl := (ARRAY['other account', 'already reversed', 'transfer', 'same target twice', 'valid overwrite'])[k];
            tgt := (ARRAY[ARRAY[t_other, NULL], ARRAY[t_rev, NULL], ARRAY[t_tr, NULL], ARRAY[t_same, t_same], ARRAY[t_ok, NULL]])[k:k];
            INSERT INTO public.import_batches (business_id, account_id, filename, file_checksum_sha256) VALUES (ba, acct, lbl || '.csv', repeat(k::text, 64)) RETURNING id INTO b;
            INSERT INTO public.import_batch_rows (business_id, batch_id, raw_row_index, fingerprint, parsed_payload, has_potential_duplicate, target_overwrite_transaction_id, resolution)
                VALUES (ba, b, 0, repeat('a', 64), '{"date":"2026-04-01","amount":"100.00","type":"expense","description":"r0"}', TRUE, tgt[1][1], 'overwrite');
            IF tgt[1][2] IS NOT NULL THEN
                INSERT INTO public.import_batch_rows (business_id, batch_id, raw_row_index, fingerprint, parsed_payload, has_potential_duplicate, target_overwrite_transaction_id, resolution)
                    VALUES (ba, b, 1, repeat('b', 64), '{"date":"2026-04-01","amount":"100.00","type":"expense","description":"r1"}', TRUE, tgt[1][2], 'overwrite');
            END IF;
            s := qa.try(format('SELECT public.commit_import_batch(%L)', b));
            IF k < 5 THEN
                r := r || qa.r('PV-07', 'overwrite rejected: ' || lbl, s NOT LIKE 'OK%', s);
            ELSE
                r := r || qa.r('PV-07', 'valid overwrite still commits (FIN-08 regression)', s = 'OK 1', s);
                s := qa.val(format('SELECT is_reversed::text FROM public.transactions WHERE id = %L', t_ok));
                r := r || qa.r('PV-07', 'valid overwrite target reversed', s = 'true', s);
            END IF;
        END LOOP;
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('PV-07', 'sandbox aborted', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

-- PV-08 outbox lease recovery
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; n INT; ob UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.projects (business_id, name) VALUES (qa.id('biz_a'), 'PV outbox probe');
        PERFORM qa.logout();
        UPDATE public.transactional_outbox SET status = 'dispatched' WHERE status IN ('pending', 'failed', 'processing');
        UPDATE public.transactional_outbox o SET status = 'pending' FROM public.activity_records a
            WHERE a.id = o.activity_record_id AND a.summary LIKE '%PV outbox probe%';
        PERFORM qa.login_service();
        SELECT count(*), max(id::text)::uuid INTO n, ob FROM public.claim_outbox_batch(10);
        PERFORM qa.logout();
        r := r || qa.r('PV-08', 'claim takes the item with a lease', n = 1, n || ' claimed, lease until ' || (SELECT to_char(available_at - now(), 'MI:SS') FROM public.transactional_outbox WHERE id = ob));
        PERFORM qa.login_service();
        SELECT count(*) INTO n FROM public.claim_outbox_batch(10);
        PERFORM qa.logout();
        r := r || qa.r('PV-08', 'item is not double-claimed while its lease is live', n = 0, n || ' claimed');
        UPDATE public.transactional_outbox SET available_at = now() - interval '1 second' WHERE id = ob;  -- simulate worker crash + lease expiry
        PERFORM qa.login_service();
        SELECT count(*) INTO n FROM public.claim_outbox_batch(10);
        PERFORM public.complete_outbox_item(ob, TRUE);
        PERFORM public.complete_outbox_item(ob, FALSE, 'late failure');
        PERFORM qa.logout();
        r := r || qa.r('PV-08', 'expired lease is reclaimed (attempt 2)', n = 1, n || ' reclaimed; attempts=' || (SELECT attempts FROM public.transactional_outbox WHERE id = ob));
        s := (SELECT status FROM public.transactional_outbox WHERE id = ob);
        r := r || qa.r('PV-08', 'late failure report cannot reopen a dispatched item', s = 'dispatched', 'status=' || s);
        UPDATE public.transactional_outbox SET status = 'processing', attempts = 5, available_at = now() - interval '1 second' WHERE id = ob;
        PERFORM qa.login_service();
        PERFORM public.claim_outbox_batch(10);
        PERFORM qa.logout();
        s := (SELECT status FROM public.transactional_outbox WHERE id = ob);
        r := r || qa.r('PV-08', 'lease expiring on the final attempt parks the item in dead_letter', s = 'dead_letter', 'status=' || s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('PV-08', 'sandbox aborted', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

-- PV-09 privileges, PV-10 storage, PV-REG isolation regressions
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; t UUID; v UUID;
BEGIN
    BEGIN
        r := r || qa.r('PV-09', 'anon holds no privilege on any public table', NOT EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') AND pg_get_userbyid(a.grantee) = 'anon'), NULL);
        r := r || qa.r('PV-09', 'authenticated holds no TRUNCATE/TRIGGER/REFERENCES/MAINTAIN', NOT EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname = 'public' AND c.relkind = 'r'
              AND pg_get_userbyid(a.grantee) = 'authenticated' AND a.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')), NULL);
        r := r || qa.r('PV-09', 'commit_import_batch not executable by anon/PUBLIC', NOT has_function_privilege('anon', 'public.commit_import_batch(uuid)', 'EXECUTE'), NULL);

        PERFORM qa.login_anon();
        s := qa.try('UPDATE public.projects SET name = name');
        r := r || qa.r('PV-09', 'anon UPDATE now raises 42501 (SEC-01 criterion)', s LIKE '42501%', s);
        PERFORM qa.logout();

        PERFORM qa.login(qa.id('user_b'));
        INSERT INTO public.tasks (business_id, title) VALUES (qa.id('biz_b'), 'B task') RETURNING id INTO t;
        INSERT INTO public.subtasks (business_id, task_id, title) VALUES (qa.id('biz_b'), t, 'B subtask');
        PERFORM qa.logout();
        PERFORM qa.login(qa.id('user_a'));
        s := qa.try('TRUNCATE public.subtasks');
        r := r || qa.r('PV-09', 'authenticated TRUNCATE refused (SEC-09)', s LIKE '42501%', s);
        s := qa.val(format('SELECT count(*)::text FROM public.projects WHERE business_id = %L', qa.id('biz_b')));
        r := r || qa.r('PV-REG', 'A still cannot read B projects (SEC-02 regression)', s = '0', s);
        INSERT INTO public.projects (business_id, name) VALUES (qa.id('biz_a'), 'PV ledger probe') RETURNING id INTO v;
        s := qa.val(format($q$SELECT actor_type || '/' || event_type FROM public.activity_records WHERE entity_id = %L$q$, v));
        r := r || qa.r('PV-REG', 'activity trigger still writes as user (SEC-04 regression)', s = 'user/projects.insert', s);
        PERFORM qa.logout();

        INSERT INTO storage.objects (bucket_id, name) VALUES ('company_vault', qa.id('biz_a') || '/a.pdf');
        INSERT INTO storage.objects (bucket_id, name) VALUES ('company_vault', qa.id('biz_b') || '/b.pdf');
        INSERT INTO storage.objects (bucket_id, name) VALUES ('company_vault', 'not-a-uuid/c.pdf');
        PERFORM qa.login(qa.id('user_a'));
        s := qa.val($q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'company_vault'$q$);
        r := r || qa.r('PV-10', 'A lists only its own vault folder despite a non-UUID path', s = '1', s);
        s := qa.try(format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('company_vault', %L)$q$, qa.id('biz_b') || '/planted.pdf'));
        r := r || qa.r('PV-10', 'A still cannot upload into B folder', s LIKE '42501%', s);
        PERFORM qa.logout();
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('PV-09', 'sandbox aborted', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

SELECT test_id, check_name, status, left(detail, 200) AS detail FROM qa.results WHERE test_id LIKE 'PV%' ORDER BY seq;
