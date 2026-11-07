-- =====================================================================================
-- Fixtures: four auth users. A and B onboard through create_workspace() as themselves
-- (the real path); C is a signed-up stranger with no workspace; D is used to prove the
-- installation workspace limit. Validation raises the limit to 2 so tenant isolation
-- between two businesses can be tested; production keeps the default of 1.
-- =====================================================================================
SELECT qa.suite('01_fixtures');

DO $$
DECLARE
    ua uuid := '00000000-0000-4000-8000-0000000000a1';
    ub uuid := '00000000-0000-4000-8000-0000000000b2';
    uc uuid := '00000000-0000-4000-8000-0000000000c3';
    ud uuid := '00000000-0000-4000-8000-0000000000d4';
BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'founder.a@meridian.test', now(), now()),
           (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'founder.b@meridian.test', now(), now()),
           (uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stranger.c@meridian.test', now(), now()),
           (ud, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'latecomer.d@meridian.test', now(), now())
    ON CONFLICT (id) DO NOTHING;
    PERFORM qa.setid('user_a', ua); PERFORM qa.setid('user_b', ub); PERFORM qa.setid('user_c', uc); PERFORM qa.setid('user_d', ud);
    UPDATE public.installation_settings SET max_workspaces = 2;
END $$;

DO $$
DECLARE r text;
BEGIN
    -- default limit is 1 per installation; raised to 2 above for validation only
    PERFORM qa.as_user('a');
    r := qa.t('BOOT-01', 'founder A onboards through create_workspace()',
        $q$SELECT qa.setid('biz_a', public.create_workspace('Alpha Ventures', 'inr', 'en-IN', 'Asia/Kolkata', 'Asha Founder'))$q$, 'ok');
    PERFORM qa.v('BOOT-02', 'currency normalised to upper case and fixed', $q$SELECT base_currency FROM public.businesses$q$, 'INR');
    PERFORM qa.v('BOOT-03', 'founder participant created and linked to the profile',
        $q$SELECT participant_type || '/' || (profile_id = auth.uid())::text FROM public.participants$q$, 'founder/true');
    PERFORM qa.t('BOOT-04', 'founder A cannot create a second workspace',
        $q$SELECT public.create_workspace('Alpha Two', 'INR', 'en-IN', 'Asia/Kolkata', 'Asha')$q$, '23505');
    PERFORM qa.as_admin();

    PERFORM qa.as_user('b');
    PERFORM qa.t('BOOT-05', 'founder B onboards through create_workspace()',
        $q$SELECT qa.setid('biz_b', public.create_workspace('Beta Labs', 'INR', 'en-GB', 'Europe/London', 'Bilal Founder'))$q$, 'ok');
    PERFORM qa.as_admin();

    PERFORM qa.as_user('d');
    PERFORM qa.t('BOOT-06', 'a third workspace is refused by the installation limit',
        $q$SELECT public.create_workspace('Delta', 'INR', 'en-IN', 'Asia/Kolkata', 'Dev')$q$, '23505');
    PERFORM qa.as_admin();

    PERFORM qa.as_anon();
    PERFORM qa.t('BOOT-07', 'anonymous caller cannot create a workspace', $q$SELECT public.create_workspace('X', 'INR', 'en-IN', 'UTC', 'X')$q$, '42501');
    PERFORM qa.as_admin();
END $$;

-- domain fixtures created by each founder through RLS and column grants
DO $$
DECLARE ba uuid := qa.id('biz_a'); bb uuid := qa.id('biz_b'); v uuid;
BEGIN
    PERFORM qa.as_user('a');
    SELECT id INTO v FROM public.participants WHERE profile_id = auth.uid(); PERFORM qa.setid('part_a_founder', v);
    INSERT INTO public.participants (business_id, full_name, participant_type, agreed_equity_percentage)
        VALUES (ba, 'Chandra Cofounder', 'cofounder', 40) RETURNING id INTO v; PERFORM qa.setid('part_a_cofounder', v);
    UPDATE public.participants SET agreed_equity_percentage = 60 WHERE id = qa.id('part_a_founder');
    INSERT INTO public.contacts (business_id, first_name, category) VALUES (ba, 'Vera Vendor', 'Vendor') RETURNING id INTO v; PERFORM qa.setid('contact_a', v);
    INSERT INTO public.projects (business_id, name, status) VALUES (ba, 'Launch', 'Active') RETURNING id INTO v; PERFORM qa.setid('project_a', v);
    INSERT INTO public.financial_accounts (business_id, name, account_type, opening_balance, opening_balance_date)
        VALUES (ba, 'HDFC Current', 'bank', 10000, '2026-04-01') RETURNING id INTO v; PERFORM qa.setid('acct_a_bank1', v);
    INSERT INTO public.financial_accounts (business_id, name, account_type, opening_balance, opening_balance_date)
        VALUES (ba, 'ICICI Current', 'bank', 5000, '2026-04-01') RETURNING id INTO v; PERFORM qa.setid('acct_a_bank2', v);
    PERFORM qa.as_admin();

    PERFORM qa.as_user('b');
    INSERT INTO public.projects (business_id, name) VALUES (bb, 'Beta Project') RETURNING id INTO v; PERFORM qa.setid('project_b', v);
    SELECT id INTO v FROM public.participants WHERE profile_id = auth.uid(); PERFORM qa.setid('part_b_founder', v);
    INSERT INTO public.financial_accounts (business_id, name, account_type, opening_balance, opening_balance_date)
        VALUES (bb, 'Beta Bank', 'bank', 1000, '2026-04-01') RETURNING id INTO v; PERFORM qa.setid('acct_b', v);
    INSERT INTO public.funding_requirements (business_id, title, required_amount) VALUES (bb, 'Beta seed', 1000) RETURNING id INTO v; PERFORM qa.setid('req_b', v);
    INSERT INTO public.funding_commitments (business_id, requirement_id, funder_name, committed_amount)
        VALUES (bb, qa.id('req_b'), 'Beta angel', 1000) RETURNING id INTO v; PERFORM qa.setid('commit_b', v);
    INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, contribution_type, description)
        VALUES (bb, qa.id('acct_b'), '2026-05-01', 500, 'income', 'third_party_equity', 'Beta angel tranche') RETURNING id INTO v; PERFORM qa.setid('tx_b', v);
    INSERT INTO public.documents (business_id, title, category, storage_provider, storage_key, original_filename, mime_type, size_bytes, sha256)
        VALUES (bb, 'Beta MoU', 'Legal', 'supabase_storage', bb || '/mou.pdf', 'mou.pdf', 'application/pdf', 3, repeat('0', 64)) RETURNING id INTO v; PERFORM qa.setid('doc_b', v);
    PERFORM qa.as_admin();
    PERFORM qa.record('FIXTURES', 'domain fixtures created by founders through RLS', true, 'ok', 'ok');
EXCEPTION WHEN OTHERS THEN
    PERFORM qa.as_admin();
    PERFORM qa.record('FIXTURES', 'domain fixtures created by founders through RLS', false, 'ok', SQLSTATE || ' ' || SQLERRM);
END $$;

SELECT * FROM qa.results WHERE suite = '01_fixtures' ORDER BY seq;
