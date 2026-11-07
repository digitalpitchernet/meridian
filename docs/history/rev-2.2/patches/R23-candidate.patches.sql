-- ====================================================================================================
-- MER-ENG-SPEC-001 Rev 2.2 -> Rev 2.3 CANDIDATE CORRECTIONS (proposed by Gavin, NOT approved)
-- Applied ON TOP of Rev 2.2 in the disposable validation project only, to prove each fix works.
-- For Rev 2.3 each block should be folded into its home migration rather than shipped stacked.
-- Blocks marked [NEEDS APPROVAL] change behaviour that Atlas/Aurelian own.
-- Down-script corrections (D-01, D-02) are in down.all.corrected.sql; RLS placement (D-03) is a
-- restructuring recommendation in the report, not a forward patch.
-- ====================================================================================================

-- ---------------------------------------------------------------------------------------------
-- P-01 (D-04, concern 1) home 00003: shared currency trigger crashed on capital_targets (42703)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_capital_currency_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_struct_currency CHAR(3);
    v_target_id UUID;
    v_target_structure_id UUID;
    v_target_currency CHAR(3);
BEGIN
    SELECT currency INTO v_struct_currency
    FROM public.capital_structures
    WHERE business_id = NEW.business_id AND id = NEW.structure_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Capital structure % not found in business %', NEW.structure_id, NEW.business_id;
    END IF;
    IF NEW.currency <> v_struct_currency THEN
        RAISE EXCEPTION 'Currency (%) on % must match parent capital_structures.currency (%)',
            NEW.currency, TG_TABLE_NAME, v_struct_currency;
    END IF;

    IF TG_TABLE_NAME = 'participant_capital_allocations' THEN
        -- read through jsonb so the same function compiles for capital_targets rows
        v_target_id := (to_jsonb(NEW) ->> 'capital_target_id')::UUID;
        IF v_target_id IS NOT NULL THEN
            SELECT structure_id, currency INTO v_target_structure_id, v_target_currency
            FROM public.capital_targets
            WHERE business_id = NEW.business_id AND id = v_target_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Capital target % not found in business %', v_target_id, NEW.business_id;
            END IF;
            IF v_target_structure_id <> NEW.structure_id THEN
                RAISE EXCEPTION 'Capital target % does not belong to capital structure %', v_target_id, NEW.structure_id;
            END IF;
            IF NEW.currency <> v_target_currency THEN
                RAISE EXCEPTION 'Participant allocation currency (%) must match capital_targets.currency (%)',
                    NEW.currency, v_target_currency;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- P-02 (concern 1) home 00003: target-level summary + target totals on the structure summary.
-- Additive and read-only: surfaces discrepancies, never blocks or alters allocations.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_capital_target_allocation_summary
WITH (security_invoker = true)
AS
SELECT
    ct.business_id,
    ct.structure_id,
    ct.id AS capital_target_id,
    ct.name,
    ct.currency,
    ct.target_amount,
    COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active), 0.00) AS total_participant_allocated,
    GREATEST(0.00, ct.target_amount - COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active), 0.00)) AS unallocated_amount,
    GREATEST(0.00, COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active), 0.00) - ct.target_amount) AS over_allocated_amount,
    CASE
        WHEN COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active), 0.00) < ct.target_amount THEN 'under_allocated'
        WHEN COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active), 0.00) = ct.target_amount THEN 'fully_allocated'
        ELSE 'over_allocated'
    END AS allocation_status
FROM public.capital_targets ct
LEFT JOIN public.participant_capital_allocations pca
    ON pca.business_id = ct.business_id AND pca.capital_target_id = ct.id
GROUP BY ct.business_id, ct.structure_id, ct.id, ct.name, ct.currency, ct.target_amount;

CREATE OR REPLACE VIEW public.vw_capital_structure_allocation_summary
WITH (security_invoker = true)
AS
SELECT
    cs.business_id,
    cs.id AS structure_id,
    cs.title,
    cs.currency,
    cs.agreed_capital_target,
    COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active = TRUE), 0.00) AS total_participant_allocated,
    GREATEST(0.00, cs.agreed_capital_target - COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active = TRUE), 0.00)) AS unallocated_amount,
    GREATEST(0.00, COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active = TRUE), 0.00) - cs.agreed_capital_target) AS over_allocated_amount,
    CASE
        WHEN COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active = TRUE), 0.00) < cs.agreed_capital_target THEN 'under_allocated'
        WHEN COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active = TRUE), 0.00) = cs.agreed_capital_target THEN 'fully_allocated'
        ELSE 'over_allocated'
    END AS allocation_status,
    COALESCE((SELECT SUM(ct.target_amount) FROM public.capital_targets ct
              WHERE ct.business_id = cs.business_id AND ct.structure_id = cs.id), 0.00) AS total_capital_targets,
    GREATEST(0.00, COALESCE((SELECT SUM(ct.target_amount) FROM public.capital_targets ct
              WHERE ct.business_id = cs.business_id AND ct.structure_id = cs.id), 0.00) - cs.agreed_capital_target) AS targets_exceed_structure_by,
    (SELECT COUNT(*) FROM public.vw_capital_target_allocation_summary t
      WHERE t.business_id = cs.business_id AND t.structure_id = cs.id AND t.allocation_status = 'over_allocated') AS over_allocated_target_count
FROM public.capital_structures cs
LEFT JOIN public.participant_capital_allocations pca
    ON pca.business_id = cs.business_id AND pca.structure_id = cs.id
GROUP BY cs.business_id, cs.id, cs.title, cs.currency, cs.agreed_capital_target;

-- ---------------------------------------------------------------------------------------------
-- P-03 (concern 2) homes 00001/00003/00004: a parent's currency is frozen once children exist
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_parent_currency_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE v_has_children BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'capital_structures' THEN
        IF NEW.currency IS NOT DISTINCT FROM OLD.currency THEN RETURN NEW; END IF;
        v_has_children := EXISTS (SELECT 1 FROM public.capital_targets WHERE business_id = OLD.business_id AND structure_id = OLD.id)
                       OR EXISTS (SELECT 1 FROM public.participant_capital_allocations WHERE business_id = OLD.business_id AND structure_id = OLD.id);
    ELSIF TG_TABLE_NAME = 'funding_requirements' THEN
        IF NEW.currency IS NOT DISTINCT FROM OLD.currency THEN RETURN NEW; END IF;
        v_has_children := EXISTS (SELECT 1 FROM public.funding_commitments WHERE business_id = OLD.business_id AND requirement_id = OLD.id);
    ELSIF TG_TABLE_NAME = 'financial_accounts' THEN
        IF NEW.currency IS NOT DISTINCT FROM OLD.currency THEN RETURN NEW; END IF;
        v_has_children := EXISTS (SELECT 1 FROM public.transactions WHERE business_id = OLD.business_id AND (account_id = OLD.id OR transfer_to_account_id = OLD.id))
                       OR EXISTS (SELECT 1 FROM public.import_batches WHERE business_id = OLD.business_id AND account_id = OLD.id)
                       OR EXISTS (SELECT 1 FROM public.recurring_transactions WHERE business_id = OLD.business_id AND account_id = OLD.id);
    ELSIF TG_TABLE_NAME = 'businesses' THEN
        IF NEW.base_currency IS NOT DISTINCT FROM OLD.base_currency THEN RETURN NEW; END IF;
        v_has_children := EXISTS (SELECT 1 FROM public.transactions WHERE business_id = OLD.id)
                       OR EXISTS (SELECT 1 FROM public.financial_accounts WHERE business_id = OLD.id);
    END IF;
    IF v_has_children THEN
        RAISE EXCEPTION '% currency cannot change once dependent records exist; create a new record instead', TG_TABLE_NAME
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_freeze_capital_structure_currency BEFORE UPDATE OF currency ON public.capital_structures
FOR EACH ROW EXECUTE FUNCTION public.prevent_parent_currency_change();
CREATE TRIGGER trg_freeze_requirement_currency BEFORE UPDATE OF currency ON public.funding_requirements
FOR EACH ROW EXECUTE FUNCTION public.prevent_parent_currency_change();
CREATE TRIGGER trg_freeze_account_currency BEFORE UPDATE OF currency ON public.financial_accounts
FOR EACH ROW EXECUTE FUNCTION public.prevent_parent_currency_change();
CREATE TRIGGER trg_freeze_base_currency BEFORE UPDATE OF base_currency ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.prevent_parent_currency_change();

-- ---------------------------------------------------------------------------------------------
-- P-04 (concern 3) home 00005: transfer legs must reconcile in base currency.
-- Enforceable today only when one leg is the base currency. [NEEDS APPROVAL] for the general
-- case: add transactions.transfer_to_exchange_rate_to_base and require both legs to value equally.
-- Also rejects a non-base transaction that kept the default rate of 1 (a pegged 1:1 currency
-- would need an explicit override flag -- limitation recorded in the report).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_transfer_reconciliation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE v_base CHAR(3); v_dst CHAR(3);
BEGIN
    SELECT base_currency INTO v_base FROM public.businesses WHERE id = NEW.business_id;
    IF NEW.currency <> v_base AND NEW.exchange_rate_to_base = 1 THEN
        RAISE EXCEPTION 'Transaction in % needs an explicit exchange_rate_to_base into %', NEW.currency, v_base
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.type = 'transfer' THEN
        SELECT currency INTO v_dst FROM public.financial_accounts
        WHERE business_id = NEW.business_id AND id = NEW.transfer_to_account_id;
        IF v_dst = v_base AND NEW.currency <> v_base
           AND NEW.transfer_to_amount <> round(NEW.amount * NEW.exchange_rate_to_base, 2) THEN
            RAISE EXCEPTION 'Transfer legs do not reconcile: % % at % = % %, but transfer_to_amount is %',
                NEW.amount, NEW.currency, NEW.exchange_rate_to_base, round(NEW.amount * NEW.exchange_rate_to_base, 2), v_base, NEW.transfer_to_amount
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_transfer_reconciliation BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_transfer_reconciliation();

-- ---------------------------------------------------------------------------------------------
-- P-05 (FIN-X1/X2/X5, concern 4 support) home 00005: financial history protection on transactions
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_transaction_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.is_reversed AND NOT NEW.is_reversed THEN
        RAISE EXCEPTION 'Transaction % is reversed; reversal cannot be undone', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.is_reversed AND NEW.reversed_by_id IS DISTINCT FROM OLD.reversed_by_id THEN
        RAISE EXCEPTION 'Transaction % is already reversed by %', OLD.id, OLD.reversed_by_id USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.amount, NEW.currency, NEW.type, NEW.account_id, NEW.transfer_to_account_id, NEW.transfer_to_amount,
        NEW.participant_id, NEW.is_personal_founder_payment, NEW.exchange_rate_to_base, NEW.date)
       IS DISTINCT FROM
       (OLD.amount, OLD.currency, OLD.type, OLD.account_id, OLD.transfer_to_account_id, OLD.transfer_to_amount,
        OLD.participant_id, OLD.is_personal_founder_payment, OLD.exchange_rate_to_base, OLD.date)
    THEN
        IF OLD.is_reversed THEN
            RAISE EXCEPTION 'Reversed transaction % is immutable', OLD.id USING ERRCODE = 'check_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM public.payment_allocations
                   WHERE business_id = OLD.business_id AND transaction_id = OLD.id AND NOT is_reversed) THEN
            RAISE EXCEPTION 'Transaction % has active payment allocations; reverse it and record a replacement', OLD.id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_transaction_history BEFORE UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.protect_transaction_history();

-- reimbursable founder expenses start as 'pending' (FIN-06x)
CREATE OR REPLACE FUNCTION public.default_reimbursement_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.contribution_type = 'reimbursable_expense' AND NEW.reimbursement_status = 'not_applicable' THEN
        NEW.reimbursement_status := 'pending';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_default_reimbursement_status BEFORE INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.default_reimbursement_status();

-- ---------------------------------------------------------------------------------------------
-- P-06 (FIN-X3/X4) home 00005: commitment status is always derived from active allocations;
-- clients may only set 'revoked'. [NEEDS APPROVAL] -- makes status read-only except revoke.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_commitment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE v_allocated NUMERIC(15,2);
BEGIN
    IF NEW.status = 'revoked' THEN
        RETURN NEW;
    END IF;
    SELECT COALESCE(SUM(amount), 0.00) INTO v_allocated
    FROM public.payment_allocations
    WHERE business_id = NEW.business_id AND commitment_id = NEW.id AND NOT is_reversed;
    NEW.status := CASE
        WHEN v_allocated = 0 THEN 'pledged'
        WHEN v_allocated < NEW.committed_amount THEN 'partially_paid'
        WHEN v_allocated = NEW.committed_amount THEN 'fulfilled'
        ELSE 'over_allocated'
    END;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_derive_commitment_status BEFORE INSERT OR UPDATE ON public.funding_commitments
FOR EACH ROW EXECUTE FUNCTION public.derive_commitment_status();

-- ---------------------------------------------------------------------------------------------
-- P-07 (concern 4) home 00005: commit_import_batch validates every overwrite target first.
-- Target must exist in the batch's business AND account, be unreversed income/expense, not a
-- personal payment, and be targeted by at most one row. Targets are locked FOR UPDATE.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_import_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_batch RECORD;
    v_account_currency CHAR(3);
    v_account_fx NUMERIC(18,8);
    v_row RECORD;
    v_target RECORD;
    v_row_currency CHAR(3);
    v_row_fx NUMERIC(18,8);
    v_imported_count INTEGER := 0;
    v_skipped_count INTEGER := 0;
    v_new_tx_id UUID;
BEGIN
    SELECT * INTO v_batch FROM public.import_batches WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Import batch % not found', p_batch_id;
    END IF;
    IF v_batch.status = 'committed' THEN
        RETURN jsonb_build_object('status', 'already_committed', 'batch_id', p_batch_id);
    END IF;
    IF v_batch.status <> 'staged' THEN
        RAISE EXCEPTION 'Import batch % cannot be committed from status %', p_batch_id, v_batch.status;
    END IF;

    SELECT currency, exchange_rate_to_base INTO v_account_currency, v_account_fx
    FROM public.financial_accounts
    WHERE business_id = v_batch.business_id AND id = v_batch.account_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target financial account % not found for batch %', v_batch.account_id, p_batch_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.import_batch_rows
        WHERE batch_id = p_batch_id
          AND ((has_potential_duplicate = TRUE AND resolution = 'pending') OR row_status = 'error')
    ) THEN
        RAISE EXCEPTION 'Batch % contains unresolved duplicate warnings or validation errors', p_batch_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.import_batch_rows
        WHERE batch_id = p_batch_id AND resolution = 'overwrite'
        GROUP BY target_overwrite_transaction_id HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Batch % overwrites the same transaction from more than one row', p_batch_id;
    END IF;

    FOR v_row IN
        SELECT raw_row_index, target_overwrite_transaction_id FROM public.import_batch_rows
        WHERE batch_id = p_batch_id AND resolution = 'overwrite'
        ORDER BY raw_row_index
    LOOP
        SELECT account_id, type, is_reversed, is_personal_founder_payment INTO v_target
        FROM public.transactions
        WHERE business_id = v_batch.business_id AND id = v_row.target_overwrite_transaction_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Row %: overwrite target % not found in this business', v_row.raw_row_index, v_row.target_overwrite_transaction_id;
        END IF;
        IF v_target.account_id IS DISTINCT FROM v_batch.account_id THEN
            RAISE EXCEPTION 'Row %: overwrite target % belongs to a different account', v_row.raw_row_index, v_row.target_overwrite_transaction_id;
        END IF;
        IF v_target.is_reversed THEN
            RAISE EXCEPTION 'Row %: overwrite target % is already reversed', v_row.raw_row_index, v_row.target_overwrite_transaction_id;
        END IF;
        IF v_target.type NOT IN ('income', 'expense') OR v_target.is_personal_founder_payment THEN
            RAISE EXCEPTION 'Row %: overwrite target % is a % transaction and cannot be replaced by a CSV row',
                v_row.raw_row_index, v_row.target_overwrite_transaction_id,
                CASE WHEN v_target.is_personal_founder_payment THEN 'personal founder' ELSE v_target.type END;
        END IF;
    END LOOP;

    FOR v_row IN
        SELECT * FROM public.import_batch_rows
        WHERE batch_id = p_batch_id
        ORDER BY raw_row_index ASC
        FOR UPDATE
    LOOP
        IF v_row.resolution = 'skip' THEN
            UPDATE public.import_batch_rows SET row_status = 'skipped' WHERE id = v_row.id;
            v_skipped_count := v_skipped_count + 1;
        ELSIF v_row.resolution IN ('overwrite', 'import_as_distinct', 'pending') THEN
            v_row_currency := COALESCE(NULLIF(upper(trim(v_row.parsed_payload->>'currency')), ''), v_account_currency);
            IF v_row_currency <> v_account_currency THEN
                RAISE EXCEPTION 'Row % currency (%) does not match batch account currency (%)',
                    v_row.raw_row_index, v_row_currency, v_account_currency;
            END IF;
            v_row_fx := COALESCE(NULLIF(trim(v_row.parsed_payload->>'exchange_rate_to_base'), '')::NUMERIC(18,8), v_account_fx);

            INSERT INTO public.transactions (
                business_id, account_id, import_batch_id, date, amount, currency,
                exchange_rate_to_base, type, description, is_cleared, reversal_of_id
            ) VALUES (
                v_batch.business_id, v_batch.account_id, v_batch.id,
                (v_row.parsed_payload->>'date')::DATE,
                (v_row.parsed_payload->>'amount')::NUMERIC(15,2),
                v_row_currency, v_row_fx,
                v_row.parsed_payload->>'type',
                v_row.parsed_payload->>'description',
                TRUE,
                CASE WHEN v_row.resolution = 'overwrite' THEN v_row.target_overwrite_transaction_id END
            ) RETURNING id INTO v_new_tx_id;

            IF v_row.resolution = 'overwrite' THEN
                UPDATE public.transactions
                SET is_reversed = TRUE, reversed_by_id = v_new_tx_id
                WHERE business_id = v_batch.business_id AND id = v_row.target_overwrite_transaction_id;
            END IF;

            UPDATE public.import_batch_rows SET row_status = 'committed' WHERE id = v_row.id;
            v_imported_count := v_imported_count + 1;
        END IF;
    END LOOP;

    UPDATE public.import_batches
    SET status = 'committed', imported_rows = v_imported_count, duplicate_rows = v_skipped_count, committed_at = NOW()
    WHERE id = p_batch_id;

    RETURN jsonb_build_object('status', 'committed', 'batch_id', p_batch_id,
        'imported_rows', v_imported_count, 'skipped_rows', v_skipped_count);
END;
$$;

REVOKE ALL ON FUNCTION public.commit_import_batch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_import_batch(UUID) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- P-08 (concern 5) home 00006: outbox lease. available_at doubles as the lease expiry for rows in
-- 'processing', so a crashed worker's batch becomes claimable again. No new column needed.
-- Completion only applies to rows still in 'processing'.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_outbox_batch(p_batch_size INTEGER DEFAULT 25, p_lease_seconds INTEGER DEFAULT 300)
RETURNS SETOF public.transactional_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- leases that expired on their final attempt are parked, not retried forever
    UPDATE public.transactional_outbox
    SET status = 'dead_letter', last_error = COALESCE(last_error, 'Lease expired on final attempt')
    WHERE status = 'processing' AND available_at <= NOW() AND attempts >= 5;

    RETURN QUERY
    WITH claimed AS (
        SELECT id
        FROM public.transactional_outbox
        WHERE status IN ('pending', 'failed', 'processing')
          AND available_at <= NOW()
          AND attempts < 5
        ORDER BY available_at ASC, created_at ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.transactional_outbox o
    SET status = 'processing',
        attempts = o.attempts + 1,
        available_at = NOW() + make_interval(secs => p_lease_seconds)
    FROM claimed c
    WHERE o.id = c.id
    RETURNING o.*;
END;
$$;

ALTER FUNCTION public.claim_outbox_batch(INTEGER, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_outbox_batch(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_batch(INTEGER, INTEGER) TO service_role;
DROP FUNCTION IF EXISTS public.claim_outbox_batch(INTEGER);

CREATE OR REPLACE FUNCTION public.complete_outbox_item(
    p_outbox_id UUID,
    p_success BOOLEAN,
    p_error_message TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF p_success THEN
        UPDATE public.transactional_outbox
        SET status = 'dispatched', dispatched_at = NOW(), last_error = NULL
        WHERE id = p_outbox_id AND status = 'processing';
    ELSE
        UPDATE public.transactional_outbox
        SET status = CASE WHEN attempts >= 5 THEN 'dead_letter' ELSE 'failed' END,
            last_error = COALESCE(p_error_message, 'Unknown dispatch failure'),
            available_at = NOW() + (power(2, LEAST(attempts, 6)) || ' seconds')::INTERVAL
        WHERE id = p_outbox_id AND status = 'processing';
    END IF;
END;
$$;

DROP INDEX IF EXISTS public.idx_outbox_pending;
CREATE INDEX idx_outbox_claimable ON public.transactional_outbox(status, available_at)
    WHERE status IN ('pending', 'failed', 'processing');

-- ---------------------------------------------------------------------------------------------
-- P-09 (concern 6, D-10) home 00006b/RLS migration: explicit privilege floor.
-- anon gets nothing in public; authenticated loses TRUNCATE (bypasses RLS), TRIGGER, REFERENCES,
-- MAINTAIN (LOCK TABLE); PUBLIC revoked explicitly on protected tables; defaults hardened.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON public.activity_records, public.transactional_outbox, public.transactions, public.payment_allocations FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.activity_records, public.transactional_outbox FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------------------------
-- P-10 (D-07) home 00006b: vault policies compare text, so a non-UUID path cannot break listing
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS vault_storage_select ON storage.objects;
DROP POLICY IF EXISTS vault_storage_insert ON storage.objects;
DROP POLICY IF EXISTS vault_storage_delete ON storage.objects;

CREATE POLICY vault_storage_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'company_vault' AND (storage.foldername(name))[1] = public.get_current_business_id()::TEXT);
CREATE POLICY vault_storage_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'company_vault' AND (storage.foldername(name))[1] = public.get_current_business_id()::TEXT);
CREATE POLICY vault_storage_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'company_vault' AND (storage.foldername(name))[1] = public.get_current_business_id()::TEXT);
