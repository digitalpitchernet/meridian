-- Financial invariant tests (spec 8.2 FIN-01, 03..08) plus extra integrity probes (FIN-X*).
-- Every test runs as founder A through RLS inside its own rolled-back sandbox. FIN-02 needs two
-- sessions and lives in fin02_session1.sql / fin02_session2.sql.

-- FIN-01 + FIN-03
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a'); acct UUID := qa.id('acct_a_inr');
    rq UUID; ca UUID; cb UUID; t1 UUID; t2 UUID; a2 UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.funding_requirements (business_id, title, target_amount, currency) VALUES (ba, 'Seed', 30000, 'INR') RETURNING id INTO rq;
        INSERT INTO public.funding_commitments (business_id, requirement_id, participant_id, funder_name, committed_amount, currency)
            VALUES (ba, rq, qa.id('part_a1'), 'Founder A', 20000, 'INR') RETURNING id INTO ca;
        INSERT INTO public.funding_commitments (business_id, requirement_id, participant_id, funder_name, committed_amount, currency)
            VALUES (ba, rq, qa.id('part_a2'), 'Founder B', 10000, 'INR') RETURNING id INTO cb;
        INSERT INTO public.transactions (business_id, account_id, participant_id, date, amount, currency, type, description, contribution_type)
            VALUES (ba, acct, qa.id('part_a1'), '2026-03-01', 10000, 'INR', 'income', 'A pays 1', 'capital_contribution') RETURNING id INTO t1;
        INSERT INTO public.transactions (business_id, account_id, participant_id, date, amount, currency, type, description, contribution_type)
            VALUES (ba, acct, qa.id('part_a1'), '2026-03-02', 10000, 'INR', 'income', 'A pays 2', 'capital_contribution') RETURNING id INTO t2;
        INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, transaction_amount, amount, currency)
            VALUES (ba, ca, t1, 10000, 10000, 'INR');
        INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, transaction_amount, amount, currency)
            VALUES (ba, ca, t2, 10000, 10000, 'INR') RETURNING id INTO a2;

        s := qa.val(format($q$SELECT r.target_amount || '/' || sum(c.committed_amount) || '/' ||
              sum(COALESCE((SELECT sum(amount) FROM public.payment_allocations p WHERE p.commitment_id = c.id AND NOT p.is_reversed), 0)) || '/' ||
              sum(GREATEST(0, c.committed_amount - COALESCE((SELECT sum(amount) FROM public.payment_allocations p WHERE p.commitment_id = c.id AND NOT p.is_reversed), 0)))
            FROM public.funding_requirements r JOIN public.funding_commitments c ON c.requirement_id = r.id WHERE r.id = %L GROUP BY r.target_amount$q$, rq));
        r := r || qa.r('FIN-01', 'required/committed/allocated/outstanding = 30000/30000/20000/10000', s = '30000.00/30000.00/20000.00/10000.00', s);
        s := qa.val(format($q$SELECT (SELECT status FROM public.funding_commitments WHERE id = %L) || '/' || (SELECT status FROM public.funding_commitments WHERE id = %L)$q$, ca, cb));
        r := r || qa.r('FIN-01', 'commitment A fulfilled, commitment B pledged', s = 'fulfilled/pledged', s);

        s := qa.try(format('UPDATE public.transactions SET is_reversed = TRUE WHERE id = %L', t2));
        r := r || qa.r('FIN-03', 'reverse Tx 2', s = 'OK 1', s);
        s := qa.val(format($q$SELECT is_reversed || '/' || COALESCE(reversal_reason, 'null') FROM public.payment_allocations WHERE id = %L$q$, a2));
        r := r || qa.r('FIN-03', 'Tx 2 allocation auto-reversed', s LIKE 'true/%', s);
        s := qa.val(format($q$SELECT status || '/' || (SELECT sum(amount) FROM public.payment_allocations WHERE commitment_id = %L AND NOT is_reversed) FROM public.funding_commitments WHERE id = %L$q$, ca, ca));
        r := r || qa.r('FIN-03', 'commitment A back to partially_paid with 10000 active', s = 'partially_paid/10000.00', s);
        s := qa.val(format($q$SELECT string_agg(event_type, ',' ORDER BY created_at, event_type) FROM public.activity_records
              WHERE entity_id IN (%L, %L) AND event_type LIKE '%%reversed'$q$, t2, a2));
        r := r || qa.r('FIN-03', 'reversal events written to activity ledger', s = 'payment_allocations.reversed,transactions.reversed' OR s = 'transactions.reversed,payment_allocations.reversed', s);
        s := qa.try(format('UPDATE public.payment_allocations SET is_reversed = FALSE WHERE id = %L', a2));
        r := r || qa.r('FIN-03', 'reversed allocation cannot be un-reversed', s NOT LIKE 'OK%', s);
        s := qa.try(format('DELETE FROM public.transactions WHERE id = %L', t1));
        r := r || qa.r('FIN-03', 'transactions cannot be deleted', s NOT LIKE 'OK 1', s);

        -- FIN-X1..X5 on the same data
        s := qa.try(format('UPDATE public.transactions SET amount = 5000 WHERE id = %L', t1));
        r := r || qa.r('FIN-X1', 'shrinking an allocated transaction below its allocations is rejected', s NOT LIKE 'OK 1', s);
        s := qa.try(format('UPDATE public.transactions SET is_reversed = FALSE WHERE id = %L', t2));
        r := r || qa.r('FIN-X2', 'a reversed transaction cannot be un-reversed', s NOT LIKE 'OK 1', s);
        s := qa.try(format($q$UPDATE public.funding_commitments SET status = 'fulfilled' WHERE id = %L$q$, cb));
        r := r || qa.r('FIN-X3', 'client cannot set commitment status directly (B has 0 paid)', s NOT LIKE 'OK 1', s);
        -- A has 10000 active after the reversal; lowering its commitment to 10000 should make it fulfilled
        s := qa.try(format('UPDATE public.funding_commitments SET committed_amount = 10000 WHERE id = %L', ca));
        s := s || ' -> status=' || qa.val(format('SELECT status FROM public.funding_commitments WHERE id = %L', ca));
        r := r || qa.r('FIN-X4', 'changing committed_amount re-derives status', s LIKE '%status=fulfilled', s);
        s := qa.try(format($q$UPDATE public.transactions SET type = 'expense' WHERE id = %L$q$, t1));
        r := r || qa.r('FIN-X5', 'an allocated income transaction cannot be retyped to expense', s NOT LIKE 'OK 1', s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('FIN-01', 'scenario setup', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

-- FIN-04 (a) cross-currency transfer, (b) cross-currency allocation
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a'); eur UUID; inr UUID; usd UUID; c0 NUMERIC; c1 NUMERIC;
    rq UUID; cm UUID; t1 UUID; t2 UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.financial_accounts (business_id, name, type, currency, opening_balance, opening_balance_date, exchange_rate_to_base)
            VALUES (ba, 'EUR acct', 'bank', 'EUR', 5000, '2026-01-01', 90) RETURNING id INTO eur;
        INSERT INTO public.financial_accounts (business_id, name, type, currency, opening_balance, opening_balance_date)
            VALUES (ba, 'INR acct 2', 'bank', 'INR', 0, '2026-01-01') RETURNING id INTO inr;
        c0 := qa.available_cash(ba);
        s := qa.try(format($q$INSERT INTO public.transactions (business_id, account_id, transfer_to_account_id, date, amount, currency, exchange_rate_to_base, transfer_to_amount, type, description)
              VALUES (%L, %L, %L, '2026-03-05', 1000, 'EUR', 90, 90000, 'transfer', 'EUR to INR')$q$, ba, eur, inr));
        r := r || qa.r('FIN-04a', 'insert EUR->INR transfer', s = 'OK 1', s);
        c1 := qa.available_cash(ba);
        s := qa.native_balance(eur) || ' EUR / ' || qa.native_balance(inr) || ' INR';
        r := r || qa.r('FIN-04a', 'EUR -1000, INR +90000 native', s = '4000.00 EUR / 90000.00 INR', s);
        r := r || qa.r('FIN-04a', 'available cash in INR unchanged by transfer', c0 = c1, c0 || ' -> ' || c1);

        INSERT INTO public.financial_accounts (business_id, name, type, currency, opening_balance, opening_balance_date, exchange_rate_to_base)
            VALUES (ba, 'USD acct', 'bank', 'USD', 0, '2026-01-01', 84.5) RETURNING id INTO usd;
        INSERT INTO public.funding_requirements (business_id, title, target_amount, currency) VALUES (ba, 'FX round', 200000, 'INR') RETURNING id INTO rq;
        INSERT INTO public.funding_commitments (business_id, requirement_id, funder_name, committed_amount, currency)
            VALUES (ba, rq, 'US angel', 200000, 'INR') RETURNING id INTO cm;
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, exchange_rate_to_base, type, description)
            VALUES (ba, usd, '2026-03-06', 1000, 'USD', 84.5, 'income', 'USD in 1') RETURNING id INTO t1;
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, exchange_rate_to_base, type, description)
            VALUES (ba, usd, '2026-03-07', 1000, 'USD', 84.5, 'income', 'USD in 2') RETURNING id INTO t2;
        s := qa.try(format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, transaction_amount, exchange_rate_to_commitment, amount, currency)
              VALUES (%L, %L, %L, 1000, 84.5, 84500, 'INR')$q$, ba, cm, t1));
        r := r || qa.r('FIN-04b', 'USD 1000 allocated to INR commitment at 84.50 = 84500', s = 'OK 1', s);
        s := qa.val(format('SELECT status FROM public.funding_commitments WHERE id = %L', cm));
        r := r || qa.r('FIN-04b', 'commitment partially_paid', s = 'partially_paid', s);
        s := qa.try(format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, transaction_amount, exchange_rate_to_commitment, amount, currency)
              VALUES (%L, %L, %L, 1000, 84.5, 84000, 'INR')$q$, ba, cm, t2));
        r := r || qa.r('FIN-04b', 'mismatched converted amount rejected by chk_pa_currency_conversion', s LIKE '23514%chk_pa_currency_conversion%', s);
        s := qa.try(format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, transaction_amount, exchange_rate_to_commitment, amount, currency)
              VALUES (%L, %L, %L, 1000, 84.5, 84500, 'USD')$q$, ba, cm, t2));
        r := r || qa.r('FIN-04b', 'allocation currency must equal commitment currency', s NOT LIKE 'OK%', s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('FIN-04', 'scenario setup', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

-- FIN-05 historical FX snapshot
DO $$
DECLARE r TEXT[] := '{}'; ba UUID := qa.id('biz_a'); usd UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.financial_accounts (business_id, name, type, currency, opening_balance, opening_balance_date, exchange_rate_to_base)
            VALUES (ba, 'USD hist', 'bank', 'USD', 1000, '2026-01-01', 83) RETURNING id INTO usd;
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, exchange_rate_to_base, type, description)
            VALUES (ba, usd, '2026-01-02', 500, 'USD', 85, 'income', 'Day 2');
        r := r || qa.r('FIN-05', 'native USD balance 1500', qa.native_balance(usd) = 1500, qa.native_balance(usd)::TEXT);
        r := r || qa.r('FIN-05', 'base value 83000 + 42500 = 125500', qa.base_value(usd) = 125500, qa.base_value(usd)::TEXT);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('FIN-05', 'scenario setup', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

-- FIN-06 personal founder expense isolation
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a'); c0 NUMERIC; c1 NUMERIC; t UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        c0 := qa.available_cash(ba);
        INSERT INTO public.transactions (business_id, account_id, participant_id, date, amount, currency, type, description, contribution_type, is_personal_founder_payment)
            VALUES (ba, NULL, qa.id('part_a1'), '2026-03-10', 1200, 'INR', 'expense', 'Domain paid personally', 'reimbursable_expense', TRUE) RETURNING id INTO t;
        c1 := qa.available_cash(ba);
        r := r || qa.r('FIN-06', 'corporate available cash unchanged', c0 = c1, c0 || ' -> ' || c1);
        s := qa.val($q$SELECT COALESCE(sum(amount), 0)::text FROM public.transactions WHERE is_personal_founder_payment
              AND contribution_type = 'reimbursable_expense' AND reimbursement_status <> 'reimbursed' AND NOT is_reversed$q$);
        r := r || qa.r('FIN-06', 'unreimbursed founder expenses = 1200', s = '1200.00', s);
        s := qa.val(format('SELECT reimbursement_status FROM public.transactions WHERE id = %L', t));
        r := r || qa.r('FIN-06x', 'reimbursable expense gets reimbursement_status pending, not the default', s = 'pending', s);
        s := qa.try(format($q$INSERT INTO public.transactions (business_id, account_id, participant_id, date, amount, currency, type, description, contribution_type, is_personal_founder_payment)
              VALUES (%L, NULL, %L, '2026-03-10', 100, 'INR', 'expense', 'bad', 'operational', TRUE)$q$, ba, qa.id('part_a1')));
        r := r || qa.r('FIN-06x', 'personal payment cannot be operational', s NOT LIKE 'OK%', s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('FIN-06', 'scenario setup', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

-- FIN-07 capital structure over-allocation + currency
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a'); cs UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.capital_structures (business_id, agreed_capital_target, currency) VALUES (ba, 1000000, 'INR') RETURNING id INTO cs;
        s := qa.try(format($q$INSERT INTO public.participant_capital_allocations (business_id, structure_id, participant_id, allocated_amount, currency) VALUES (%L, %L, %L, 700000, 'INR')$q$, ba, cs, qa.id('part_a1')));
        s := s || ' ; ' || qa.try(format($q$INSERT INTO public.participant_capital_allocations (business_id, structure_id, participant_id, allocated_amount, currency) VALUES (%L, %L, %L, 500000, 'INR')$q$, ba, cs, qa.id('part_a2')));
        r := r || qa.r('FIN-07', 'two INR allocations accepted', s = 'OK 1 ; OK 1', s);
        s := qa.try(format($q$INSERT INTO public.participant_capital_allocations (business_id, structure_id, participant_id, allocated_amount, currency) VALUES (%L, %L, %L, 100, 'USD')$q$, ba, cs, qa.id('part_a1')));
        r := r || qa.r('FIN-07', 'USD allocation into INR structure rejected', s NOT LIKE 'OK%' AND s LIKE '%must match parent capital_structures.currency%', s);
        s := qa.val(format($q$SELECT allocation_status || '/' || over_allocated_amount || '/' || unallocated_amount FROM public.vw_capital_structure_allocation_summary WHERE structure_id = %L$q$, cs));
        r := r || qa.r('FIN-07', 'view reports over_allocated by 200000', s = 'over_allocated/200000.00/0.00', s);
        s := qa.val(format($q$SELECT string_agg(agreed_equity_percentage::text, '/' ORDER BY agreed_equity_percentage DESC) FROM public.participants WHERE business_id = %L$q$, ba));
        r := r || qa.r('FIN-07', 'ownership percentages untouched (60/40)', s = '60.00/40.00', s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('FIN-07', 'scenario setup', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

-- FIN-08 CSV import currency fallback and atomic abort
DO $$
DECLARE r TEXT[] := '{}'; s TEXT; ba UUID := qa.id('biz_a'); acct UUID := qa.id('acct_a_inr'); old UUID; b1 UUID; b2 UUID;
BEGIN
    BEGIN
        PERFORM qa.login(qa.id('user_a'));
        INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description)
            VALUES (ba, acct, '2026-11-01', 5000, 'INR', 'expense', 'Server') RETURNING id INTO old;
        INSERT INTO public.import_batches (business_id, account_id, filename, file_checksum_sha256, total_rows)
            VALUES (ba, acct, 'nov.csv', repeat('a', 64), 2) RETURNING id INTO b1;
        INSERT INTO public.import_batch_rows (business_id, batch_id, raw_row_index, fingerprint, parsed_payload, has_potential_duplicate, matched_transaction_id, target_overwrite_transaction_id, resolution)
            VALUES (ba, b1, 0, repeat('b', 64), '{"date":"2026-11-01","amount":"5000.00","type":"expense","description":"Server"}', TRUE, old, old, 'overwrite');
        INSERT INTO public.import_batch_rows (business_id, batch_id, raw_row_index, fingerprint, parsed_payload, resolution)
            VALUES (ba, b1, 1, repeat('c', 64), '{"date":"2026-11-02","amount":"750.00","type":"expense","description":"Hosting"}', 'import_as_distinct');
        s := qa.val(format('SELECT public.commit_import_batch(%L)::text', b1));
        r := r || qa.r('FIN-08', 'commit batch with currency-less rows', s LIKE '%"status": "committed"%', s);
        s := qa.val(format($q$SELECT string_agg(currency, ',') || '/' || count(*) FROM public.transactions WHERE import_batch_id = %L$q$, b1));
        r := r || qa.r('FIN-08', 'both rows resolved to account currency INR', s = 'INR,INR/2', s);
        s := qa.val(format($q$SELECT is_reversed || '/' || (reversed_by_id IN (SELECT id FROM public.transactions WHERE import_batch_id = %L)) FROM public.transactions WHERE id = %L$q$, b1, old));
        r := r || qa.r('FIN-08', 'overwritten transaction reversed and linked to replacement', s = 'true/true', s);

        INSERT INTO public.import_batches (business_id, account_id, filename, file_checksum_sha256, total_rows)
            VALUES (ba, acct, 'eur.csv', repeat('d', 64), 2) RETURNING id INTO b2;
        INSERT INTO public.import_batch_rows (business_id, batch_id, raw_row_index, fingerprint, parsed_payload, resolution)
            VALUES (ba, b2, 0, repeat('e', 64), '{"date":"2026-11-03","amount":"10.00","type":"expense","description":"ok row"}', 'import_as_distinct');
        INSERT INTO public.import_batch_rows (business_id, batch_id, raw_row_index, fingerprint, parsed_payload, resolution)
            VALUES (ba, b2, 1, repeat('f', 64), '{"date":"2026-11-03","amount":"20.00","type":"expense","description":"eur row","currency":"EUR"}', 'import_as_distinct');
        s := qa.try(format('SELECT public.commit_import_batch(%L)', b2));
        r := r || qa.r('FIN-08', 'EUR row on INR account aborts the commit', s NOT LIKE 'OK%', s);
        s := qa.val(format($q$SELECT (SELECT status FROM public.import_batches WHERE id = %L) || '/' || (SELECT count(*) FROM public.transactions WHERE import_batch_id = %L)$q$, b2, b2));
        r := r || qa.r('FIN-08', 'abort is atomic (batch staged, 0 transactions)', s = 'staged/0', s);
        RAISE EXCEPTION 'qa_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'qa_rollback' THEN RAISE; END IF;
    WHEN OTHERS THEN
        r := r || qa.r('FIN-08', 'scenario setup', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM qa.flush(r);
END $$;

SELECT test_id, check_name, status, left(detail, 200) AS detail FROM qa.results
WHERE test_id LIKE 'FIN%' ORDER BY seq;
