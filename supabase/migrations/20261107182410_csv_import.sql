-- =====================================================================================
-- Meridian V1 · Gate 1 · Migration 5/6: CSV import (stage -> review -> atomic commit).
-- The client stages raw rows; the server normalises, validates and fingerprints them,
-- flags duplicates, and commits the whole batch in one transaction or not at all.
-- =====================================================================================

CREATE TABLE public.import_batches (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id             uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_id              uuid NOT NULL,
    filename                text NOT NULL CHECK (char_length(btrim(filename)) BETWEEN 1 AND 255),
    file_checksum_sha256    text NOT NULL CHECK (file_checksum_sha256 ~ '^[0-9a-f]{64}$'),
    status                  text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'committed')),
    imported_rows           integer NOT NULL DEFAULT 0,
    skipped_rows            integer NOT NULL DEFAULT 0,
    replaced_rows           integer NOT NULL DEFAULT 0,
    committed_at            timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_import_batches_business UNIQUE (business_id, id),
    CONSTRAINT fk_ib_account FOREIGN KEY (business_id, account_id) REFERENCES public.financial_accounts(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_ib_committed CHECK ((status = 'committed') = (committed_at IS NOT NULL))
);
-- the same file can be committed to the same account only once
CREATE UNIQUE INDEX uq_import_file_committed ON public.import_batches (business_id, account_id, file_checksum_sha256) WHERE status = 'committed';

ALTER TABLE public.transactions ADD CONSTRAINT fk_tx_import_batch
    FOREIGN KEY (business_id, import_batch_id) REFERENCES public.import_batches(business_id, id) ON DELETE RESTRICT;

CREATE TABLE public.import_batch_rows (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id                 uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    batch_id                    uuid NOT NULL,
    row_index                   integer NOT NULL CHECK (row_index >= 0),
    payload                     jsonb NOT NULL,
    -- server-computed from payload
    parsed_date                 date,
    parsed_amount               numeric(15,2),
    parsed_type                 text,
    parsed_description          text,
    fingerprint                 text,
    validation_error            text,
    duplicate_of_transaction_id uuid,
    duplicate_in_batch          boolean NOT NULL DEFAULT false,
    -- founder's review decision
    resolution                  text NOT NULL DEFAULT 'pending' CHECK (resolution IN ('pending', 'import', 'skip', 'replace')),
    replace_transaction_id      uuid,
    -- outcome
    row_status                  text NOT NULL DEFAULT 'staged' CHECK (row_status IN ('staged', 'imported', 'skipped', 'replaced')),
    transaction_id              uuid,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_import_rows_business UNIQUE (business_id, id),
    CONSTRAINT uq_import_rows_index UNIQUE (batch_id, row_index),
    CONSTRAINT fk_ibr_batch FOREIGN KEY (business_id, batch_id) REFERENCES public.import_batches(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_ibr_duplicate FOREIGN KEY (business_id, duplicate_of_transaction_id) REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_ibr_replace FOREIGN KEY (business_id, replace_transaction_id) REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_ibr_transaction FOREIGN KEY (business_id, transaction_id) REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_ibr_replace CHECK ((resolution = 'replace') = (replace_transaction_id IS NOT NULL))
);

-- Normalise one staged row. Accepted payload keys: date (YYYY-MM-DD), amount (positive number), type (income|expense), description.
CREATE FUNCTION public.prepare_import_row()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_batch record; v_amount_text text;
BEGIN
    SELECT status, account_id INTO v_batch FROM public.import_batches WHERE business_id = NEW.business_id AND id = NEW.batch_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'import batch % not found', NEW.batch_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_batch.status <> 'staged' THEN RAISE EXCEPTION 'import batch % is already committed', NEW.batch_id USING ERRCODE = 'check_violation'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.payload IS DISTINCT FROM OLD.payload OR NEW.row_index IS DISTINCT FROM OLD.row_index OR NEW.batch_id IS DISTINCT FROM OLD.batch_id) THEN
        RAISE EXCEPTION 'staged row content cannot change; delete and restage it' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;

    NEW.validation_error := NULL;
    BEGIN
        IF NEW.payload->>'date' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'date must be YYYY-MM-DD'; END IF;
        NEW.parsed_date := (NEW.payload->>'date')::date;
        v_amount_text := btrim(NEW.payload->>'amount');
        IF v_amount_text !~ '^\d{1,13}(\.\d{1,2})?$' THEN RAISE EXCEPTION 'amount must be a positive number with at most 2 decimals'; END IF;
        NEW.parsed_amount := v_amount_text::numeric(15,2);
        IF NEW.parsed_amount <= 0 THEN RAISE EXCEPTION 'amount must be greater than zero'; END IF;
        NEW.parsed_type := lower(btrim(NEW.payload->>'type'));
        IF NEW.parsed_type NOT IN ('income', 'expense') THEN RAISE EXCEPTION 'type must be income or expense'; END IF;
        NEW.parsed_description := btrim(regexp_replace(COALESCE(NEW.payload->>'description', ''), '\s+', ' ', 'g'));
        IF char_length(NEW.parsed_description) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'description is required (max 500 characters)'; END IF;
    EXCEPTION WHEN OTHERS THEN
        NEW.validation_error := SQLERRM;
        NEW.parsed_date := NULL; NEW.parsed_amount := NULL; NEW.parsed_type := NULL; NEW.parsed_description := NULL;
    END;

    IF NEW.validation_error IS NULL THEN
        NEW.fingerprint := encode(sha256(convert_to(concat_ws('|', v_batch.account_id, NEW.parsed_date, NEW.parsed_amount, NEW.parsed_type,
                                                                lower(NEW.parsed_description)), 'UTF8')), 'hex');
        SELECT t.id INTO NEW.duplicate_of_transaction_id FROM public.transactions t
        WHERE t.business_id = NEW.business_id AND t.account_id = v_batch.account_id AND NOT t.is_reversed
          AND t.transaction_date = NEW.parsed_date AND t.amount = NEW.parsed_amount AND t.type = NEW.parsed_type
          AND lower(btrim(regexp_replace(t.description, '\s+', ' ', 'g'))) = lower(NEW.parsed_description)
        ORDER BY t.created_at LIMIT 1;
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION public.guard_import_batch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'committed' THEN
        RAISE EXCEPTION 'committed import batch % is permanent provenance', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE FUNCTION public.guard_import_row_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.import_batches WHERE business_id = OLD.business_id AND id = OLD.batch_id AND status = 'committed') THEN
        RAISE EXCEPTION 'rows of a committed import batch are permanent provenance' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
END $$;

CREATE TRIGGER trg_ibr_prepare BEFORE INSERT OR UPDATE ON public.import_batch_rows FOR EACH ROW EXECUTE FUNCTION public.prepare_import_row();
CREATE TRIGGER trg_ibr_no_delete_committed BEFORE DELETE ON public.import_batch_rows FOR EACH ROW EXECUTE FUNCTION public.guard_import_row_delete();
CREATE TRIGGER trg_ib_guard BEFORE UPDATE OR DELETE ON public.import_batches FOR EACH ROW EXECUTE FUNCTION public.guard_import_batch();
CREATE TRIGGER trg_ib_updated_at BEFORE UPDATE ON public.import_batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_ib_no_truncate BEFORE TRUNCATE ON public.import_batches FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();

-- Atomic commit. Raises (and so changes nothing) unless every row is valid and every
-- suspected duplicate has an explicit decision.
CREATE FUNCTION public.commit_import_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_bid uuid := public.get_current_business_id();
    v_batch record; v_row record; v_target record; v_tx uuid;
    v_imported integer := 0; v_skipped integer := 0; v_replaced integer := 0;
BEGIN
    IF v_bid IS NULL THEN RAISE EXCEPTION 'no workspace for the current user' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO v_batch FROM public.import_batches WHERE business_id = v_bid AND id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'import batch % not found', p_batch_id USING ERRCODE = 'no_data_found'; END IF;
    IF v_batch.status <> 'staged' THEN RAISE EXCEPTION 'import batch % is already committed', p_batch_id USING ERRCODE = 'check_violation'; END IF;
    IF EXISTS (SELECT 1 FROM public.import_batches WHERE business_id = v_bid AND account_id = v_batch.account_id
               AND file_checksum_sha256 = v_batch.file_checksum_sha256 AND status = 'committed') THEN
        RAISE EXCEPTION 'this file (sha256 %) was already imported into this account', v_batch.file_checksum_sha256 USING ERRCODE = 'unique_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.import_batch_rows WHERE batch_id = p_batch_id) THEN
        RAISE EXCEPTION 'import batch % has no rows', p_batch_id USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.import_batch_rows WHERE batch_id = p_batch_id AND validation_error IS NOT NULL AND resolution <> 'skip') THEN
        RAISE EXCEPTION 'import batch % has invalid rows; fix the file or mark them skip', p_batch_id USING ERRCODE = 'check_violation';
    END IF;

    -- duplicates inside the file itself
    UPDATE public.import_batch_rows r SET duplicate_in_batch = true
     WHERE r.batch_id = p_batch_id AND r.validation_error IS NULL
       AND EXISTS (SELECT 1 FROM public.import_batch_rows o WHERE o.batch_id = r.batch_id AND o.fingerprint = r.fingerprint AND o.row_index < r.row_index);

    IF EXISTS (SELECT 1 FROM public.import_batch_rows WHERE batch_id = p_batch_id AND resolution = 'pending'
               AND (duplicate_of_transaction_id IS NOT NULL OR duplicate_in_batch)) THEN
        RAISE EXCEPTION 'import batch % has suspected duplicates without a decision (import, skip or replace)', p_batch_id USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.import_batch_rows WHERE batch_id = p_batch_id AND resolution = 'replace'
               GROUP BY replace_transaction_id HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'two rows replace the same transaction' USING ERRCODE = 'check_violation';
    END IF;

    FOR v_row IN SELECT * FROM public.import_batch_rows WHERE batch_id = p_batch_id ORDER BY row_index FOR UPDATE LOOP
        IF v_row.resolution = 'skip' THEN
            UPDATE public.import_batch_rows SET row_status = 'skipped' WHERE id = v_row.id;
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        IF v_row.resolution = 'replace' THEN
            SELECT id, account_id, type, contribution_type, is_reversed INTO v_target FROM public.transactions
            WHERE business_id = v_bid AND id = v_row.replace_transaction_id FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'row %: transaction to replace not found', v_row.row_index USING ERRCODE = 'no_data_found'; END IF;
            IF v_target.account_id IS DISTINCT FROM v_batch.account_id THEN
                RAISE EXCEPTION 'row %: the replaced transaction belongs to another account', v_row.row_index USING ERRCODE = 'check_violation'; END IF;
            IF v_target.is_reversed THEN
                RAISE EXCEPTION 'row %: the replaced transaction is already reversed', v_row.row_index USING ERRCODE = 'check_violation'; END IF;
            IF v_target.type = 'transfer' OR v_target.contribution_type <> 'operational' THEN
                RAISE EXCEPTION 'row %: only ordinary income/expense can be replaced from a CSV; edit % records by reversal', v_row.row_index, v_target.contribution_type
                    USING ERRCODE = 'check_violation'; END IF;
            IF EXISTS (SELECT 1 FROM public.payment_allocations WHERE business_id = v_bid AND transaction_id = v_target.id AND NOT is_reversed) THEN
                RAISE EXCEPTION 'row %: the replaced transaction has payment allocations; reverse them first', v_row.row_index
                    USING ERRCODE = 'check_violation'; END IF;
        END IF;

        INSERT INTO public.transactions (business_id, account_id, import_batch_id, replaces_transaction_id, transaction_date, amount, type, description)
        VALUES (v_bid, v_batch.account_id, p_batch_id, v_row.replace_transaction_id, v_row.parsed_date, v_row.parsed_amount, v_row.parsed_type, v_row.parsed_description)
        RETURNING id INTO v_tx;

        IF v_row.resolution = 'replace' THEN
            UPDATE public.transactions SET is_reversed = true, reversed_at = now(),
                   reversal_reason = 'Replaced by CSV import ' || v_batch.filename || ' row ' || v_row.row_index
             WHERE business_id = v_bid AND id = v_row.replace_transaction_id;
            UPDATE public.import_batch_rows SET row_status = 'replaced', transaction_id = v_tx WHERE id = v_row.id;
            v_replaced := v_replaced + 1;
        ELSE
            UPDATE public.import_batch_rows SET row_status = 'imported', transaction_id = v_tx WHERE id = v_row.id;
            v_imported := v_imported + 1;
        END IF;
    END LOOP;

    UPDATE public.import_batches SET status = 'committed', committed_at = now(),
           imported_rows = v_imported, skipped_rows = v_skipped, replaced_rows = v_replaced
     WHERE id = p_batch_id;
    PERFORM public.log_activity(v_bid, 'import_batches.committed', 'import_batches', p_batch_id,
        'CSV imported: ' || v_batch.filename, jsonb_build_object('imported', v_imported, 'skipped', v_skipped, 'replaced', v_replaced));
    RETURN jsonb_build_object('batch_id', p_batch_id, 'status', 'committed', 'imported', v_imported, 'skipped', v_skipped, 'replaced', v_replaced);
END $$;

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.import_batch_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batch_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY import_batches_tenant ON public.import_batches FOR ALL TO authenticated
    USING (business_id = public.get_current_business_id()) WITH CHECK (business_id = public.get_current_business_id());
CREATE POLICY import_batch_rows_tenant ON public.import_batch_rows FOR ALL TO authenticated
    USING (business_id = public.get_current_business_id()) WITH CHECK (business_id = public.get_current_business_id());

REVOKE ALL ON public.import_batches, public.import_batch_rows FROM PUBLIC, anon, authenticated;
REVOKE TRUNCATE ON public.import_batches, public.import_batch_rows FROM service_role;
GRANT SELECT, DELETE ON public.import_batches TO authenticated;
GRANT INSERT (business_id, account_id, filename, file_checksum_sha256) ON public.import_batches TO authenticated;
GRANT SELECT, DELETE ON public.import_batch_rows TO authenticated;
GRANT INSERT (business_id, batch_id, row_index, payload) ON public.import_batch_rows TO authenticated;
GRANT UPDATE (resolution, replace_transaction_id) ON public.import_batch_rows TO authenticated;

REVOKE ALL ON FUNCTION public.prepare_import_row(), public.guard_import_batch(), public.guard_import_row_delete(), public.commit_import_batch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_import_batch(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.commit_import_batch(uuid) FROM service_role;

CREATE INDEX idx_import_rows_batch ON public.import_batch_rows (business_id, batch_id, row_index);
CREATE INDEX idx_tx_dedup ON public.transactions (business_id, account_id, transaction_date, amount) WHERE NOT is_reversed;
