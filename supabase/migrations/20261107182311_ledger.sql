-- =====================================================================================
-- Meridian V1 · Gate 1 · Migration 4/6: accounts, immutable transactions, payment
-- allocations, derived commitment status, reversals, available cash.
-- Single currency: every amount is in businesses.base_currency.
-- =====================================================================================

CREATE TABLE public.financial_accounts (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id             uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name                    text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    account_type            text NOT NULL CHECK (account_type IN ('bank', 'cash', 'credit', 'escrow')),
    institution             text,
    opening_balance         numeric(15,2) NOT NULL DEFAULT 0,
    opening_balance_date    date NOT NULL,
    is_active               boolean NOT NULL DEFAULT true,
    notes                   text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_financial_accounts_business UNIQUE (business_id, id)
);

CREATE TABLE public.financial_categories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    kind            text NOT NULL CHECK (kind IN ('income', 'expense')),
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_financial_categories_business UNIQUE (business_id, id),
    CONSTRAINT uq_financial_categories_name UNIQUE (business_id, kind, name)
);

-- -------------------------------------------------------------------------------------
-- transactions: append-only financial history. Financial columns never change after
-- insert (for any role); corrections are a reversal plus a new transaction.
-- -------------------------------------------------------------------------------------
CREATE TABLE public.transactions (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id                 uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_id                  uuid,
    transfer_to_account_id      uuid,
    category_id                 uuid,
    participant_id              uuid,
    settles_transaction_id      uuid,
    import_batch_id             uuid,
    replaces_transaction_id     uuid,
    transaction_date            date NOT NULL,
    amount                      numeric(15,2) NOT NULL CHECK (amount > 0),
    type                        text NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    contribution_type           text NOT NULL DEFAULT 'operational' CHECK (contribution_type IN (
                                    'operational', 'capital_contribution', 'founder_loan', 'reimbursable_expense',
                                    'reimbursement', 'loan_repayment', 'third_party_equity', 'third_party_grant', 'third_party_loan')),
    is_personal_founder_payment boolean NOT NULL DEFAULT false,
    description                 text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 500),
    reference                   text,
    notes                       text,
    is_reversed                 boolean NOT NULL DEFAULT false,
    reversed_at                 timestamptz,
    reversal_reason             text,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_transactions_business UNIQUE (business_id, id),
    CONSTRAINT fk_tx_account FOREIGN KEY (business_id, account_id) REFERENCES public.financial_accounts(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_transfer_to FOREIGN KEY (business_id, transfer_to_account_id) REFERENCES public.financial_accounts(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_category FOREIGN KEY (business_id, category_id) REFERENCES public.financial_categories(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_participant FOREIGN KEY (business_id, participant_id) REFERENCES public.participants(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_settles FOREIGN KEY (business_id, settles_transaction_id) REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_replaces FOREIGN KEY (business_id, replaces_transaction_id) REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    -- where the money moved
    CONSTRAINT chk_tx_shape CHECK (
        (type = 'transfer' AND account_id IS NOT NULL AND transfer_to_account_id IS NOT NULL
             AND account_id <> transfer_to_account_id AND NOT is_personal_founder_payment AND contribution_type = 'operational')
     OR (type IN ('income', 'expense') AND transfer_to_account_id IS NULL
             AND ((NOT is_personal_founder_payment AND account_id IS NOT NULL)
               OR (is_personal_founder_payment AND account_id IS NULL AND type = 'expense')))),
    -- what the money means (pledges are never transactions; personal payments are never silently equity)
    CONSTRAINT chk_tx_contribution CHECK (
        (contribution_type = 'operational' AND NOT is_personal_founder_payment AND settles_transaction_id IS NULL)
     OR (contribution_type IN ('capital_contribution', 'founder_loan') AND participant_id IS NOT NULL
             AND (type = 'income' OR is_personal_founder_payment) AND settles_transaction_id IS NULL)
     OR (contribution_type = 'reimbursable_expense' AND is_personal_founder_payment AND participant_id IS NOT NULL AND settles_transaction_id IS NULL)
     OR (contribution_type IN ('reimbursement', 'loan_repayment') AND type = 'expense' AND NOT is_personal_founder_payment
             AND participant_id IS NOT NULL AND settles_transaction_id IS NOT NULL)
     OR (contribution_type IN ('third_party_equity', 'third_party_grant', 'third_party_loan') AND type = 'income' AND settles_transaction_id IS NULL)),
    CONSTRAINT chk_tx_reversal CHECK (is_reversed = (reversed_at IS NOT NULL) AND (reversed_at IS NULL) = (reversal_reason IS NULL))
);

CREATE FUNCTION public.guard_transaction_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_acc record; v_dst record; v_target record; v_settled numeric(15,2);
BEGIN
    IF NEW.is_reversed THEN
        RAISE EXCEPTION 'a transaction cannot be created already reversed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.account_id IS NOT NULL THEN
        SELECT is_active, opening_balance_date INTO v_acc FROM public.financial_accounts
        WHERE business_id = NEW.business_id AND id = NEW.account_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'account % not found', NEW.account_id USING ERRCODE = 'foreign_key_violation'; END IF;
        IF NOT v_acc.is_active THEN RAISE EXCEPTION 'account % is inactive', NEW.account_id USING ERRCODE = 'check_violation'; END IF;
        IF NEW.transaction_date < v_acc.opening_balance_date THEN
            RAISE EXCEPTION 'transaction dated % precedes the account opening balance date %', NEW.transaction_date, v_acc.opening_balance_date
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF NEW.transfer_to_account_id IS NOT NULL THEN
        SELECT is_active, opening_balance_date INTO v_dst FROM public.financial_accounts
        WHERE business_id = NEW.business_id AND id = NEW.transfer_to_account_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'account % not found', NEW.transfer_to_account_id USING ERRCODE = 'foreign_key_violation'; END IF;
        IF NOT v_dst.is_active THEN RAISE EXCEPTION 'account % is inactive', NEW.transfer_to_account_id USING ERRCODE = 'check_violation'; END IF;
        IF NEW.transaction_date < v_dst.opening_balance_date THEN
            RAISE EXCEPTION 'transfer dated % precedes the destination opening balance date %', NEW.transaction_date, v_dst.opening_balance_date
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF NEW.settles_transaction_id IS NOT NULL THEN
        SELECT id, participant_id, contribution_type, amount, is_reversed INTO v_target FROM public.transactions
        WHERE business_id = NEW.business_id AND id = NEW.settles_transaction_id
        FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'settled transaction % not found', NEW.settles_transaction_id USING ERRCODE = 'foreign_key_violation'; END IF;
        IF v_target.is_reversed THEN RAISE EXCEPTION 'cannot settle a reversed transaction' USING ERRCODE = 'check_violation'; END IF;
        IF NOT ((NEW.contribution_type = 'reimbursement' AND v_target.contribution_type = 'reimbursable_expense')
             OR (NEW.contribution_type = 'loan_repayment' AND v_target.contribution_type = 'founder_loan')) THEN
            RAISE EXCEPTION '% cannot settle a % transaction', NEW.contribution_type, v_target.contribution_type USING ERRCODE = 'check_violation';
        END IF;
        IF v_target.participant_id IS DISTINCT FROM NEW.participant_id THEN
            RAISE EXCEPTION 'settlement participant must match the original transaction participant' USING ERRCODE = 'check_violation';
        END IF;
        SELECT COALESCE(SUM(amount), 0) INTO v_settled FROM public.transactions
        WHERE business_id = NEW.business_id AND settles_transaction_id = v_target.id AND NOT is_reversed;
        IF v_settled + NEW.amount > v_target.amount THEN
            RAISE EXCEPTION 'settlement of % would exceed the outstanding % on transaction %', NEW.amount, v_target.amount - v_settled, v_target.id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION public.guard_transaction_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.id, NEW.business_id, NEW.account_id, NEW.transfer_to_account_id, NEW.participant_id, NEW.settles_transaction_id,
        NEW.import_batch_id, NEW.replaces_transaction_id, NEW.transaction_date, NEW.amount, NEW.type, NEW.contribution_type,
        NEW.is_personal_founder_payment, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.business_id, OLD.account_id, OLD.transfer_to_account_id, OLD.participant_id, OLD.settles_transaction_id,
        OLD.import_batch_id, OLD.replaces_transaction_id, OLD.transaction_date, OLD.amount, OLD.type, OLD.contribution_type,
        OLD.is_personal_founder_payment, OLD.created_at) THEN
        RAISE EXCEPTION 'financial fields of transaction % are immutable; reverse it and record a new transaction', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.is_reversed AND (NOT NEW.is_reversed OR NEW.reversed_at IS DISTINCT FROM OLD.reversed_at
                            OR NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason) THEN
        RAISE EXCEPTION 'reversal of transaction % is final', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

-- -------------------------------------------------------------------------------------
-- payment_allocations: money actually received, applied to a commitment.
-- -------------------------------------------------------------------------------------
CREATE TABLE public.payment_allocations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    commitment_id       uuid NOT NULL,
    transaction_id      uuid NOT NULL,
    amount              numeric(15,2) NOT NULL CHECK (amount > 0),
    notes               text,
    is_reversed         boolean NOT NULL DEFAULT false,
    reversed_at         timestamptz,
    reversal_reason     text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_payment_allocations_business UNIQUE (business_id, id),
    CONSTRAINT fk_pa_commitment FOREIGN KEY (business_id, commitment_id) REFERENCES public.funding_commitments(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_pa_transaction FOREIGN KEY (business_id, transaction_id) REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_pa_reversal CHECK (is_reversed = (reversed_at IS NOT NULL) AND (reversed_at IS NULL) = (reversal_reason IS NULL))
);

CREATE FUNCTION public.guard_allocation_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tx record; v_c record; v_used numeric(15,2);
BEGIN
    IF NEW.is_reversed THEN
        RAISE EXCEPTION 'an allocation cannot be created already reversed' USING ERRCODE = 'check_violation';
    END IF;
    -- serialise all allocations against one transaction (FIN-02 pattern, validated in Rev 2.2)
    SELECT id, type, amount, contribution_type, participant_id, is_personal_founder_payment, is_reversed INTO v_tx
    FROM public.transactions WHERE business_id = NEW.business_id AND id = NEW.transaction_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'transaction % not found', NEW.transaction_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_tx.is_reversed THEN RAISE EXCEPTION 'cannot allocate a reversed transaction' USING ERRCODE = 'check_violation'; END IF;
    IF NOT ((v_tx.type = 'income' AND v_tx.contribution_type IN ('capital_contribution', 'founder_loan', 'third_party_equity', 'third_party_grant', 'third_party_loan'))
         OR (v_tx.is_personal_founder_payment AND v_tx.contribution_type IN ('capital_contribution', 'founder_loan'))) THEN
        RAISE EXCEPTION 'only funding receipts (capital, loans, third-party funding) can satisfy a commitment; got % %', v_tx.type, v_tx.contribution_type
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT id, participant_id, revoked_at INTO v_c
    FROM public.funding_commitments WHERE business_id = NEW.business_id AND id = NEW.commitment_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'commitment % not found', NEW.commitment_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_c.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'commitment % is revoked', NEW.commitment_id USING ERRCODE = 'check_violation'; END IF;
    IF v_c.participant_id IS NOT NULL AND v_tx.participant_id IS DISTINCT FROM v_c.participant_id THEN
        RAISE EXCEPTION 'this commitment belongs to another participant; the payment must come from that participant'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_used FROM public.payment_allocations
    WHERE business_id = NEW.business_id AND transaction_id = NEW.transaction_id AND NOT is_reversed;
    IF v_used + NEW.amount > v_tx.amount THEN
        RAISE EXCEPTION 'allocations (%) would exceed the transaction amount (%)', v_used + NEW.amount, v_tx.amount
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION public.guard_allocation_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.id, NEW.business_id, NEW.commitment_id, NEW.transaction_id, NEW.amount, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.business_id, OLD.commitment_id, OLD.transaction_id, OLD.amount, OLD.created_at) THEN
        RAISE EXCEPTION 'allocation % is immutable; reverse it and allocate again', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.is_reversed AND (NOT NEW.is_reversed OR NEW.reversed_at IS DISTINCT FROM OLD.reversed_at
                            OR NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason) THEN
        RAISE EXCEPTION 'reversal of allocation % is final', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

-- reversing a transaction reverses every active allocation of it (FIN-03 pattern)
CREATE FUNCTION public.cascade_transaction_reversal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
    UPDATE public.payment_allocations
       SET is_reversed = true, reversed_at = NEW.reversed_at,
           reversal_reason = 'Parent transaction reversed: ' || NEW.reversal_reason
     WHERE business_id = NEW.business_id AND transaction_id = NEW.id AND NOT is_reversed;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM public.log_activity(NEW.business_id, 'transactions.reversed', 'transactions', NEW.id,
        'Transaction reversed: ' || NEW.description,
        jsonb_build_object('amount', NEW.amount, 'reason', NEW.reversal_reason, 'allocations_reversed', v_n));
    RETURN NULL;
END $$;

-- -------------------------------------------------------------------------------------
-- Triggers
-- -------------------------------------------------------------------------------------
CREATE TRIGGER trg_tx_guard_insert BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.guard_transaction_insert();
CREATE TRIGGER trg_tx_guard_update BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.guard_transaction_update();
CREATE TRIGGER trg_tx_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tx_no_delete BEFORE DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
CREATE TRIGGER trg_tx_no_truncate BEFORE TRUNCATE ON public.transactions FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
CREATE TRIGGER trg_tx_activity AFTER INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.record_activity();
CREATE TRIGGER trg_tx_reversal_cascade AFTER UPDATE OF is_reversed ON public.transactions
    FOR EACH ROW WHEN (NOT OLD.is_reversed AND NEW.is_reversed) EXECUTE FUNCTION public.cascade_transaction_reversal();

CREATE TRIGGER trg_pa_guard_insert BEFORE INSERT ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.guard_allocation_insert();
CREATE TRIGGER trg_pa_guard_update BEFORE UPDATE ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.guard_allocation_update();
CREATE TRIGGER trg_pa_updated_at BEFORE UPDATE ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_pa_no_delete BEFORE DELETE ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
CREATE TRIGGER trg_pa_no_truncate BEFORE TRUNCATE ON public.payment_allocations FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
CREATE TRIGGER trg_pa_activity AFTER INSERT ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.record_activity();

CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON public.financial_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------------------------------
-- Recurring transaction templates (scheduling only; posting is an explicit user action, Gate 2)
-- -------------------------------------------------------------------------------------
CREATE TABLE public.recurring_transactions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_id      uuid NOT NULL,
    category_id     uuid,
    type            text NOT NULL CHECK (type IN ('income', 'expense')),
    amount          numeric(15,2) NOT NULL CHECK (amount > 0),
    description     text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 500),
    frequency       text NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'annually')),
    start_date      date NOT NULL,
    end_date        date,
    next_due_date   date NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_recurring_business UNIQUE (business_id, id),
    CONSTRAINT fk_rt_account FOREIGN KEY (business_id, account_id) REFERENCES public.financial_accounts(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_rt_category FOREIGN KEY (business_id, category_id) REFERENCES public.financial_categories(business_id, id) ON DELETE SET NULL (category_id),
    CONSTRAINT chk_rt_dates CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE TRIGGER trg_recurring_updated_at BEFORE UPDATE ON public.recurring_transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------------------------------
-- Derived views (security_invoker: callers only ever see their own tenant)
-- -------------------------------------------------------------------------------------
CREATE VIEW public.vw_funding_commitment_status WITH (security_invoker = true) AS
SELECT c.id AS commitment_id, c.business_id, c.requirement_id, c.participant_id, c.funder_name,
       c.committed_amount, c.expected_payment_date, c.revoked_at, c.revocation_reason,
       a.received_amount,
       CASE WHEN c.revoked_at IS NOT NULL THEN 0 ELSE GREATEST(c.committed_amount - a.received_amount, 0) END::numeric(15,2) AS outstanding_amount,
       CASE WHEN c.revoked_at IS NOT NULL THEN 'revoked'
            WHEN a.received_amount = 0 THEN 'pledged'
            WHEN a.received_amount < c.committed_amount THEN 'partially_paid'
            WHEN a.received_amount = c.committed_amount THEN 'fulfilled'
            ELSE 'over_allocated' END AS status
FROM public.funding_commitments c
CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(pa.amount), 0)::numeric(15,2) AS received_amount
    FROM public.payment_allocations pa
    WHERE pa.business_id = c.business_id AND pa.commitment_id = c.id AND NOT pa.is_reversed) a;

CREATE VIEW public.vw_funding_requirement_summary WITH (security_invoker = true) AS
SELECT r.id AS requirement_id, r.business_id, r.title, r.lifecycle, r.needed_by, r.required_amount,
       COALESCE(SUM(s.committed_amount) FILTER (WHERE s.status <> 'revoked'), 0)::numeric(15,2) AS committed_amount,
       COALESCE(SUM(s.received_amount), 0)::numeric(15,2) AS received_amount,
       COALESCE(SUM(s.outstanding_amount), 0)::numeric(15,2) AS outstanding_commitments,
       GREATEST(r.required_amount - COALESCE(SUM(s.committed_amount) FILTER (WHERE s.status <> 'revoked'), 0), 0)::numeric(15,2) AS uncommitted_gap
FROM public.funding_requirements r
LEFT JOIN public.vw_funding_commitment_status s ON s.business_id = r.business_id AND s.requirement_id = r.id
GROUP BY r.id, r.business_id, r.title, r.lifecycle, r.needed_by, r.required_amount;

-- reimbursable expenses and founder loans with what has been paid back
CREATE VIEW public.vw_settlement_status WITH (security_invoker = true) AS
SELECT t.id AS transaction_id, t.business_id, t.participant_id, t.contribution_type, t.transaction_date, t.description, t.amount,
       COALESCE(SUM(s.amount) FILTER (WHERE NOT s.is_reversed), 0)::numeric(15,2) AS settled_amount,
       (t.amount - COALESCE(SUM(s.amount) FILTER (WHERE NOT s.is_reversed), 0))::numeric(15,2) AS outstanding_amount
FROM public.transactions t
LEFT JOIN public.transactions s ON s.business_id = t.business_id AND s.settles_transaction_id = t.id
WHERE t.contribution_type IN ('reimbursable_expense', 'founder_loan') AND NOT t.is_reversed
GROUP BY t.id, t.business_id, t.participant_id, t.contribution_type, t.transaction_date, t.description, t.amount;

-- contributor-level reporting: kept as separate figures, never netted into ownership
CREATE VIEW public.vw_participant_contribution_summary WITH (security_invoker = true) AS
SELECT p.id AS participant_id, p.business_id, p.full_name, p.participant_type, p.agreed_equity_percentage,
       COALESCE((SELECT SUM(t.amount) FROM public.transactions t WHERE t.business_id = p.business_id AND t.participant_id = p.id
                 AND t.contribution_type = 'capital_contribution' AND NOT t.is_reversed), 0)::numeric(15,2) AS capital_contributed,
       COALESCE((SELECT SUM(t.amount) FROM public.transactions t WHERE t.business_id = p.business_id AND t.participant_id = p.id
                 AND t.contribution_type = 'founder_loan' AND NOT t.is_reversed), 0)::numeric(15,2) AS loans_advanced,
       COALESCE((SELECT SUM(s.outstanding_amount) FROM public.vw_settlement_status s WHERE s.business_id = p.business_id
                 AND s.participant_id = p.id AND s.contribution_type = 'founder_loan'), 0)::numeric(15,2) AS loans_outstanding,
       COALESCE((SELECT SUM(s.outstanding_amount) FROM public.vw_settlement_status s WHERE s.business_id = p.business_id
                 AND s.participant_id = p.id AND s.contribution_type = 'reimbursable_expense'), 0)::numeric(15,2) AS reimbursements_owed,
       COALESCE((SELECT SUM(pca.allocated_amount) FROM public.participant_capital_allocations pca JOIN public.capital_structures cs
                 ON cs.business_id = pca.business_id AND cs.id = pca.structure_id
                 WHERE pca.business_id = p.business_id AND pca.participant_id = p.id AND pca.is_active AND cs.is_current), 0)::numeric(15,2) AS capital_allocated,
       COALESCE((SELECT SUM(s.outstanding_amount) FROM public.vw_funding_commitment_status s WHERE s.business_id = p.business_id
                 AND s.participant_id = p.id), 0)::numeric(15,2) AS commitments_outstanding
FROM public.participants p;

-- -------------------------------------------------------------------------------------
-- Available cash: active bank + cash accounts, as of a date (default: today in the
-- business timezone). Opening balances count only from their date; reversed rows never count.
-- -------------------------------------------------------------------------------------
CREATE FUNCTION public.compute_account_balances(p_business_id uuid, p_as_of date)
RETURNS TABLE (account_id uuid, name text, account_type text, is_active boolean, balance numeric(15,2), counts_as_available_cash boolean)
LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT a.id, a.name, a.account_type, a.is_active,
           (a.opening_balance
            + COALESCE((SELECT SUM(t.amount) FROM public.transactions t
                        WHERE t.business_id = a.business_id AND NOT t.is_reversed
                          AND t.transaction_date BETWEEN a.opening_balance_date AND p_as_of
                          AND ((t.type = 'income' AND t.account_id = a.id) OR (t.type = 'transfer' AND t.transfer_to_account_id = a.id))), 0)
            - COALESCE((SELECT SUM(t.amount) FROM public.transactions t
                        WHERE t.business_id = a.business_id AND NOT t.is_reversed
                          AND t.transaction_date BETWEEN a.opening_balance_date AND p_as_of
                          AND t.account_id = a.id AND t.type IN ('expense', 'transfer')), 0))::numeric(15,2),
           (a.is_active AND a.account_type IN ('bank', 'cash'))
    FROM public.financial_accounts a
    WHERE a.business_id = p_business_id AND a.opening_balance_date <= p_as_of
$$;

CREATE FUNCTION public.business_local_date(p_business_id uuid)
RETURNS date LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT (now() AT TIME ZONE b.timezone)::date FROM public.businesses b WHERE b.id = p_business_id
$$;

-- for the signed-in founder
CREATE FUNCTION public.get_available_cash(p_as_of date DEFAULT NULL)
RETURNS numeric(15,2) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_bid uuid := public.get_current_business_id();
BEGIN
    IF v_bid IS NULL THEN RAISE EXCEPTION 'no workspace for the current user' USING ERRCODE = 'insufficient_privilege'; END IF;
    RETURN (SELECT COALESCE(SUM(balance), 0) FROM public.compute_account_balances(v_bid, COALESCE(p_as_of, public.business_local_date(v_bid)))
            WHERE counts_as_available_cash);
END $$;

CREATE FUNCTION public.get_account_balances(p_as_of date DEFAULT NULL)
RETURNS TABLE (account_id uuid, name text, account_type text, is_active boolean, balance numeric(15,2), counts_as_available_cash boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_bid uuid := public.get_current_business_id();
BEGIN
    IF v_bid IS NULL THEN RAISE EXCEPTION 'no workspace for the current user' USING ERRCODE = 'insufficient_privilege'; END IF;
    RETURN QUERY SELECT * FROM public.compute_account_balances(v_bid, COALESCE(p_as_of, public.business_local_date(v_bid)));
END $$;

-- for trusted server jobs (service_role has no auth.uid(); it names the business explicitly)
CREATE FUNCTION public.get_available_cash_for_business(p_business_id uuid, p_as_of date DEFAULT NULL)
RETURNS numeric(15,2) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE(SUM(balance), 0)::numeric(15,2)
    FROM public.compute_account_balances(p_business_id, COALESCE(p_as_of, public.business_local_date(p_business_id)))
    WHERE counts_as_available_cash
$$;

-- -------------------------------------------------------------------------------------
-- Controlled mutations (the only way clients reverse or revoke anything)
-- -------------------------------------------------------------------------------------
CREATE FUNCTION public.reverse_transaction(p_transaction_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_bid uuid := public.get_current_business_id(); v_tx record;
BEGIN
    IF v_bid IS NULL THEN RAISE EXCEPTION 'no workspace for the current user' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) = 0 THEN RAISE EXCEPTION 'a reversal reason is required' USING ERRCODE = 'check_violation'; END IF;
    SELECT id, is_reversed INTO v_tx FROM public.transactions WHERE business_id = v_bid AND id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'transaction % not found', p_transaction_id USING ERRCODE = 'no_data_found'; END IF;
    IF v_tx.is_reversed THEN RAISE EXCEPTION 'transaction % is already reversed', p_transaction_id USING ERRCODE = 'check_violation'; END IF;
    IF EXISTS (SELECT 1 FROM public.transactions WHERE business_id = v_bid AND settles_transaction_id = p_transaction_id AND NOT is_reversed) THEN
        RAISE EXCEPTION 'reverse the reimbursements/repayments of transaction % first', p_transaction_id USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.transactions SET is_reversed = true, reversed_at = now(), reversal_reason = btrim(p_reason)
     WHERE business_id = v_bid AND id = p_transaction_id;
    RETURN jsonb_build_object('transaction_id', p_transaction_id, 'status', 'reversed');
END $$;

CREATE FUNCTION public.reverse_payment_allocation(p_allocation_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_bid uuid := public.get_current_business_id(); v_pa record;
BEGIN
    IF v_bid IS NULL THEN RAISE EXCEPTION 'no workspace for the current user' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) = 0 THEN RAISE EXCEPTION 'a reversal reason is required' USING ERRCODE = 'check_violation'; END IF;
    SELECT id, amount, is_reversed, commitment_id INTO v_pa FROM public.payment_allocations WHERE business_id = v_bid AND id = p_allocation_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'allocation % not found', p_allocation_id USING ERRCODE = 'no_data_found'; END IF;
    IF v_pa.is_reversed THEN RAISE EXCEPTION 'allocation % is already reversed', p_allocation_id USING ERRCODE = 'check_violation'; END IF;
    UPDATE public.payment_allocations SET is_reversed = true, reversed_at = now(), reversal_reason = btrim(p_reason)
     WHERE business_id = v_bid AND id = p_allocation_id;
    PERFORM public.log_activity(v_bid, 'payment_allocations.reversed', 'payment_allocations', p_allocation_id,
        'Payment allocation reversed', jsonb_build_object('amount', v_pa.amount, 'commitment_id', v_pa.commitment_id, 'reason', btrim(p_reason)));
    RETURN jsonb_build_object('allocation_id', p_allocation_id, 'status', 'reversed');
END $$;

CREATE FUNCTION public.revoke_funding_commitment(p_commitment_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_bid uuid := public.get_current_business_id(); v_c record;
BEGIN
    IF v_bid IS NULL THEN RAISE EXCEPTION 'no workspace for the current user' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) = 0 THEN RAISE EXCEPTION 'a revocation reason is required' USING ERRCODE = 'check_violation'; END IF;
    SELECT id, funder_name, committed_amount, revoked_at INTO v_c FROM public.funding_commitments WHERE business_id = v_bid AND id = p_commitment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'commitment % not found', p_commitment_id USING ERRCODE = 'no_data_found'; END IF;
    IF v_c.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'commitment % is already revoked', p_commitment_id USING ERRCODE = 'check_violation'; END IF;
    IF EXISTS (SELECT 1 FROM public.payment_allocations WHERE business_id = v_bid AND commitment_id = p_commitment_id AND NOT is_reversed) THEN
        RAISE EXCEPTION 'commitment % has received payments; reverse those allocations before revoking', p_commitment_id USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.funding_commitments SET revoked_at = now(), revocation_reason = btrim(p_reason)
     WHERE business_id = v_bid AND id = p_commitment_id;
    PERFORM public.log_activity(v_bid, 'funding_commitments.revoked', 'funding_commitments', p_commitment_id,
        'Commitment revoked: ' || v_c.funder_name, jsonb_build_object('committed_amount', v_c.committed_amount, 'reason', btrim(p_reason)));
    RETURN jsonb_build_object('commitment_id', p_commitment_id, 'status', 'revoked');
END $$;

-- -------------------------------------------------------------------------------------
-- RLS, policies, grants
-- -------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['financial_accounts', 'financial_categories', 'transactions', 'payment_allocations', 'recurring_transactions'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY %1$s_tenant ON public.%1$I FOR ALL TO authenticated USING (business_id = public.get_current_business_id()) WITH CHECK (business_id = public.get_current_business_id())', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('REVOKE TRUNCATE ON public.%I FROM service_role', t);
    END LOOP;
END $$;

GRANT SELECT ON public.financial_accounts TO authenticated;
GRANT INSERT (business_id, name, account_type, institution, opening_balance, opening_balance_date, is_active, notes) ON public.financial_accounts TO authenticated;
GRANT UPDATE (name, institution, is_active, notes) ON public.financial_accounts TO authenticated;

GRANT SELECT, INSERT, DELETE ON public.financial_categories TO authenticated;
GRANT UPDATE (name, is_active) ON public.financial_categories TO authenticated;

GRANT SELECT ON public.transactions TO authenticated;
GRANT INSERT (business_id, account_id, transfer_to_account_id, category_id, participant_id, settles_transaction_id, transaction_date, amount,
              type, contribution_type, is_personal_founder_payment, description, reference, notes) ON public.transactions TO authenticated;
GRANT UPDATE (category_id, description, reference, notes) ON public.transactions TO authenticated;
REVOKE DELETE ON public.transactions FROM service_role;

GRANT SELECT ON public.payment_allocations TO authenticated;
GRANT INSERT (business_id, commitment_id, transaction_id, amount, notes) ON public.payment_allocations TO authenticated;
GRANT UPDATE (notes) ON public.payment_allocations TO authenticated;
REVOKE DELETE ON public.payment_allocations FROM service_role;

GRANT SELECT, INSERT, DELETE ON public.recurring_transactions TO authenticated;
GRANT UPDATE (account_id, category_id, type, amount, description, frequency, start_date, end_date, next_due_date, is_active) ON public.recurring_transactions TO authenticated;

REVOKE ALL ON public.vw_funding_commitment_status, public.vw_funding_requirement_summary, public.vw_settlement_status,
    public.vw_participant_contribution_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_funding_commitment_status, public.vw_funding_requirement_summary, public.vw_settlement_status,
    public.vw_participant_contribution_summary TO authenticated;

REVOKE ALL ON FUNCTION public.guard_transaction_insert(), public.guard_transaction_update(), public.guard_allocation_insert(),
    public.guard_allocation_update(), public.cascade_transaction_reversal(), public.compute_account_balances(uuid, date),
    public.business_local_date(uuid), public.get_available_cash(date), public.get_account_balances(date),
    public.get_available_cash_for_business(uuid, date), public.reverse_transaction(uuid, text),
    public.reverse_payment_allocation(uuid, text), public.revoke_funding_commitment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_cash(date), public.get_account_balances(date), public.reverse_transaction(uuid, text),
    public.reverse_payment_allocation(uuid, text), public.revoke_funding_commitment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_cash_for_business(uuid, date) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_available_cash(date), public.get_account_balances(date), public.reverse_transaction(uuid, text),
    public.reverse_payment_allocation(uuid, text), public.revoke_funding_commitment(uuid, text) FROM service_role;

CREATE INDEX idx_tx_business_date ON public.transactions (business_id, transaction_date) WHERE NOT is_reversed;
CREATE INDEX idx_tx_account ON public.transactions (business_id, account_id, transaction_date) WHERE NOT is_reversed;
CREATE INDEX idx_tx_transfer_to ON public.transactions (business_id, transfer_to_account_id, transaction_date) WHERE type = 'transfer' AND NOT is_reversed;
CREATE INDEX idx_tx_participant ON public.transactions (business_id, participant_id) WHERE participant_id IS NOT NULL;
CREATE INDEX idx_tx_settles ON public.transactions (business_id, settles_transaction_id) WHERE settles_transaction_id IS NOT NULL;
CREATE INDEX idx_pa_commitment ON public.payment_allocations (business_id, commitment_id) WHERE NOT is_reversed;
CREATE INDEX idx_pa_transaction ON public.payment_allocations (business_id, transaction_id) WHERE NOT is_reversed;
