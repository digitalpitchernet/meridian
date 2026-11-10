-- =====================================================================================
-- CSV import suite (business A, HDFC Current account, opened 2026-04-01).
-- Stage -> server validation/fingerprinting -> founder decisions -> atomic commit.
-- =====================================================================================
SELECT qa.suite('30_csv_import');

DO $$
DECLARE ba uuid := qa.id('biz_a'); b1 uuid := qa.id('acct_a_bank1'); v uuid; r text;
BEGIN
    PERFORM qa.as_user('a');
    -- a transaction that a later CSV row will correct
    INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, description)
        VALUES (ba, b1, '2026-08-05', 450, 'expense', 'Typo vendor') RETURNING id INTO v; PERFORM qa.setid('tx_typo', v);
    INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, description)
        VALUES (ba, qa.id('acct_a_bank2'), '2026-08-05', 100, 'expense', 'Other-account expense') RETURNING id INTO v; PERFORM qa.setid('tx_other_acct', v);
    SELECT id INTO v FROM public.transactions WHERE type = 'transfer' AND description = 'Rebalance'; PERFORM qa.setid('tx_transfer', v);

    INSERT INTO public.import_batches (business_id, account_id, filename, file_checksum_sha256) VALUES (ba, b1, 'hdfc-aug.csv', repeat('a', 64)) RETURNING id INTO v; PERFORM qa.setid('batch1', v);
    INSERT INTO public.import_batch_rows (business_id, batch_id, row_index, payload) VALUES
        (ba, v, 0, '{"date":"2026-08-03","amount":"1200.50","type":"expense","description":"AWS  August"}'),
        (ba, v, 1, '{"date":"2026-08-04","amount":"300","type":"income","description":"Stripe payout"}'),
        (ba, v, 2, '{"date":"03/08/2026","amount":"10","type":"expense","description":"bad date"}'),
        (ba, v, 3, '{"date":"2026-08-04","amount":"-5","type":"expense","description":"negative"}'),
        (ba, v, 4, '{"date":"2026-06-12","amount":"3000.00","type":"income","description":"customer invoice   001"}'),
        (ba, v, 5, '{"date":"2026-08-03","amount":"1200.5","type":"expense","description":"aws august"}');
    PERFORM qa.as_admin();
    PERFORM qa.record('CSV-SETUP', 'batch staged by the founder through RLS', true, 'ok', 'ok');
EXCEPTION WHEN OTHERS THEN
    PERFORM qa.as_admin();
    PERFORM qa.record('CSV-SETUP', 'batch staged by the founder through RLS', false, 'ok', SQLSTATE || ' ' || SQLERRM);
END $$;

DO $$
DECLARE b uuid := qa.id('batch1');
BEGIN
    PERFORM qa.as_user('a');
    PERFORM qa.v('CSV-01', 'server parsed the valid rows', format($q$SELECT string_agg(parsed_date || ' ' || parsed_amount || ' ' || parsed_type || ' ' || parsed_description, ' | ' ORDER BY row_index) FROM public.import_batch_rows WHERE batch_id = %L AND row_index IN (0, 1)$q$, b),
        '2026-08-03 1200.50 expense AWS August | 2026-08-04 300.00 income Stripe payout');
    PERFORM qa.v('CSV-02', 'invalid rows carry a validation error', format($q$SELECT string_agg(row_index || ':' || (validation_error IS NOT NULL)::text, ',' ORDER BY row_index) FROM public.import_batch_rows WHERE batch_id = %L AND row_index IN (2, 3)$q$, b), '2:true,3:true');
    PERFORM qa.v('CSV-03', 'row 4 is flagged as a duplicate of the existing invoice transaction', format($q$SELECT (duplicate_of_transaction_id = %L)::text FROM public.import_batch_rows WHERE batch_id = %L AND row_index = 4$q$, qa.id('t6'), b), 'true');
    PERFORM qa.t('CSV-04', 'commit refused while invalid rows are not skipped', format($q$SELECT public.commit_import_batch(%L)$q$, b), '23514');
    PERFORM qa.t('CSV-05', 'founder marks the invalid rows skip', format($q$UPDATE public.import_batch_rows SET resolution = 'skip' WHERE batch_id = %L AND row_index IN (2, 3)$q$, b), 'ok:2');
    PERFORM qa.t('CSV-06', 'commit refused while suspected duplicates have no decision', format($q$SELECT public.commit_import_batch(%L)$q$, b), '23514');
    PERFORM qa.v('CSV-07', 'a refused commit changed nothing', format($q$SELECT (SELECT status FROM public.import_batches WHERE id = %L) || '/' || (SELECT count(*) FROM public.transactions WHERE import_batch_id = %L)$q$, b, b), 'staged/0');
    PERFORM qa.t('CSV-08', 'founder: row 4 is the same invoice (skip), row 5 is a genuine second charge (import)',
        format($q$UPDATE public.import_batch_rows SET resolution = CASE row_index WHEN 4 THEN 'skip' ELSE 'import' END WHERE batch_id = %L AND row_index IN (4, 5)$q$, b), 'ok:2');
    PERFORM qa.v('CSV-09', 'commit succeeds: 3 imported, 3 skipped', format($q$SELECT (r->>'imported') || '/' || (r->>'skipped') FROM (SELECT public.commit_import_batch(%L) AS r) x$q$, b), '3/3');
    PERFORM qa.v('CSV-10', 'imported transactions carry batch provenance', format($q$SELECT count(*)::text FROM public.transactions WHERE import_batch_id = %L$q$, b), '3');
    PERFORM qa.v('CSV-11', 'in-batch duplicate (row 5 vs row 0) was detected', format($q$SELECT duplicate_in_batch::text FROM public.import_batch_rows WHERE batch_id = %L AND row_index = 5$q$, b), 'true');
    PERFORM qa.v('CSV-12', 'import is in the activity ledger', format($q$SELECT metadata->>'imported' FROM public.activity_records WHERE entity_id = %L AND event_type = 'import_batches.committed'$q$, b), '3');
    PERFORM qa.t('CSV-13', 'committing twice is refused', format($q$SELECT public.commit_import_batch(%L)$q$, b), '23514');
    PERFORM qa.t('CSV-14', 'a committed batch cannot be deleted', format($q$DELETE FROM public.import_batches WHERE id = %L$q$, b), '42501');
    PERFORM qa.t('CSV-15', 'rows of a committed batch cannot be deleted', format($q$DELETE FROM public.import_batch_rows WHERE batch_id = %L$q$, b), '42501');
    PERFORM qa.t('CSV-16', 'rows cannot be added to a committed batch', format($q$INSERT INTO public.import_batch_rows (business_id, batch_id, row_index, payload) VALUES (%L, %L, 9, '{"date":"2026-08-09","amount":"1","type":"expense","description":"late"}')$q$, qa.id('biz_a'), b), '23514');
    PERFORM qa.t('CSV-17', 'decisions on a committed batch cannot change', format($q$UPDATE public.import_batch_rows SET resolution = 'skip' WHERE batch_id = %L AND row_index = 0$q$, b), '23514');
    PERFORM qa.as_admin();
END $$;

-- same file again, replace rules, atomicity, cross-tenant
DO $$
DECLARE ba uuid := qa.id('biz_a'); b1 uuid := qa.id('acct_a_bank1'); v uuid; k int;
        lbl text[] := ARRAY['other account', 'transfer', 'capital contribution', 'already reversed'];
        tgt uuid[] := ARRAY[qa.id('tx_other_acct'), qa.id('tx_transfer'), qa.id('t1'), qa.id('t2')];
BEGIN
    PERFORM qa.as_user('a');
    INSERT INTO public.import_batches (business_id, account_id, filename, file_checksum_sha256) VALUES (ba, b1, 'hdfc-aug-again.csv', repeat('a', 64)) RETURNING id INTO v;
    INSERT INTO public.import_batch_rows (business_id, batch_id, row_index, payload) VALUES (ba, v, 0, '{"date":"2026-08-06","amount":"1","type":"expense","description":"same file"}');
    PERFORM qa.t('CSV-20', 'the same file (sha256) cannot be imported twice into one account', format($q$SELECT public.commit_import_batch(%L)$q$, v), '23505');
    DELETE FROM public.import_batches WHERE id = v;

    FOR k IN 1..4 LOOP
        INSERT INTO public.import_batches (business_id, account_id, filename, file_checksum_sha256) VALUES (ba, b1, 'replace-' || k || '.csv', repeat(k::text, 64)) RETURNING id INTO v;
        INSERT INTO public.import_batch_rows (business_id, batch_id, row_index, payload)
            VALUES (ba, v, 0, '{"date":"2026-08-07","amount":"10","type":"expense","description":"replacement"}');
        UPDATE public.import_batch_rows SET resolution = 'replace', replace_transaction_id = tgt[k] WHERE batch_id = v;
        PERFORM qa.t('CSV-2' || k, 'replace refused: target is ' || lbl[k], format($q$SELECT public.commit_import_batch(%L)$q$, v), '23514');
        DELETE FROM public.import_batches WHERE id = v;
    END LOOP;

    INSERT INTO public.import_batches (business_id, account_id, filename, file_checksum_sha256) VALUES (ba, b1, 'replace-twice.csv', repeat('e', 64)) RETURNING id INTO v;
    INSERT INTO public.import_batch_rows (business_id, batch_id, row_index, payload) VALUES
        (ba, v, 0, '{"date":"2026-08-05","amount":"540","type":"expense","description":"Vendor (corrected)"}'),
        (ba, v, 1, '{"date":"2026-08-05","amount":"541","type":"expense","description":"Vendor (corrected again)"}');
    UPDATE public.import_batch_rows SET resolution = 'replace', replace_transaction_id = qa.id('tx_typo') WHERE batch_id = v;
    PERFORM qa.t('CSV-25', 'two rows cannot replace the same transaction', format($q$SELECT public.commit_import_batch(%L)$q$, v), '23514');
    DELETE FROM public.import_batches WHERE id = v;

    INSERT INTO public.import_batches (business_id, account_id, filename, file_checksum_sha256) VALUES (ba, b1, 'correction.csv', repeat('f', 64)) RETURNING id INTO v; PERFORM qa.setid('batch_fix', v);
    INSERT INTO public.import_batch_rows (business_id, batch_id, row_index, payload)
        VALUES (ba, v, 0, '{"date":"2026-08-05","amount":"540","type":"expense","description":"Vendor (corrected)"}');
    UPDATE public.import_batch_rows SET resolution = 'replace', replace_transaction_id = qa.id('tx_typo') WHERE batch_id = v;
    PERFORM qa.t('CSV-26', 'a valid replacement commits', format($q$SELECT public.commit_import_batch(%L)$q$, v), 'ok');
    PERFORM qa.v('CSV-27', 'the replaced transaction is reversed with a traceable reason', format($q$SELECT is_reversed::text || '/' || (reversal_reason LIKE 'Replaced by CSV import correction.csv%%')::text FROM public.transactions WHERE id = %L$q$, qa.id('tx_typo')), 'true/true');
    PERFORM qa.v('CSV-28', 'the replacement points back at what it replaced', format($q$SELECT amount::text FROM public.transactions WHERE replaces_transaction_id = %L$q$, qa.id('tx_typo')), '540.00');

    INSERT INTO public.import_batches (business_id, account_id, filename, file_checksum_sha256) VALUES (ba, b1, 'atomic.csv', repeat('9', 64)) RETURNING id INTO v; PERFORM qa.setid('batch_atomic', v);
    INSERT INTO public.import_batch_rows (business_id, batch_id, row_index, payload) VALUES
        (ba, v, 0, '{"date":"2026-08-08","amount":"77","type":"expense","description":"would be fine alone"}'),
        (ba, v, 1, '{"date":"2026-03-01","amount":"88","type":"expense","description":"before the account opened"}');
    PERFORM qa.t('CSV-29', 'one bad row aborts the whole commit', format($q$SELECT public.commit_import_batch(%L)$q$, v), '23514');
    PERFORM qa.v('CSV-30', 'nothing from the aborted batch was written', format($q$SELECT (SELECT status FROM public.import_batches WHERE id = %L) || '/' || (SELECT count(*) FROM public.transactions WHERE import_batch_id = %L) || '/' || (SELECT count(*) FROM public.transactions WHERE description = 'would be fine alone')$q$, v, v), 'staged/0/0');
    PERFORM qa.as_admin();

    PERFORM qa.as_user('b');
    PERFORM qa.t('CSV-31', 'founder B cannot commit A''s batch', format($q$SELECT public.commit_import_batch(%L)$q$, qa.id('batch_atomic')), 'P0002');
    PERFORM qa.t('CSV-32', 'founder B cannot stage rows into A''s batch', format($q$INSERT INTO public.import_batch_rows (business_id, batch_id, row_index, payload) VALUES (%L, %L, 5, '{"date":"2026-08-08","amount":"1","type":"expense","description":"x"}')$q$, qa.id('biz_b'), qa.id('batch_atomic')), 'err');
    PERFORM qa.as_admin();
END $$;

SELECT test_id, status, expected, actual FROM qa.results WHERE suite = '30_csv_import' AND status <> 'PASS' ORDER BY seq;
