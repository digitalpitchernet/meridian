-- MER-ENG-SPEC-001 Rev 2.2, Section 6.1 -- transcribed verbatim for disposable validation.
-- MIGRATION 00004.up.sql: FINANCIAL ACCOUNTS, CSV BATCHES, TRANSACTIONS & PAYMENT ALLOCATIONS

CREATE TABLE public.financial_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    type TEXT NOT NULL CHECK (type IN ('bank', 'cash', 'credit', 'escrow')),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    opening_balance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    exchange_rate_to_base NUMERIC(18,8) NOT NULL DEFAULT 1.00000000 CHECK (exchange_rate_to_base > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_financial_accounts_business_id UNIQUE (business_id, id)
);

CREATE TRIGGER trg_financial_accounts_updated_at
BEFORE UPDATE ON public.financial_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.financial_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'equity', 'debt')),
    is_tax_deductible BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_financial_categories_business_id UNIQUE (business_id, id),
    CONSTRAINT uq_financial_categories_name UNIQUE (business_id, name, type)
);

CREATE TABLE public.import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    filename TEXT NOT NULL,
    file_checksum_sha256 CHAR(64) NOT NULL,
    total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
    imported_rows INTEGER NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
    duplicate_rows INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_rows >= 0),
    error_rows INTEGER NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
    status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'committed', 'rolled_back', 'failed')),
    error_summary JSONB,
    committed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_import_batches_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_ib_account FOREIGN KEY (business_id, account_id)
        REFERENCES public.financial_accounts(business_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_import_batches_updated_at
BEFORE UPDATE ON public.import_batches
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.recurring_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    category_id UUID,
    amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'annually')),
    start_date DATE NOT NULL,
    end_date DATE,
    next_occurrence DATE NOT NULL,
    description TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_recurring_transactions_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_rt_account FOREIGN KEY (business_id, account_id)
        REFERENCES public.financial_accounts(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_rt_category FOREIGN KEY (business_id, category_id)
        REFERENCES public.financial_categories(business_id, id) ON DELETE SET NULL (category_id)
);

CREATE TRIGGER trg_recurring_transactions_updated_at
BEFORE UPDATE ON public.recurring_transactions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_id UUID,
    transfer_to_account_id UUID,
    participant_id UUID,
    category_id UUID,
    import_batch_id UUID,
    date DATE NOT NULL,
    amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    exchange_rate_to_base NUMERIC(18,8) NOT NULL DEFAULT 1.00000000 CHECK (exchange_rate_to_base > 0),
    transfer_to_amount NUMERIC(15,2) CHECK (transfer_to_amount IS NULL OR transfer_to_amount > 0),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    description TEXT NOT NULL CHECK (char_length(trim(description)) > 0),
    contribution_type TEXT NOT NULL DEFAULT 'operational' CHECK (contribution_type IN (
        'capital_contribution',
        'founder_loan',
        'reimbursable_expense',
        'third_party_equity',
        'third_party_grant',
        'third_party_loan',
        'operational'
    )),
    is_personal_founder_payment BOOLEAN NOT NULL DEFAULT FALSE,
    reimbursement_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (reimbursement_status IN ('not_applicable', 'pending', 'reimbursed')),
    reimbursed_by_transaction_id UUID,
    is_cleared BOOLEAN NOT NULL DEFAULT TRUE,
    is_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
    is_reversed BOOLEAN NOT NULL DEFAULT FALSE,
    reversed_by_id UUID,
    reversal_of_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_transactions_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_tx_account FOREIGN KEY (business_id, account_id)
        REFERENCES public.financial_accounts(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_transfer_to FOREIGN KEY (business_id, transfer_to_account_id)
        REFERENCES public.financial_accounts(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_participant FOREIGN KEY (business_id, participant_id)
        REFERENCES public.participants(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_category FOREIGN KEY (business_id, category_id)
        REFERENCES public.financial_categories(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_import_batch FOREIGN KEY (business_id, import_batch_id)
        REFERENCES public.import_batches(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_reimbursed_by FOREIGN KEY (business_id, reimbursed_by_transaction_id)
        REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_reversed_by FOREIGN KEY (business_id, reversed_by_id)
        REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_reversal_of FOREIGN KEY (business_id, reversal_of_id)
        REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_transactions_account_or_personal CHECK (
        (is_personal_founder_payment = FALSE AND account_id IS NOT NULL) OR
        (is_personal_founder_payment = TRUE AND account_id IS NULL AND type = 'expense' AND participant_id IS NOT NULL
         AND contribution_type IN ('reimbursable_expense', 'capital_contribution', 'founder_loan'))
    ),
    CONSTRAINT chk_transactions_transfer_accounts CHECK (
        (type = 'transfer' AND account_id IS NOT NULL AND transfer_to_account_id IS NOT NULL
         AND transfer_to_amount IS NOT NULL AND account_id <> transfer_to_account_id AND is_personal_founder_payment = FALSE) OR
        (type IN ('income', 'expense') AND transfer_to_account_id IS NULL AND transfer_to_amount IS NULL)
    ),
    CONSTRAINT chk_transactions_participant_required CHECK (
        (contribution_type IN ('capital_contribution', 'founder_loan', 'reimbursable_expense') AND participant_id IS NOT NULL) OR
        (contribution_type NOT IN ('capital_contribution', 'founder_loan', 'reimbursable_expense'))
    )
);

CREATE TRIGGER trg_transactions_updated_at
BEFORE UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.import_batch_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL,
    raw_row_index INTEGER NOT NULL CHECK (raw_row_index >= 0),
    fingerprint CHAR(64) NOT NULL,
    parsed_payload JSONB NOT NULL,
    has_potential_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
    matched_transaction_id UUID,
    target_overwrite_transaction_id UUID,
    resolution TEXT NOT NULL DEFAULT 'pending' CHECK (resolution IN ('pending', 'skip', 'overwrite', 'import_as_distinct')),
    row_status TEXT NOT NULL DEFAULT 'valid' CHECK (row_status IN ('valid', 'error', 'committed', 'skipped')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_import_batch_rows_business_id UNIQUE (business_id, id),
    CONSTRAINT uq_batch_row_index UNIQUE (batch_id, raw_row_index),
    CONSTRAINT fk_ibr_batch FOREIGN KEY (business_id, batch_id)
        REFERENCES public.import_batches(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_ibr_matched_tx FOREIGN KEY (business_id, matched_transaction_id)
        REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_ibr_overwrite_tx FOREIGN KEY (business_id, target_overwrite_transaction_id)
        REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_ibr_overwrite_target CHECK (
        (resolution = 'overwrite' AND target_overwrite_transaction_id IS NOT NULL) OR
        (resolution <> 'overwrite')
    )
);

CREATE TABLE public.payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    commitment_id UUID NOT NULL,
    transaction_id UUID NOT NULL,
    transaction_amount NUMERIC(15,2) NOT NULL CHECK (transaction_amount > 0),
    exchange_rate_to_commitment NUMERIC(18,8) NOT NULL DEFAULT 1.00000000 CHECK (exchange_rate_to_commitment > 0),
    amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    is_reversed BOOLEAN NOT NULL DEFAULT FALSE,
    reversed_at TIMESTAMPTZ,
    reversal_reason TEXT,
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT,
    CONSTRAINT uq_payment_allocations_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_pa_commitment FOREIGN KEY (business_id, commitment_id)
        REFERENCES public.funding_commitments(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_pa_transaction FOREIGN KEY (business_id, transaction_id)
        REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_pa_currency_conversion CHECK (
        amount = round(transaction_amount * exchange_rate_to_commitment, 2)
    )
);
