-- FIN-02 concurrent allocation, as executed on 2026-11-07: two SQL Editor tabs, started ~0.35 s apart.
-- Each tab's run is one transaction. Session 1 holds its transaction for 8 s after inserting 4000 against
-- a 5000 receipt; session 2 must block on the FOR UPDATE row lock, then fail on re-evaluation.
-- Prerequisite: fin02_setup.sql (creates qa.fin02_log and the fin02_* fixtures).

-- ---- session 1 (tab 1) ----
DO $$
DECLARE t0 TIMESTAMPTZ := clock_timestamp(); s TEXT;
BEGIN
    PERFORM qa.login(qa.id('user_a'));
    s := qa.try(format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, transaction_amount, amount, currency) VALUES (%L, %L, %L, 4000, 4000, 'INR')$q$, qa.id('biz_a'), qa.id('fin02_commit'), qa.id('fin02_tx')));
    PERFORM pg_sleep(8);
    PERFORM qa.logout();
    INSERT INTO qa.fin02_log VALUES ('session1', t0, clock_timestamp(), s);
END $$;

-- ---- session 2 (tab 2, start while session 1 is sleeping) ----
DO $$
DECLARE t0 TIMESTAMPTZ := clock_timestamp(); s TEXT;
BEGIN
    PERFORM qa.login(qa.id('user_a'));
    s := qa.try(format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, transaction_amount, amount, currency) VALUES (%L, %L, %L, 4000, 4000, 'INR')$q$, qa.id('biz_a'), qa.id('fin02_commit'), qa.id('fin02_tx')));
    PERFORM qa.logout();
    INSERT INTO qa.fin02_log VALUES ('session2', t0, clock_timestamp(), s);
END $$;

-- ---- afterwards ----
SELECT who, started, finished, result FROM qa.fin02_log ORDER BY started;
