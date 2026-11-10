-- =====================================================================================
-- Meridian V1 · Gate 1 · Migration 7: pin search_path on every remaining function.
-- Found by the Supabase security advisor (lint 0011) after migrations 1-6. All object
-- references in these functions are already schema-qualified; pinning removes any
-- dependence on the caller's search_path.
-- =====================================================================================
ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.reject_mutation() SET search_path = '';
ALTER FUNCTION public.guard_business_identity() SET search_path = '';
ALTER FUNCTION public.guard_profile_identity() SET search_path = '';
ALTER FUNCTION public.sync_task_completion() SET search_path = '';
ALTER FUNCTION public.guard_funding_commitment() SET search_path = '';
ALTER FUNCTION public.guard_transaction_insert() SET search_path = '';
ALTER FUNCTION public.guard_transaction_update() SET search_path = '';
ALTER FUNCTION public.guard_allocation_insert() SET search_path = '';
ALTER FUNCTION public.guard_allocation_update() SET search_path = '';
ALTER FUNCTION public.prepare_import_row() SET search_path = '';
ALTER FUNCTION public.guard_import_batch() SET search_path = '';
ALTER FUNCTION public.guard_import_row_delete() SET search_path = '';
