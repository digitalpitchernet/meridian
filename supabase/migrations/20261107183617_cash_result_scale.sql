-- =====================================================================================
-- Meridian V1 · Gate 1 · Migration 9: get_available_cash() always returns 2-decimal money.
-- Found by test CASH-14 on 2026-11-08: with no open accounts the function returned the
-- integer literal 0 (PL/pgSQL RETURN does not apply the declared numeric(15,2) scale),
-- so API clients saw 0 instead of 0.00.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.get_available_cash(p_as_of date DEFAULT NULL)
RETURNS numeric(15,2) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_bid uuid := public.get_current_business_id();
BEGIN
    IF v_bid IS NULL THEN RAISE EXCEPTION 'no workspace for the current user' USING ERRCODE = 'insufficient_privilege'; END IF;
    RETURN (SELECT COALESCE(SUM(balance), 0)::numeric(15,2)
            FROM public.compute_account_balances(v_bid, COALESCE(p_as_of, public.business_local_date(v_bid)))
            WHERE counts_as_available_cash);
END $$;
