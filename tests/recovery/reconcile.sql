-- Fingerprint of one Meridian database, as a single JSON document. Read-only; creates nothing.
-- Run on source and target; drill.mjs compares the two.
-- (Full-row md5 per public table; finance figures recomputed from the ledger; security posture.)
SELECT json_build_object(
  'migrations', (SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),
  'tables', (
    SELECT json_object_agg(t.tablename, json_build_object(
      'rows', (xpath('/row/c/text()', x))[1]::text::bigint,
      'md5',  (xpath('/row/h/text()', x))[1]::text))
    FROM pg_tables t,
    LATERAL query_to_xml(format(
      'SELECT count(*) AS c, md5(coalesce(string_agg(r::text, %L ORDER BY r::text), %L)) AS h FROM public.%I r',
      '|', '', t.tablename), false, true, '') AS x
    WHERE t.schemaname = 'public'),
  -- full rows as jsonb (key order fixed, independent of column position); md5 only, so no hash or token leaves the database
  'auth_users', (SELECT json_build_object('rows', count(*), 'ids', md5(coalesce(string_agg(u.id::text, '|' ORDER BY u.id), '')), 'md5', md5(coalesce(string_agg(to_jsonb(u)::text, '|' ORDER BY u.id), ''))) FROM auth.users u),
  'auth_identities', (SELECT json_build_object('rows', count(*), 'md5', md5(coalesce(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), ''))) FROM auth.identities i),
  -- every column of every object, keyed by bucket/name, so each field is compared and classified on its own (R-10)
  'storage_objects', (SELECT json_build_object('rows', count(*), 'objects', coalesce(json_object_agg(o.bucket_id || '/' || o.name, to_jsonb(o) - 'bucket_id' - 'name'), '{}'::json)) FROM storage.objects o),
  -- money as numeric(15,2) TEXT: JSON.parse would turn 1500.00 into 1500 and hide a scale difference
  'finance', (
    SELECT json_object_agg(b.id, json_build_object(
      'available_cash', (SELECT coalesce(sum(balance) FILTER (WHERE counts_as_available_cash AND is_active), 0)::numeric(15,2)::text FROM public.compute_account_balances(b.id, DATE '2100-01-01')),
      'balances', (SELECT json_object_agg(account_id, balance::numeric(15,2)::text) FROM public.compute_account_balances(b.id, DATE '2100-01-01')),
      'tx_live_sum', (SELECT coalesce(sum(amount), 0)::numeric(15,2)::text FROM public.transactions WHERE business_id = b.id AND NOT is_reversed),
      'tx_reversed', (SELECT count(*) FROM public.transactions WHERE business_id = b.id AND is_reversed),
      'alloc_live_sum', (SELECT coalesce(sum(amount), 0)::numeric(15,2)::text FROM public.payment_allocations WHERE business_id = b.id AND NOT is_reversed),
      'commitment_status', (SELECT json_object_agg(status, n) FROM (SELECT status, count(*) n FROM public.vw_funding_commitment_status WHERE business_id = b.id GROUP BY status) s),
      'document_sha256', (SELECT md5(coalesce(string_agg(sha256, '|' ORDER BY sha256), '')) FROM public.documents WHERE business_id = b.id)))
    FROM public.businesses b),
  -- R-12 security posture. Scope: schema public (every Meridian object, including its triggers), the public and
  -- storage schema ACLs, default privileges, storage policies and buckets. Deliberately excluded (runbook §7):
  -- functions, triggers, grants and ACLs inside auth, storage, realtime, extensions and other platform schemas
  -- (Supabase-owned; the three tables the restore writes are covered by R-01a), the qa test schema (never restored),
  -- and bucket created_at/updated_at (set when migration 6 runs on each project).
  'security', json_build_object(
    'relation_acl', (SELECT json_object_agg(c.relname, c.relkind::text || ' owner=' || pg_get_userbyid(c.relowner) || ' acl=' || coalesce(c.relacl::text, 'default') ORDER BY c.relname)
                     FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')),
    'column_acl', (SELECT json_object_agg(c.relname || '.' || a.attname, a.attacl::text ORDER BY c.relname, a.attname)
                   FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                   WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL),
    'rls', (SELECT json_object_agg(relname, json_build_object('enabled', relrowsecurity, 'forced', relforcerowsecurity) ORDER BY relname)
            FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')),
    'view_options', (SELECT json_object_agg(relname, coalesce(array_to_string(reloptions, ','), '') ORDER BY relname)
                     FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('v', 'm')),
    'schema_acl', (SELECT json_object_agg(nspname, 'owner=' || pg_get_userbyid(nspowner) || ' acl=' || coalesce(nspacl::text, 'default') ORDER BY nspname)
                   FROM pg_namespace WHERE nspname IN ('public', 'storage')),
    'default_acl', (SELECT json_agg(pg_get_userbyid(defaclrole) || ' ' || coalesce(nullif(defaclnamespace, 0)::regnamespace::text, '(global)') || ' ' || defaclobjtype::text || ' ' || coalesce(defaclacl::text, '')
                                    ORDER BY pg_get_userbyid(defaclrole), defaclnamespace, defaclobjtype)
                    FROM pg_default_acl WHERE defaclnamespace IN (0, 'public'::regnamespace)),
    'policies', (SELECT json_object_agg(schemaname || '.' || tablename || '.' || policyname,
                        permissive || ' ' || array_to_string(roles, ',') || ' ' || cmd || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '') ORDER BY schemaname, tablename, policyname)
                 FROM pg_policies WHERE schemaname IN ('public', 'storage')),
    'functions', (SELECT json_object_agg(p.oid::regprocedure::text, json_build_object(
                        'definition_md5', CASE WHEN p.prokind IN ('f', 'p') THEN md5(pg_get_functiondef(p.oid)) END,
                        'security_definer', p.prosecdef, 'config', p.proconfig, 'volatility', p.provolatile,
                        'leakproof', p.proleakproof, 'owner', pg_get_userbyid(p.proowner), 'acl', coalesce(p.proacl::text, 'default')) ORDER BY p.oid::regprocedure::text)
                  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
    -- application triggers only (schema public, 55 today). Platform triggers (storage, realtime: 12 today) are not
    -- compared here; those on the tables the restore writes (storage.objects, auth.users, auth.identities) are in R-01a.
    'triggers', (SELECT json_object_agg(c.relname || '.' || t.tgname, t.tgenabled::text || ' ' || md5(pg_get_triggerdef(t.oid)) ORDER BY c.relname, t.tgname)
                 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                 WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace),
    'buckets', (SELECT json_object_agg(b.id, to_jsonb(b) - 'created_at' - 'updated_at' ORDER BY b.id) FROM storage.buckets b))
);
