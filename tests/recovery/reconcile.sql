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
  'auth_users', (SELECT json_build_object('rows', count(*), 'md5', md5(coalesce(string_agg(id::text || ':' || coalesce(email, ''), '|' ORDER BY id), ''))) FROM auth.users),
  'auth_identities', (SELECT count(*) FROM auth.identities),
  'storage_objects', (SELECT json_build_object('rows', count(*), 'md5', md5(coalesce(string_agg(bucket_id || '/' || name, '|' ORDER BY bucket_id, name), ''))) FROM storage.objects),
  'finance', (
    SELECT json_object_agg(b.id, json_build_object(
      'available_cash', (SELECT coalesce(sum(balance) FILTER (WHERE counts_as_available_cash AND is_active), 0)::numeric(15,2) FROM public.compute_account_balances(b.id, DATE '2100-01-01')),
      'balances', (SELECT json_object_agg(account_id, balance::numeric(15,2)) FROM public.compute_account_balances(b.id, DATE '2100-01-01')),
      'tx_live_sum', (SELECT coalesce(sum(amount), 0) FROM public.transactions WHERE business_id = b.id AND NOT is_reversed),
      'tx_reversed', (SELECT count(*) FROM public.transactions WHERE business_id = b.id AND is_reversed),
      'alloc_live_sum', (SELECT coalesce(sum(amount), 0) FROM public.payment_allocations WHERE business_id = b.id AND NOT is_reversed),
      'commitment_status', (SELECT json_object_agg(status, n) FROM (SELECT status, count(*) n FROM public.vw_funding_commitment_status WHERE business_id = b.id GROUP BY status) s),
      'document_sha256', (SELECT md5(coalesce(string_agg(sha256, '|' ORDER BY sha256), '')) FROM public.documents WHERE business_id = b.id)))
    FROM public.businesses b),
  'security', json_build_object(
    'table_grants', (SELECT md5(string_agg(grantee || ':' || table_name || ':' || privilege_type, '|' ORDER BY grantee, table_name, privilege_type)) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'service_role')),
    'column_grants', (SELECT md5(string_agg(grantee || ':' || table_name || '.' || column_name || ':' || privilege_type, '|' ORDER BY 1)) FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'service_role')),
    'policies', (SELECT md5(string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' ORDER BY 1)) FROM pg_policies WHERE schemaname IN ('public', 'storage')),
    'rls_enabled', (SELECT json_agg(relname ORDER BY relname) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity),
    'function_acl', (SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce(p.proacl::text, 'default') || ':' || p.prosecdef::text, '|' ORDER BY 1)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
    'triggers', (SELECT md5(string_agg(tgrelid::regclass::text || ':' || tgname || ':' || tgenabled::text, '|' ORDER BY 1)) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'qa.%'),
    'bucket', (SELECT json_agg(json_build_object('id', id, 'public', public, 'limit', file_size_limit)) FROM storage.buckets))
);
