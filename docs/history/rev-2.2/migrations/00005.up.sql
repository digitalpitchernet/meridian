-- MER-ENG-SPEC-001 Rev 2.2, Section 6.1 -- transcribed verbatim for disposable validation.
-- MIGRATION 00005.up.sql: FINANCIAL CURRENCY, CONCURRENCY, REVERSAL CASCADE & ATOMIC CSV IMPORT RPC

CREATE OR REPLACE FUNCTION public.enforce_transaction_currency_and_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_src_currency CHAR(3);
    v_dst_currency CHAR(3);
    v_base_currency CHAR(3);
BEGIN
    SELECT base_currency INTO v_base_currency
    FROM public.businesses
    WHERE id = NEW.business_id;

    IF NEW.account_id IS NOT NULL THEN
        SELECT currency INTO v_src_currency
        FROM public.financial_accounts
        WHERE business_id = NEW.business_id AND id = NEW.account_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Source financial account % not found in business %', NEW.account_id, NEW.business_id;
        END IF;

        IF NEW.currency <> v_src_currency THEN
            RAISE EXCEPTION 'Transaction currency (%) must match source financial account currency (%)',
                NEW.currency, v_src_currency;
        END IF;
    END IF;

    IF NEW.currency = v_base_currency AND NEW.exchange_rate_to_base <> 1.00000000 THEN
        RAISE EXCEPTION 'Transaction in business base currency (%) must have exchange_rate_to_base = 1.00000000',
            v_base_currency;
    END IF;

    IF NEW.type = 'transfer' THEN
        SELECT currency INTO v_dst_currency
        FROM public.financial_accounts
        WHERE business_id = NEW.business_id AND id = NEW.transfer_to_account_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Destination financial account % not found in business %', NEW.transfer_to_account_id, NEW.business_id;
        END IF;

        IF v_src_currency = v_dst_currency AND NEW.transfer_to_amount <> NEW.amount THEN
            RAISE EXCEPTION 'Same-currency transfer (%) requires transfer_to_amount (%) to equal amount (%)',
                v_src_currency, NEW.transfer_to_amount, NEW.amount;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_transaction_currency
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_transaction_currency_and_transfer();

CREATE OR REPLACE FUNCTION public.enforce_payment_allocation_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_tx RECORD;
    v_commitment RECORD;
    v_existing_tx_allocated NUMERIC(15,2);
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.commitment_id <> OLD.commitment_id
           OR NEW.transaction_id <> OLD.transaction_id
           OR NEW.transaction_amount <> OLD.transaction_amount
           OR NEW.exchange_rate_to_commitment <> OLD.exchange_rate_to_commitment
           OR NEW.amount <> OLD.amount
           OR NEW.currency <> OLD.currency THEN
            RAISE EXCEPTION 'Payment allocation financial parameters are immutable. Reverse the allocation and insert a new record to reassign.';
        END IF;

        IF OLD.is_reversed = TRUE AND NEW.is_reversed = FALSE THEN
            RAISE EXCEPTION 'A reversed payment allocation cannot be un-reversed.';
        END IF;
    END IF;

    SELECT id, business_id, type, amount, currency, participant_id, is_personal_founder_payment, is_reversed
    INTO v_tx
    FROM public.transactions
    WHERE business_id = NEW.business_id AND id = NEW.transaction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaction % not found in business %', NEW.transaction_id, NEW.business_id;
    END IF;

    IF v_tx.is_reversed AND NEW.is_reversed = FALSE THEN
        RAISE EXCEPTION 'Cannot active-allocate against a reversed transaction (%)', NEW.transaction_id;
    END IF;

    IF NOT (v_tx.type = 'income' OR (v_tx.type = 'expense' AND v_tx.is_personal_founder_payment = TRUE)) THEN
        RAISE EXCEPTION 'Payment allocation must reference an income transaction or personal founder payment';
    END IF;

    SELECT id, business_id, participant_id, currency, status
    INTO v_commitment
    FROM public.funding_commitments
    WHERE business_id = NEW.business_id AND id = NEW.commitment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Funding commitment % not found in business %', NEW.commitment_id, NEW.business_id;
    END IF;

    IF v_commitment.status = 'revoked' AND NEW.is_reversed = FALSE THEN
        RAISE EXCEPTION 'Cannot allocate payment to a revoked funding commitment (%)', NEW.commitment_id;
    END IF;

    IF NEW.currency <> v_commitment.currency THEN
        RAISE EXCEPTION 'Payment allocation currency (%) must match commitment currency (%)',
            NEW.currency, v_commitment.currency;
    END IF;

    IF v_tx.currency = v_commitment.currency AND NEW.exchange_rate_to_commitment <> 1.00000000 THEN
        RAISE EXCEPTION 'Same-currency allocation (%) requires exchange_rate_to_commitment = 1.00000000',
            v_tx.currency;
    END IF;

    IF v_commitment.participant_id IS NOT NULL AND v_tx.participant_id IS NOT NULL
       AND v_commitment.participant_id <> v_tx.participant_id THEN
        RAISE EXCEPTION 'Participant mismatch between commitment (%) and transaction (%)',
            v_commitment.participant_id, v_tx.participant_id;
    END IF;

    IF NEW.is_reversed = FALSE THEN
        SELECT COALESCE(SUM(transaction_amount), 0.00)
        INTO v_existing_tx_allocated
        FROM public.payment_allocations
        WHERE business_id = NEW.business_id
          AND transaction_id = NEW.transaction_id
          AND is_reversed = FALSE
          AND (TG_OP = 'INSERT' OR id <> NEW.id);

        IF (v_existing_tx_allocated + NEW.transaction_amount) > v_tx.amount THEN
            RAISE EXCEPTION 'Total allocated transaction_amount (%) exceeds transaction amount (%) for transaction %',
                (v_existing_tx_allocated + NEW.transaction_amount), v_tx.amount, NEW.transaction_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_payment_allocation
BEFORE INSERT OR UPDATE ON public.payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_allocation_invariants();

CREATE OR REPLACE FUNCTION public.sync_funding_commitment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_commitment_id UUID;
    v_business_id UUID;
    v_committed NUMERIC(15,2);
    v_current_status TEXT;
    v_allocated NUMERIC(15,2);
    v_new_status TEXT;
BEGIN
    v_commitment_id := COALESCE(NEW.commitment_id, OLD.commitment_id);
    v_business_id := COALESCE(NEW.business_id, OLD.business_id);

    SELECT committed_amount, status
    INTO v_committed, v_current_status
    FROM public.funding_commitments
    WHERE business_id = v_business_id AND id = v_commitment_id
    FOR UPDATE;

    IF v_current_status = 'revoked' THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(SUM(amount), 0.00)
    INTO v_allocated
    FROM public.payment_allocations
    WHERE business_id = v_business_id
      AND commitment_id = v_commitment_id
      AND is_reversed = FALSE;

    IF v_allocated = 0 THEN
        v_new_status := 'pledged';
    ELSIF v_allocated < v_committed THEN
        v_new_status := 'partially_paid';
    ELSIF v_allocated = v_committed THEN
        v_new_status := 'fulfilled';
    ELSE
        v_new_status := 'over_allocated';
    END IF;

    UPDATE public.funding_commitments
    SET status = v_new_status, updated_at = NOW()
    WHERE business_id = v_business_id AND id = v_commitment_id;

    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_commitment_status
AFTER INSERT OR UPDATE OR DELETE ON public.payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.sync_funding_commitment_status();

CREATE OR REPLACE FUNCTION public.cascade_transaction_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.is_reversed = FALSE AND NEW.is_reversed = TRUE THEN
        UPDATE public.payment_allocations
        SET is_reversed = TRUE,
            reversed_at = NOW(),
            reversal_reason = COALESCE(reversal_reason, 'Auto-reversed: parent transaction ' || NEW.id::TEXT || ' marked reversed')
        WHERE business_id = NEW.business_id
          AND transaction_id = NEW.id
          AND is_reversed = FALSE;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_cascade_transaction_reversal
AFTER UPDATE OF is_reversed ON public.transactions
FOR EACH ROW
WHEN (OLD.is_reversed = FALSE AND NEW.is_reversed = TRUE)
EXECUTE FUNCTION public.cascade_transaction_reversal();

CREATE OR REPLACE FUNCTION public.prevent_financial_history_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Direct deletion of financial records in % is prohibited. Use controlled reversal or archival status.', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_no_delete_transactions
BEFORE DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_history_deletion();

CREATE TRIGGER trg_no_delete_payment_allocations
BEFORE DELETE ON public.payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_history_deletion();

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
    v_row_currency CHAR(3);
    v_row_fx NUMERIC(18,8);
    v_imported_count INTEGER := 0;
    v_skipped_count INTEGER := 0;
    v_new_tx_id UUID;
BEGIN
    SELECT * INTO v_batch
    FROM public.import_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Import batch % not found', p_batch_id;
    END IF;

    IF v_batch.status = 'committed' THEN
        RETURN jsonb_build_object('status', 'already_committed', 'batch_id', p_batch_id);
    END IF;

    IF v_batch.status <> 'staged' THEN
        RAISE EXCEPTION 'Import batch % cannot be committed from status %', p_batch_id, v_batch.status;
    END IF;

    SELECT currency, exchange_rate_to_base
    INTO v_account_currency, v_account_fx
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

            IF v_row.resolution = 'overwrite' THEN
                INSERT INTO public.transactions (
                    business_id, account_id, import_batch_id, date, amount, currency,
                    exchange_rate_to_base, type, description, is_cleared, reversal_of_id
                ) VALUES (
                    v_batch.business_id,
                    v_batch.account_id,
                    v_batch.id,
                    (v_row.parsed_payload->>'date')::DATE,
                    (v_row.parsed_payload->>'amount')::NUMERIC(15,2),
                    v_row_currency,
                    v_row_fx,
                    v_row.parsed_payload->>'type',
                    v_row.parsed_payload->>'description',
                    TRUE,
                    v_row.target_overwrite_transaction_id
                ) RETURNING id INTO v_new_tx_id;

                UPDATE public.transactions
                SET is_reversed = TRUE, reversed_by_id = v_new_tx_id
                WHERE business_id = v_batch.business_id AND id = v_row.target_overwrite_transaction_id;

            ELSE
                INSERT INTO public.transactions (
                    business_id, account_id, import_batch_id, date, amount, currency,
                    exchange_rate_to_base, type, description, is_cleared
                ) VALUES (
                    v_batch.business_id,
                    v_batch.account_id,
                    v_batch.id,
                    (v_row.parsed_payload->>'date')::DATE,
                    (v_row.parsed_payload->>'amount')::NUMERIC(15,2),
                    v_row_currency,
                    v_row_fx,
                    v_row.parsed_payload->>'type',
                    v_row.parsed_payload->>'description',
                    TRUE
                );
            END IF;

            UPDATE public.import_batch_rows SET row_status = 'committed' WHERE id = v_row.id;
            v_imported_count := v_imported_count + 1;
        END IF;
    END LOOP;

    UPDATE public.import_batches
    SET status = 'committed',
        imported_rows = v_imported_count,
        duplicate_rows = v_skipped_count,
        committed_at = NOW()
    WHERE id = p_batch_id;

    RETURN jsonb_build_object(
        'status', 'committed',
        'batch_id', p_batch_id,
        'imported_rows', v_imported_count,
        'skipped_rows', v_skipped_count
    );
END;
$$;
