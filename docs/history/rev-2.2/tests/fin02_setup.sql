-- FIN-02 setup (run once in the SQL Editor): a 5000 INR income and a 10000 INR commitment for founder A.
CREATE TABLE IF NOT EXISTS qa.fin02_log (who TEXT, started TIMESTAMPTZ, finished TIMESTAMPTZ, result TEXT);
TRUNCATE qa.fin02_log;
DO $$
DECLARE ba UUID := qa.id('biz_a'); v UUID;
BEGIN
    PERFORM qa.login(qa.id('user_a'));
    INSERT INTO public.funding_requirements (business_id, title, target_amount, currency) VALUES (ba, 'FIN-02 req', 10000, 'INR') RETURNING id INTO v;
    PERFORM qa.setid('fin02_req', v);
    INSERT INTO public.funding_commitments (business_id, requirement_id, funder_name, committed_amount, currency)
        VALUES (ba, qa.id('fin02_req'), 'FIN-02 funder', 10000, 'INR') RETURNING id INTO v;
    PERFORM qa.setid('fin02_commit', v);
    INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description)
        VALUES (ba, qa.id('acct_a_inr'), '2026-05-01', 5000, 'INR', 'income', 'FIN-02 single 5000 receipt') RETURNING id INTO v;
    PERFORM qa.setid('fin02_tx', v);
    PERFORM qa.logout();
END $$;
SELECT k, v FROM qa.ids WHERE k LIKE 'fin02%';
