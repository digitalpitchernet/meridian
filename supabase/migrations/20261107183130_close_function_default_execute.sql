-- =====================================================================================
-- Meridian V1 · Gate 1 · Migration 8: close PostgreSQL's built-in PUBLIC EXECUTE on
-- new functions. Found by test SEC-ANON-09 / SEC-FN-01 on 2026-11-08.
--
-- Root cause: a schema-scoped "ALTER DEFAULT PRIVILEGES ... IN SCHEMA public REVOKE
-- EXECUTE ... FROM PUBLIC" cannot remove the built-in default (schema-level defaults only
-- add to the global ones). Migrations 2-6 revoked per function explicitly, so only the
-- four helpers created first in migration 1 kept PUBLIC (hence anon) EXECUTE. They are
-- trigger functions (not directly callable), but the baseline must fail closed for every
-- future function too.
-- =====================================================================================
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE ALL ON FUNCTION public.set_updated_at(), public.reject_mutation(),
    public.guard_business_identity(), public.guard_profile_identity() FROM PUBLIC, anon, authenticated;
