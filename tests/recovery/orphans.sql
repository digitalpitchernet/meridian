-- Referential integrity after a restore. Read-only; creates nothing.
-- The restore runs in replica mode, which skips foreign-key triggers, so FKs are re-checked here.
-- One row per foreign key in schema public (single and composite, MATCH SIMPLE: rows with a NULL key are skipped).
-- Pass: every orphans value is 0. Verified 8 Nov 2026: 84 FKs, 0 orphans on xwopffsacsctvjjwnxnw, and a
-- deliberately orphaned temp-table row was counted (1 of 3 rows, NULL row ignored).
SELECT c.conrelid::regclass::text AS child, c.conname,
  (xpath('/row/n/text()', query_to_xml(format(
     'SELECT count(*) AS n FROM %s ch WHERE ROW(%s) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s p WHERE ROW(%s) = ROW(%s))',
     c.conrelid::regclass, x.cc, c.confrelid::regclass, y.pc, x.cc), false, true, '')))[1]::text::int AS orphans
FROM pg_constraint c,
 LATERAL (SELECT string_agg(format('ch.%I', a.attname), ',' ORDER BY k.ord) cc FROM unnest(c.conkey) WITH ORDINALITY k(n, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) x,
 LATERAL (SELECT string_agg(format('p.%I', a.attname), ',' ORDER BY k.ord) pc FROM unnest(c.confkey) WITH ORDINALITY k(n, ord) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n) y
WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
ORDER BY 3 DESC, 1, 2;
