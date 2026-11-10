-- Fixtures: three auth users, two businesses bootstrapped THROUGH RLS as the founders themselves.
-- Run after the up migrations. Records BOOT-* results.

DO $$
DECLARE
    ua UUID := '00000000-0000-4000-8000-00000000000a';
    ub UUID := '00000000-0000-4000-8000-00000000000b';
    uc UUID := '00000000-0000-4000-8000-00000000000c';
    v UUID; r TEXT[] := '{}'; s TEXT;
BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'founder.a@meridian.test', now(), now()),
           (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'founder.b@meridian.test', now(), now()),
           (uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stranger.c@meridian.test', now(), now())
    ON CONFLICT (id) DO NOTHING;
    PERFORM qa.setid('user_a', ua); PERFORM qa.setid('user_b', ub); PERFORM qa.setid('user_c', uc);

    -- Bootstrap A: business then profile, as user A
    PERFORM qa.login(ua);
    BEGIN
        INSERT INTO public.businesses (business_name, base_currency, locale, timezone)
        VALUES ('Alpha Ventures', 'INR', 'en-IN', 'Asia/Kolkata') RETURNING id INTO v;
        PERFORM qa.setid('biz_a', v);
        r := r || qa.r('BOOT-01', 'founder A creates business via RLS bootstrap', TRUE, v::TEXT);
    EXCEPTION WHEN OTHERS THEN
        r := r || qa.r('BOOT-01', 'founder A creates business via RLS bootstrap', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    s := qa.try(format($q$INSERT INTO public.profiles (id, business_id, full_name, email) VALUES (%L, %L, 'Founder A', 'founder.a@meridian.test')$q$, ua, qa.id('biz_a')));
    r := r || qa.r('BOOT-02', 'founder A creates own profile via RLS bootstrap', s LIKE 'OK%', s);
    s := qa.val('SELECT public.get_current_business_id()::text');
    r := r || qa.r('BOOT-03', 'get_current_business_id() resolves for A', s = qa.id('biz_a')::TEXT, s);
    s := qa.try($q$INSERT INTO public.businesses (business_name, base_currency, locale, timezone) VALUES ('Alpha Two', 'INR', 'en-IN', 'Asia/Kolkata')$q$);
    r := r || qa.r('BOOT-04', 'founder A cannot create a second business', s NOT LIKE 'OK%', s);
    PERFORM qa.logout();

    -- Bootstrap B
    PERFORM qa.login(ub);
    BEGIN
        INSERT INTO public.businesses (business_name, base_currency, locale, timezone)
        VALUES ('Beta Labs', 'INR', 'en-GB', 'Europe/London') RETURNING id INTO v;
        PERFORM qa.setid('biz_b', v);
        r := r || qa.r('BOOT-05', 'founder B creates business via RLS bootstrap', TRUE, v::TEXT);
    EXCEPTION WHEN OTHERS THEN
        r := r || qa.r('BOOT-05', 'founder B creates business via RLS bootstrap', FALSE, SQLSTATE || ' ' || SQLERRM);
    END;
    s := qa.try(format($q$INSERT INTO public.profiles (id, business_id, full_name, email) VALUES (%L, %L, 'Founder B', 'founder.b@meridian.test')$q$, ub, qa.id('biz_b')));
    r := r || qa.r('BOOT-06', 'founder B creates own profile', s LIKE 'OK%', s);
    PERFORM qa.logout();

    -- Stranger C (no business) tries to attach itself to business A
    PERFORM qa.login(uc);
    s := qa.try(format($q$INSERT INTO public.profiles (id, business_id, full_name, email) VALUES (%L, %L, 'Intruder', 'c@x.test')$q$, uc, qa.id('biz_a')));
    r := r || qa.r('BOOT-07', 'stranger C cannot join business A by inserting a profile', s NOT LIKE 'OK%', s);
    s := qa.val(format('SELECT count(*)::text FROM public.businesses WHERE id = %L', qa.id('biz_a')));
    r := r || qa.r('BOOT-08', 'stranger C cannot see business A', s = '0', s);
    PERFORM qa.logout();

    PERFORM qa.flush(r);
END $$;

-- Domain fixtures, created by each founder through RLS
DO $$
DECLARE v UUID; ba UUID := qa.id('biz_a'); bb UUID := qa.id('biz_b'); r TEXT[] := '{}';
BEGIN
    PERFORM qa.login(qa.id('user_a'));
    INSERT INTO public.participants (business_id, profile_id, full_name, participant_type, role, agreed_equity_percentage)
        VALUES (ba, qa.id('user_a'), 'Founder A', 'founder', 'CEO', 60) RETURNING id INTO v; PERFORM qa.setid('part_a1', v);
    INSERT INTO public.participants (business_id, full_name, participant_type, role, agreed_equity_percentage)
        VALUES (ba, 'Cofounder A2', 'cofounder', 'CTO', 40) RETURNING id INTO v; PERFORM qa.setid('part_a2', v);
    INSERT INTO public.contacts (business_id, first_name, category) VALUES (ba, 'Vendor', 'Vendor') RETURNING id INTO v; PERFORM qa.setid('contact_a', v);
    INSERT INTO public.financial_accounts (business_id, name, type, currency, opening_balance, opening_balance_date)
        VALUES (ba, 'INR Current', 'bank', 'INR', 0, '2026-01-01') RETURNING id INTO v; PERFORM qa.setid('acct_a_inr', v);
    INSERT INTO public.documents (business_id, title, file_path, file_size_bytes, mime_type, storage_provider, category)
        VALUES (ba, 'Founders agreement', 'x/agreement.pdf', 10, 'application/pdf', 'supabase', 'Legal') RETURNING id INTO v; PERFORM qa.setid('doc_a', v);
    PERFORM qa.logout();

    PERFORM qa.login(qa.id('user_b'));
    INSERT INTO public.projects (business_id, name) VALUES (bb, 'Beta Project') RETURNING id INTO v; PERFORM qa.setid('proj_b', v);
    INSERT INTO public.financial_accounts (business_id, name, type, currency, opening_balance, opening_balance_date)
        VALUES (bb, 'B INR', 'bank', 'INR', 0, '2026-01-01') RETURNING id INTO v; PERFORM qa.setid('acct_b_inr', v);
    INSERT INTO public.funding_requirements (business_id, title, target_amount, currency)
        VALUES (bb, 'B seed', 1000, 'INR') RETURNING id INTO v; PERFORM qa.setid('req_b', v);
    INSERT INTO public.funding_commitments (business_id, requirement_id, funder_name, committed_amount, currency)
        VALUES (bb, qa.id('req_b'), 'B funder', 1000, 'INR') RETURNING id INTO v; PERFORM qa.setid('commit_b', v);
    INSERT INTO public.transactions (business_id, account_id, date, amount, currency, type, description)
        VALUES (bb, qa.id('acct_b_inr'), '2026-02-01', 500, 'INR', 'income', 'B income') RETURNING id INTO v; PERFORM qa.setid('tx_b', v);
    PERFORM qa.logout();

    r := r || qa.r('FIXTURES', 'domain fixtures created by founders through RLS', TRUE, NULL);
    PERFORM qa.flush(r);
EXCEPTION WHEN OTHERS THEN
    PERFORM qa.logout();
    PERFORM qa.flush(ARRAY[qa.r('FIXTURES', 'domain fixtures created by founders through RLS', FALSE, SQLSTATE || ' ' || SQLERRM)]);
END $$;

SELECT test_id, check_name, status, left(detail, 160) AS detail FROM qa.results ORDER BY seq;
