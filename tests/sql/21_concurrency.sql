-- =====================================================================================
-- Concurrency: two sessions allocate 4000 each against one 5000 receipt.
-- Run part 1 once, then parts 2a and 2b in two separate connections started together
-- (2b sleeps 1.5 s first so 2a holds the row lock). Then run part 3.
-- =====================================================================================

-- ---- part 1: setup ----
SELECT qa.suite('21_concurrency');
CREATE TABLE IF NOT EXISTS qa.conc_log (who text, started timestamptz, finished timestamptz, result text);
DO $$
DECLARE ba uuid := qa.id('biz_a'); v uuid;
BEGIN
    PERFORM qa.as_user('a');
    INSERT INTO public.financial_accounts (business_id, name, account_type, opening_balance, opening_balance_date) VALUES (ba, 'Bridge escrow-free account', 'bank', 0, '2026-08-01') RETURNING id INTO v; PERFORM qa.setid('acct_a_bridge', v);
    INSERT INTO public.funding_requirements (business_id, title, required_amount) VALUES (ba, 'Bridge', 10000) RETURNING id INTO v; PERFORM qa.setid('req_bridge', v);
    INSERT INTO public.funding_commitments (business_id, requirement_id, funder_name, committed_amount) VALUES (ba, qa.id('req_bridge'), 'Bridge investor', 10000) RETURNING id INTO v; PERFORM qa.setid('c_bridge', v);
    INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, contribution_type, description)
        VALUES (ba, qa.id('acct_a_bridge'), '2026-08-02', 5000, 'income', 'third_party_equity', 'Bridge tranche (single 5000 receipt)') RETURNING id INTO v; PERFORM qa.setid('t_bridge', v);
    PERFORM qa.as_admin();
END $$;

-- ---- part 2a: session 1 (holds the transaction row lock for 6 s) ----
DO $$
DECLARE t0 timestamptz := clock_timestamp(); r text;
BEGIN
    PERFORM qa.as_user('a');
    r := qa.run(format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 4000)$q$, qa.id('biz_a'), qa.id('c_bridge'), qa.id('t_bridge')));
    PERFORM pg_sleep(6);
    PERFORM qa.as_admin();
    INSERT INTO qa.conc_log VALUES ('session1', t0, clock_timestamp(), r);
END $$;

-- ---- part 2b: session 2 (starts 1.5 s later; must block, then fail) ----
DO $$
DECLARE t0 timestamptz; r text;
BEGIN
    PERFORM pg_sleep(1.5);
    t0 := clock_timestamp();
    PERFORM qa.as_user('a');
    r := qa.run(format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 4000)$q$, qa.id('biz_a'), qa.id('c_bridge'), qa.id('t_bridge')));
    PERFORM qa.as_admin();
    INSERT INTO qa.conc_log VALUES ('session2', t0, clock_timestamp(), r);
END $$;

-- ---- part 3: verdict ----
SELECT qa.suite('21_concurrency');
DO $$
DECLARE s1 record; s2 record;
BEGIN
    SELECT * INTO s1 FROM qa.conc_log WHERE who = 'session1';
    SELECT * INTO s2 FROM qa.conc_log WHERE who = 'session2';
    PERFORM qa.record('CONC-01', 'session 1 allocated 4000', s1.result = 'OK 1', 'OK 1', s1.result);
    PERFORM qa.record('CONC-02', 'session 2 waited for session 1 to commit (row lock)', s2.finished >= s1.finished AND s2.started < s1.finished, 's2 ends after s1 commit',
        format('s1 %s..%s | s2 %s..%s', to_char(s1.started, 'HH24:MI:SS.MS'), to_char(s1.finished, 'HH24:MI:SS.MS'), to_char(s2.started, 'HH24:MI:SS.MS'), to_char(s2.finished, 'HH24:MI:SS.MS')));
    PERFORM qa.record('CONC-03', 'session 2 re-checked after the lock and was refused', s2.result LIKE '23514%would exceed%', '23514 would exceed', s2.result);
    PERFORM qa.v('CONC-04', 'exactly one 4000 allocation exists on the receipt',
        format($q$SELECT count(*) || '/' || sum(amount) FROM public.payment_allocations WHERE transaction_id = %L AND NOT is_reversed$q$, qa.id('t_bridge')), '1/4000.00');
END $$;
SELECT test_id, status, actual FROM qa.results WHERE suite = '21_concurrency' ORDER BY seq;
