-- Definition of the three Supabase-owned tables the restore writes into, as one JSON document. Read-only.
-- drill.mjs (R-01a) runs it on source and target BEFORE any write and stops on any difference in 'tables'.
-- Per column: type, nullability, default or generation expression, identity, generated flag, collation.
-- Per table: every constraint definition, every index definition, every trigger definition.
-- 'platform_versions' (GoTrue and Storage migration levels) is reported, not compared: the definitions are what the
-- restore depends on, and a version difference with identical definitions is recorded as a classified difference.
SELECT json_build_object(
  'tables', (
    SELECT json_object_agg(c.oid::regclass::text, json_build_object(
      'columns', (SELECT json_object_agg(a.attname, json_build_object(
                      'type', format_type(a.atttypid, a.atttypmod),
                      'not_null', a.attnotnull,
                      'default', pg_get_expr(d.adbin, d.adrelid),
                      'identity', a.attidentity,
                      'generated', a.attgenerated,
                      'collation', co.collname) ORDER BY a.attname)
                  FROM pg_attribute a
                  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                  LEFT JOIN pg_collation co ON co.oid = a.attcollation
                  WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
      'constraints', (SELECT json_object_agg(conname, pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid = c.oid),
      'indexes', (SELECT json_object_agg(i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid) ORDER BY 1) FROM pg_index i WHERE i.indrelid = c.oid),
      'triggers', (SELECT json_object_agg(tgname, pg_get_triggerdef(oid) || ' [' || tgenabled::text || ']' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = c.oid AND NOT tgisinternal))
      ORDER BY 1)
    FROM pg_class c
    WHERE c.oid IN ('auth.users'::regclass, 'auth.identities'::regclass, 'storage.objects'::regclass)),
  'platform_versions', json_build_object(
    'auth', (SELECT max(version) FROM auth.schema_migrations),
    'storage', (SELECT max(id) || ' ' || max(name) FILTER (WHERE id = (SELECT max(id) FROM storage.migrations)) FROM storage.migrations))
);
