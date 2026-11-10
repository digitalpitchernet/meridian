-- Handover Section 3: the six outstanding concerns, each probed against the Rev 2.2 SQL as written.
-- "PASS" means the database already protects the invariant; "FAIL" means the concern is confirmed.

-- C1: structure-level vs capital-target-level allocation
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a'); cs UUID; t1 UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.capital_structures (business_id, agreed_capital_target, currency) VALUES (ba, 1000000, 'INR') RETURNING id INTO cs;
        BEGIN
            INSERT INTO public.capital_targets (business_id, structure_id, name, target_amount, currency, phase)
                VALUES (ba, cs, 'Seed tranche', 200000, 'INR', 'seed') RETURNING id INTO t1;
            r := r || qa.r('C1', 'capital_targets accepts an insert (shared trigger function)', TRUE, NULL);
        EXCEPTION WHEN OTHERS THEN
            r := r || qa.r('C1', 'capital_targets accepts an insert (shared trigger function)', FALSE, SQLSTATE || ' ' || SQLERRM);
        END;
        IF t1 IS NOT NULL THEN
            s := qa.try(format($q$INSERT INTO public.participant_capital_allocations (business_id, structure_id, capital_target_id, participant_id, allocated_amount, currency) VALUES (%L, %L, %L, %L, 300000, 'INR')$q$, ba, cs, t1, qa.id('part_a1')));
            r := r || qa.r('C1', '300000 allocated against a 200000 target', NULL, s);
            s := qa.val(format($q$SELECT allocation_status || '/' || total_participant_allocated FROM public.vw_capital_structure_allocation_summary WHERE structure_id = %L$q$, cs));
            r := r || qa.r('C1', 'summary surfaces the target-level over-allocation', s NOT LIKE 'under_allocated%', 'view says ' || s || '; no per-target row exists');
            s := qa.try(format($q$INSERT INTO public.capital_targets (business_id, structure_id, name, target_amount, currency, phase) VALUES (%L, %L, 'Series A', 900000, 'INR', 'a')$q$, ba, cs));
            r := r || qa.r('C1', 'sum of capital targets (1.1M) exceeding structure target (1.0M) is detected', s NOT LIKE 'OK%', s || ' (no check, no view column)');
        END IF;
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    END;
    PERFORM qa.flush(r);
END $$;

-- C2: parent currency changes
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a'); cs UUID; rq UUID; acct UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.capital_structures (business_id, agreed_capital_target, currency) VALUES (ba, 1000, 'INR') RETURNING id INTO cs;
        INSERT INTO public.participant_capital_allocations (business_id, structure_id, participant_id, allocated_amount, currency) VALUES (ba, cs, qa.id('part_a1'), 500, 'INR');
        s := qa.try(format($q$UPDATE public.capital_structures SET currency = 'USD' WHERE id = %L$q$, cs));
        r := r || qa.r('C2', 'capital_structures INR->USD with INR allocations is blocked', s NOT LIKE 'OK 1', s);

        INSERT INTO public.funding_requirements (business_id, title, target_amount, currency) VALUES (ba, 'R', 1000, 'INR') RETURNING id INTO rq;
        INSERT INTO public.funding_commitments (business_id, requirement_id, funder_name, committed_amount, currency) VALUES (ba, rq, 'F', 1000, 'INR');
        s := qa.try(format($q$UPDATE public.funding_requirements SET currency = 'USD' WHERE id = %L$q$, rq));
        r := r || qa.r('C2', 'funding_requirements INR->USD with INR commitments is blocked', s NOT LIKE 'OK 1', s);

        INSERT INTO public.financial_accounts (business_id, name, type, currency, opening_balance_date) VALUES (ba, 'C2 acct', 'bank', 'INR', '2026-01-01') RETURNING id INTO acct;
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description) VALUES (ba, acct, '2026-02-01', 100, 'INR', 'income', 'x');
        s := qa.try(format($q$UPDATE public.financial_accounts SET currency = 'USD', exchange_rate_to_base = 84 WHERE id = %L$q$, acct));
        r := r || qa.r('C2', 'financial_accounts INR->USD with INR transactions is blocked', s NOT LIKE 'OK 1', s);

        s := qa.try(format($q$UPDATE public.businesses SET base_currency = 'USD' WHERE id = %L$q$, ba));
        r := r || qa.r('C2', 'businesses.base_currency change with existing FX snapshots is blocked', s NOT LIKE 'OK 1', s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('C2', 'scenario setup', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

-- C3: cross-currency transfer reconciliation
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a'); eur UUID; inr UUID; c0 NUMERIC; c1 NUMERIC;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.financial_accounts (business_id, name, type, currency, opening_balance, opening_balance_date, exchange_rate_to_base)
            VALUES (ba, 'C3 EUR', 'bank', 'EUR', 5000, '2026-01-01', 90) RETURNING id INTO eur;
        INSERT INTO public.financial_accounts (business_id, name, type, currency, opening_balance_date)
            VALUES (ba, 'C3 INR', 'bank', 'INR', '2026-01-01') RETURNING id INTO inr;
        c0 := qa.available_cash(ba);
        s := qa.try(format($q$INSERT INTO public.transactions (business_id, account_id, transfer_to_account_id, date, amount, currency, exchange_rate_to_base, transfer_to_amount, type, description)
              VALUES (%L, %L, %L, '2026-03-05', 1000, 'EUR', 90, 50000, 'transfer', 'inconsistent legs')$q$, ba, eur, inr));
        r := r || qa.r('C3', 'transfer whose INR leg (50000) disagrees with EUR leg at 90 (90000) is rejected', s NOT LIKE 'OK%', s);
        IF s LIKE 'OK%' THEN
            c1 := qa.available_cash(ba);
            r := r || qa.r('C3', 'INR account: native balance vs base value', qa.native_balance(inr) = qa.base_value(inr),
                'native ' || qa.native_balance(inr) || ' INR but counted as ' || qa.base_value(inr) || ' INR in available cash');
            r := r || qa.r('C3', 'sum of native balances in base equals available cash', NULL,
                'available cash ' || c1 || ' vs native-derived ' || (qa.native_balance(eur) * 90 + qa.native_balance(inr)));
        END IF;
        s := qa.try(format($q$INSERT INTO public.transactions (business_id, account_id, transfer_to_account_id, date, amount, currency, exchange_rate_to_base, transfer_to_amount, type, description)
              VALUES (%L, %L, %L, '2026-03-06', 100, 'EUR', 1, 9000, 'transfer', 'non-base source at rate 1')$q$, ba, eur, inr));
        r := r || qa.r('C3', 'non-base-currency transaction with exchange_rate_to_base = 1 (default) is rejected', s NOT LIKE 'OK%', s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('C3', 'scenario setup', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

-- C4: CSV overwrite target validation
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a'); acct UUID := qa.id('acct_a_inr'); other UUID; tx_other UUID; tx_rev UUID; tx_tr UUID; tx_same UUID;
    b UUID; i INT := 0; tgt UUID; first_target UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.financial_accounts (business_id, name, type, currency, opening_balance_date) VALUES (ba, 'C4 other INR', 'bank', 'INR', '2026-01-01') RETURNING id INTO other;
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description) VALUES (ba, other, '2026-04-01', 100, 'INR', 'expense', 'on other account') RETURNING id INTO tx_other;
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description, is_reversed) VALUES (ba, acct, '2026-04-01', 100, 'INR', 'expense', 'already reversed', TRUE) RETURNING id INTO tx_rev;
        INSERT INTO public.transactions (business_id, account_id, transfer_to_account_id, date, amount, currency, transfer_to_amount, type, description) VALUES (ba, acct, other, '2026-04-01', 100, 'INR', 100, 'transfer', 'a transfer') RETURNING id INTO tx_tr;
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description) VALUES (ba, acct, '2026-04-01', 100, 'INR', 'expense', 'targeted twice') RETURNING id INTO tx_same;
        first_target := tx_other;

        INSERT INTO public.import_batches (business_id, account_id, filename, file_checksum_sha256) VALUES (ba, acct, 'c4.csv', repeat('9', 64)) RETURNING id INTO b;
        FOREACH tgt IN ARRAY ARRAY[tx_other, tx_rev, tx_tr, tx_same, tx_same] LOOP
            INSERT INTO public.import_batch_rows (business_id, batch_id, raw_row_index, fingerprint, parsed_payload, has_potential_duplicate, target_overwrite_transaction_id, resolution)
                VALUES (ba, b, i, repeat(i::text, 64), format('{"date":"2026-04-01","amount":"100.00","type":"expense","description":"row %s"}', i)::jsonb, TRUE, tgt, 'overwrite');
            i := i + 1;
        END LOOP;
        s := qa.try(format('SELECT public.commit_import_batch(%L)', b));
        r := r || qa.r('C4', 'batch overwriting (other account, already-reversed, transfer, same target twice) is rejected', s NOT LIKE 'OK%', s);
        IF s LIKE 'OK%' THEN
            s := qa.val(format($q$SELECT string_agg(t.description || '=reversed:' || t.is_reversed || ',replacements:' || (SELECT count(*) FROM public.transactions n WHERE n.reversal_of_id = t.id), ' ; ' ORDER BY t.description)
                  FROM public.transactions t WHERE t.id IN (%L, %L, %L, %L)$q$, first_target, tx_rev, tx_tr, tx_same));
            r := r || qa.r('C4', 'what the commit actually did', NULL, s);
            s := qa.val(format($q$SELECT count(*)::text FROM public.transactions WHERE import_batch_id = %L AND NOT is_reversed$q$, b));
            r := r || qa.r('C4', 'active replacement transactions created on the batch account', NULL, s || ' (5 rows, 4 distinct targets)');
        END IF;
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('C4', 'scenario setup', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

-- C5: outbox recovery after a worker dies mid-batch
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a'); n1 INT; n2 INT; ob UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.projects (business_id, name) VALUES (ba, 'C5 outbox probe');
        PERFORM qa.logout();
        UPDATE public.transactional_outbox SET status = 'dispatched' WHERE status IN ('pending', 'failed');
        UPDATE public.transactional_outbox o SET status = 'pending' FROM public.activity_records a
            WHERE a.id = o.activity_record_id AND a.summary LIKE '%C5 outbox probe%';

        PERFORM qa.login_service();
        SELECT count(*), max(id::text)::uuid INTO n1, ob FROM public.claim_outbox_batch(10);
        PERFORM qa.logout();
        r := r || qa.r('C5', 'service_role claims the pending item', n1 = 1, n1 || ' claimed');
        -- worker crashes here: no complete_outbox_item call; even a day later the row stays 'processing'
        UPDATE public.transactional_outbox SET available_at = now() - interval '1 day' WHERE id = ob;
        PERFORM qa.login_service();
        SELECT count(*) INTO n2 FROM public.claim_outbox_batch(10);
        PERFORM qa.logout();
        r := r || qa.r('C5', 'abandoned processing item is reclaimable after a lease timeout', n2 = 1,
            n2 || ' reclaimed; status=' || (SELECT status FROM public.transactional_outbox WHERE id = ob) || '; no lease/claimed_at column exists');

        UPDATE public.transactional_outbox SET status = 'dispatched' WHERE id = ob;
        PERFORM qa.login_service();
        PERFORM public.complete_outbox_item(ob, FALSE, 'late failure report');
        PERFORM qa.logout();
        s := (SELECT status FROM public.transactional_outbox WHERE id = ob);
        r := r || qa.r('C5', 'late failure report cannot reopen a dispatched item', s = 'dispatched', 'status=' || s);

        UPDATE public.transactional_outbox SET status = 'processing', attempts = 4 WHERE id = ob;
        PERFORM qa.login_service();
        PERFORM public.complete_outbox_item(ob, FALSE, 'fifth failure');
        PERFORM qa.logout();
        s := (SELECT status || '/attempts=' || attempts FROM public.transactional_outbox WHERE id = ob);
        r := r || qa.r('C5', 'failure at attempts=4 stays retryable (informational)', NULL, s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('C5', 'scenario setup', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

SELECT test_id, check_name, status, left(detail, 220) AS detail FROM qa.results
WHERE test_id LIKE 'C%' ORDER BY seq;
