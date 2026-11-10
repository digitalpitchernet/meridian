-- =====================================================================================
-- Gap checks for static-review findings not covered elsewhere (G-13, G-16).
-- Requires 00_harness and 01_fixtures. Run after 20_financial.
-- =====================================================================================
SELECT qa.suite('40_gap_checks');
DO $$
DECLARE ba uuid := qa.id('biz_a'); v uuid;
BEGIN
    PERFORM qa.as_user('a');
    INSERT INTO public.financial_accounts (business_id, name, account_type, opening_balance, opening_balance_date)
        VALUES (ba, 'Gap early', 'bank', 1000, '2026-01-01') RETURNING id INTO v; PERFORM qa.setid('gap_early', v);
    INSERT INTO public.financial_accounts (business_id, name, account_type, opening_balance, opening_balance_date)
        VALUES (ba, 'Gap late', 'bank', 0, '2026-06-01') RETURNING id INTO v; PERFORM qa.setid('gap_late', v);
    INSERT INTO public.funding_requirements (business_id, title, required_amount) VALUES (ba, 'Gap req', 100) RETURNING id INTO v; PERFORM qa.setid('gap_req', v);
    INSERT INTO public.funding_commitments (business_id, requirement_id, funder_name, committed_amount)
        VALUES (ba, qa.id('gap_req'), 'Gap funder', 100) RETURNING id INTO v; PERFORM qa.setid('gap_c', v);

    PERFORM qa.t('GAP-01', 'a transfer dated before the destination account opened is refused (G-13)',
        format($q$INSERT INTO public.transactions (business_id, account_id, transfer_to_account_id, transaction_date, amount, type, description)
                  VALUES (%L, %L, %L, '2026-03-01', 100, 'transfer', 'early transfer')$q$, ba, qa.id('gap_early'), qa.id('gap_late')),
        '23514%destination opening%');
    PERFORM qa.t('GAP-02', 'the same transfer on or after both opening dates is accepted',
        format($q$INSERT INTO public.transactions (business_id, account_id, transfer_to_account_id, transaction_date, amount, type, description)
                  VALUES (%L, %L, %L, '2026-06-01', 100, 'transfer', 'valid transfer')$q$, ba, qa.id('gap_early'), qa.id('gap_late')),
        'OK 1');
    PERFORM qa.v('GAP-03', 'the transfer is cash-neutral across the two accounts',
        format($q$SELECT sum(balance)::numeric(15,2)::text FROM public.get_account_balances(DATE '2026-07-01') WHERE account_id IN (%L, %L)$q$,
               qa.id('gap_early'), qa.id('gap_late')), '1000.00');
    PERFORM qa.t('GAP-04', 'revoking a commitment with a NULL reason is refused (G-16)',
        format($q$SELECT public.revoke_funding_commitment(%L, NULL)$q$, qa.id('gap_c')), '23514%reason is required%');
    PERFORM qa.t('GAP-05', 'revoking a commitment with a blank reason is refused (G-16)',
        format($q$SELECT public.revoke_funding_commitment(%L, '   ')$q$, qa.id('gap_c')), '23514%reason is required%');
    PERFORM qa.v('GAP-06', 'the commitment is still pledged after both refusals',
        format($q$SELECT status FROM public.vw_funding_commitment_status WHERE commitment_id = %L$q$, qa.id('gap_c')), 'pledged');
    PERFORM qa.as_admin();
END $$;
SELECT test_id, status, actual FROM qa.results WHERE suite = '40_gap_checks' ORDER BY seq;
