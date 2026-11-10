-- Validation harness. Lives in schema qa so it survives the down migrations.
-- Not part of Meridian. Drop with: DROP SCHEMA qa CASCADE;

DROP SCHEMA IF EXISTS qa CASCADE;
CREATE SCHEMA qa;

CREATE TABLE qa.results (
    seq SERIAL PRIMARY KEY,
    run TEXT NOT NULL DEFAULT 'run1',
    test_id TEXT NOT NULL,
    check_name TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE qa.ids (k TEXT PRIMARY KEY, v UUID NOT NULL);
CREATE TABLE qa.snapshots (label TEXT NOT NULL, obj TEXT NOT NULL, PRIMARY KEY (label, obj));

GRANT USAGE ON SCHEMA qa TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA qa TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA qa TO anon, authenticated, service_role;

-- result line packed as text so it survives a rolled-back sandbox block
CREATE FUNCTION qa.r(p_test TEXT, p_check TEXT, p_pass BOOLEAN, p_detail TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT p_test || chr(31) || p_check || chr(31) ||
           CASE WHEN p_pass IS NULL THEN 'INFO' WHEN p_pass THEN 'PASS' ELSE 'FAIL' END ||
           chr(31) || COALESCE(p_detail, '')
$$;

CREATE FUNCTION qa.flush(p_lines TEXT[]) RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO qa.results (test_id, check_name, status, detail)
    SELECT split_part(l, chr(31), 1), split_part(l, chr(31), 2), split_part(l, chr(31), 3), split_part(l, chr(31), 4)
    FROM unnest(p_lines) WITH ORDINALITY AS t(l, n) ORDER BY n
$$;

CREATE FUNCTION qa.setid(p_k TEXT, p_v UUID) RETURNS UUID LANGUAGE sql AS $$
    INSERT INTO qa.ids VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v RETURNING v
$$;
CREATE FUNCTION qa.id(p_k TEXT) RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT v FROM qa.ids WHERE k = p_k $$;

-- Impersonation exactly as PostgREST does it: role + request.jwt.claims, transaction-local.
CREATE FUNCTION qa.login(p_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::TEXT, TRUE);
    PERFORM set_config('request.jwt.claim.sub', p_uid::TEXT, TRUE);
    PERFORM set_config('role', 'authenticated', TRUE);
END $$;

CREATE FUNCTION qa.login_anon() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', TRUE);
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
    PERFORM set_config('role', 'anon', TRUE);
END $$;

CREATE FUNCTION qa.login_service() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
    PERFORM set_config('role', 'service_role', TRUE);
END $$;

CREATE FUNCTION qa.logout() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('role', 'none', TRUE);
    PERFORM set_config('request.jwt.claims', '', TRUE);
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
END $$;

-- Run a statement; return 'OK <rowcount>' or '<SQLSTATE> <message>'. Effects persist on success.
CREATE FUNCTION qa.try(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN 'OK ' || n;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- Run a scalar query; return its value as text or '<SQLSTATE> <message>'.
CREATE FUNCTION qa.val(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
    EXECUTE p_sql INTO v;
    RETURN v;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- Native balance of an account as of p_date, exactly per spec Section 5.2 B_a(D).
CREATE FUNCTION qa.native_balance(p_account UUID, p_date DATE DEFAULT '2099-12-31') RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT a.opening_balance
        + COALESCE((SELECT SUM(t.amount) FROM public.transactions t WHERE t.account_id = a.id AND t.type = 'income'
                    AND NOT t.is_reversed AND t.is_cleared AND t.date BETWEEN a.opening_balance_date AND p_date), 0)
        + COALESCE((SELECT SUM(t.transfer_to_amount) FROM public.transactions t WHERE t.transfer_to_account_id = a.id AND t.type = 'transfer'
                    AND NOT t.is_reversed AND t.is_cleared AND t.date BETWEEN a.opening_balance_date AND p_date), 0)
        - COALESCE((SELECT SUM(t.amount) FROM public.transactions t WHERE t.account_id = a.id AND t.type IN ('expense', 'transfer')
                    AND NOT t.is_reversed AND t.is_cleared AND t.date BETWEEN a.opening_balance_date AND p_date), 0)
    FROM public.financial_accounts a WHERE a.id = p_account
$$;

-- Base-currency contribution of one account, exactly per spec Section 5.2 (opening at a.rate, movements at t.rate).
CREATE FUNCTION qa.base_value(p_account UUID, p_date DATE DEFAULT '2099-12-31') RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT round(a.opening_balance * a.exchange_rate_to_base, 2)
        + COALESCE((SELECT SUM(round(t.amount * t.exchange_rate_to_base, 2)) FROM public.transactions t WHERE t.account_id = a.id AND t.type = 'income'
                    AND NOT t.is_reversed AND t.is_cleared AND t.date BETWEEN a.opening_balance_date AND p_date), 0)
        + COALESCE((SELECT SUM(round(t.amount * t.exchange_rate_to_base, 2)) FROM public.transactions t WHERE t.transfer_to_account_id = a.id AND t.type = 'transfer'
                    AND NOT t.is_reversed AND t.is_cleared AND t.date BETWEEN a.opening_balance_date AND p_date), 0)
        - COALESCE((SELECT SUM(round(t.amount * t.exchange_rate_to_base, 2)) FROM public.transactions t WHERE t.account_id = a.id AND t.type IN ('expense', 'transfer')
                    AND NOT t.is_reversed AND t.is_cleared AND t.date BETWEEN a.opening_balance_date AND p_date), 0)
    FROM public.financial_accounts a WHERE a.id = p_account
$$;

CREATE FUNCTION qa.available_cash(p_business UUID, p_date DATE DEFAULT '2099-12-31') RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(qa.base_value(a.id, p_date)), 0)
    FROM public.financial_accounts a
    WHERE a.business_id = p_business AND a.is_active AND a.type IN ('bank', 'cash')
$$;

-- Catalog inventory used by the up/down/up comparison.
CREATE FUNCTION qa.snapshot(p_label TEXT) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE n INTEGER;
BEGIN
    DELETE FROM qa.snapshots WHERE label = p_label;
    INSERT INTO qa.snapshots (label, obj)
    SELECT p_label, o FROM (
        SELECT 'rel:' || c.relkind::TEXT || ':' || c.relname AS o FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'i', 'S')
        UNION SELECT 'fn:' || p.oid::regprocedure::TEXT || ':owner=' || pg_get_userbyid(p.proowner) || ':secdef=' || p.prosecdef
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
        UNION SELECT 'trg:' || c.relname || ':' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal
        UNION SELECT 'con:' || c.relname || ':' || k.conname || ':' || pg_get_constraintdef(k.oid) FROM pg_constraint k
            JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
        UNION SELECT 'pol:' || schemaname || '.' || tablename || ':' || policyname FROM pg_policies WHERE schemaname IN ('public', 'storage')
            AND (schemaname = 'public' OR policyname LIKE 'vault_%')
        UNION SELECT 'rls:' || c.relname || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
        UNION SELECT 'acl:' || c.relname || ':' || COALESCE(c.relacl::TEXT, 'default') FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
        UNION SELECT 'facl:' || p.oid::regprocedure::TEXT || ':' || COALESCE(p.proacl::TEXT, 'default') FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
        UNION SELECT 'bucket:' || id FROM storage.buckets WHERE id = 'company_vault'
    ) s;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

SELECT 'harness ready' AS status, current_user, version();
