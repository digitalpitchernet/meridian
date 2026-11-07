-- =====================================================================================
-- Meridian Gate 1 SQL test harness. Lives in schema qa (never in migrations).
-- Run as postgres in a DISPOSABLE environment only. Drop with: DROP SCHEMA qa CASCADE;
--
-- Impersonation is exactly what PostgREST does per request: SET LOCAL role plus
-- request.jwt.claims. Every check is recorded in qa.results with what actually happened.
-- =====================================================================================
DROP SCHEMA IF EXISTS qa CASCADE;
CREATE SCHEMA qa;

CREATE TABLE qa.results (
    seq         bigserial PRIMARY KEY,
    suite       text NOT NULL,
    test_id     text NOT NULL,
    check_name  text NOT NULL,
    status      text NOT NULL CHECK (status IN ('PASS', 'FAIL', 'INFO')),
    expected    text,
    actual      text,
    run_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE qa.ids (k text PRIMARY KEY, v uuid NOT NULL);
CREATE TABLE qa.ctx (singleton boolean PRIMARY KEY DEFAULT true, suite text NOT NULL DEFAULT 'unset');
INSERT INTO qa.ctx DEFAULT VALUES;

GRANT USAGE ON SCHEMA qa TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA qa TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA qa TO anon, authenticated, service_role;

CREATE FUNCTION qa.suite(p text) RETURNS void LANGUAGE sql AS $$ UPDATE qa.ctx SET suite = p $$;
CREATE FUNCTION qa.setid(p_k text, p_v uuid) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO qa.ids VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v RETURNING v $$;
CREATE FUNCTION qa.id(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT v FROM qa.ids WHERE k = p_k $$;

-- role switching (transaction-local, like a PostgREST request)
CREATE FUNCTION qa.as_user(p_key text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_uid uuid := qa.id('user_' || p_key);
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION qa.as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('role', 'anon', true);
END $$;
CREATE FUNCTION qa.as_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('role', 'service_role', true);
END $$;
CREATE FUNCTION qa.as_admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('role', 'none', true);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

-- run a statement: 'OK <rows>' or '<SQLSTATE> <message>'
CREATE FUNCTION qa.run(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN 'OK ' || n;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- run a scalar query: its value as text, or '<SQLSTATE> <message>'
CREATE FUNCTION qa.val(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
    EXECUTE p_sql INTO v;
    RETURN COALESCE(v, 'NULL');
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

CREATE FUNCTION qa.record(p_test text, p_check text, p_pass boolean, p_expected text, p_actual text) RETURNS boolean LANGUAGE sql AS $$
    INSERT INTO qa.results (suite, test_id, check_name, status, expected, actual)
    SELECT c.suite, p_test, p_check, CASE WHEN p_pass THEN 'PASS' ELSE 'FAIL' END, p_expected, left(p_actual, 400) FROM qa.ctx c
    RETURNING status = 'PASS' $$;

-- expect: 'ok' (any success), 'ok:N' (success touching N rows), 'err' (any error), or an SQLSTATE prefix such as '42501'
CREATE FUNCTION qa.t(p_test text, p_check text, p_sql text, p_expect text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text := qa.run(p_sql); pass boolean;
BEGIN
    pass := CASE
        WHEN p_expect = 'ok' THEN r LIKE 'OK %'
        WHEN p_expect LIKE 'ok:%' THEN r = 'OK ' || substr(p_expect, 4)
        WHEN p_expect = 'err' THEN r NOT LIKE 'OK %'
        ELSE r LIKE p_expect || '%' END;
    PERFORM qa.record(p_test, p_check, pass, p_expect, r);
    RETURN r;
END $$;

-- expect a scalar value (compared as text)
CREATE FUNCTION qa.v(p_test text, p_check text, p_sql text, p_expected text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text := qa.val(p_sql);
BEGIN
    PERFORM qa.record(p_test, p_check, r = p_expected, p_expected, r);
    RETURN r;
END $$;

CREATE FUNCTION qa.info(p_test text, p_check text, p_actual text) RETURNS void LANGUAGE sql AS $$
    INSERT INTO qa.results (suite, test_id, check_name, status, actual) SELECT c.suite, p_test, p_check, 'INFO', left(p_actual, 400) FROM qa.ctx c $$;

CREATE FUNCTION qa.summary() RETURNS TABLE (suite text, pass bigint, fail bigint, info bigint) LANGUAGE sql AS $$
    SELECT suite, count(*) FILTER (WHERE status = 'PASS'), count(*) FILTER (WHERE status = 'FAIL'), count(*) FILTER (WHERE status = 'INFO')
    FROM qa.results GROUP BY suite ORDER BY min(seq) $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA qa TO anon, authenticated, service_role;

SELECT 'harness ready' AS status;
