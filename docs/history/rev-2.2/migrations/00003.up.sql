-- MER-ENG-SPEC-001 Rev 2.2, Section 6.1 -- transcribed verbatim for disposable validation.
-- MIGRATION 00003.up.sql: CAPITAL STRUCTURES, PARTICIPANT ALLOCATIONS & FUNDING COMMITMENTS

CREATE TABLE public.capital_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Primary Capital Structure',
    agreed_capital_target NUMERIC(15,2) NOT NULL CHECK (agreed_capital_target >= 0),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    allocation_basis_type TEXT NOT NULL DEFAULT 'explicit_custom' CHECK (allocation_basis_type IN ('explicit_custom', 'fixed_tranche', 'unallocated')),
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_capital_structures_business_id UNIQUE (business_id, id)
);

CREATE TRIGGER trg_capital_structures_updated_at
BEFORE UPDATE ON public.capital_structures
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.capital_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    structure_id UUID NOT NULL,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    target_amount NUMERIC(15,2) NOT NULL CHECK (target_amount > 0),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    phase TEXT NOT NULL,
    target_date DATE,
    is_achieved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_capital_targets_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_ct_structure FOREIGN KEY (business_id, structure_id)
        REFERENCES public.capital_structures(business_id, id) ON DELETE CASCADE
);

CREATE TRIGGER trg_capital_targets_updated_at
BEFORE UPDATE ON public.capital_targets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.participant_capital_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    structure_id UUID NOT NULL,
    capital_target_id UUID,
    participant_id UUID NOT NULL,
    allocated_amount NUMERIC(15,2) NOT NULL CHECK (allocated_amount >= 0),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    allocation_basis_notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pca_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_pca_structure FOREIGN KEY (business_id, structure_id)
        REFERENCES public.capital_structures(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_pca_target FOREIGN KEY (business_id, capital_target_id)
        REFERENCES public.capital_targets(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_pca_participant FOREIGN KEY (business_id, participant_id)
        REFERENCES public.participants(business_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_pca_updated_at
BEFORE UPDATE ON public.participant_capital_allocations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_capital_currency_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_struct_currency CHAR(3);
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

    IF TG_TABLE_NAME = 'participant_capital_allocations' AND NEW.capital_target_id IS NOT NULL THEN
        SELECT structure_id, currency INTO v_target_structure_id, v_target_currency
        FROM public.capital_targets
        WHERE business_id = NEW.business_id AND id = NEW.capital_target_id;

        IF v_target_structure_id <> NEW.structure_id THEN
            RAISE EXCEPTION 'Capital target % does not belong to capital structure %',
                NEW.capital_target_id, NEW.structure_id;
        END IF;

        IF NEW.currency <> v_target_currency THEN
            RAISE EXCEPTION 'Participant allocation currency (%) must match capital_targets.currency (%)',
                NEW.currency, v_target_currency;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_capital_target_currency
BEFORE INSERT OR UPDATE ON public.capital_targets
FOR EACH ROW EXECUTE FUNCTION public.enforce_capital_currency_consistency();

CREATE TRIGGER trg_enforce_pca_currency
BEFORE INSERT OR UPDATE ON public.participant_capital_allocations
FOR EACH ROW EXECUTE FUNCTION public.enforce_capital_currency_consistency();

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
    END AS allocation_status
FROM public.capital_structures cs
LEFT JOIN public.participant_capital_allocations pca
    ON pca.business_id = cs.business_id AND pca.structure_id = cs.id
GROUP BY cs.business_id, cs.id, cs.title, cs.currency, cs.agreed_capital_target;

CREATE TABLE public.funding_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id UUID,
    milestone_id UUID,
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    target_amount NUMERIC(15,2) NOT NULL CHECK (target_amount > 0),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'partially_funded', 'funded', 'cancelled')),
    deadline DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_funding_requirements_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_fr_project FOREIGN KEY (business_id, project_id)
        REFERENCES public.projects(business_id, id) ON DELETE SET NULL (project_id),
    CONSTRAINT fk_fr_milestone FOREIGN KEY (business_id, milestone_id)
        REFERENCES public.milestones(business_id, id) ON DELETE SET NULL (milestone_id)
);

CREATE TRIGGER trg_funding_requirements_updated_at
BEFORE UPDATE ON public.funding_requirements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.funding_commitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    requirement_id UUID NOT NULL,
    participant_id UUID,
    funder_name TEXT NOT NULL CHECK (char_length(trim(funder_name)) > 0),
    committed_amount NUMERIC(15,2) NOT NULL CHECK (committed_amount > 0),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    expected_payment_date DATE,
    status TEXT NOT NULL DEFAULT 'pledged' CHECK (status IN ('pledged', 'partially_paid', 'fulfilled', 'over_allocated', 'revoked')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_funding_commitments_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_fc_requirement FOREIGN KEY (business_id, requirement_id)
        REFERENCES public.funding_requirements(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_fc_participant FOREIGN KEY (business_id, participant_id)
        REFERENCES public.participants(business_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_funding_commitments_updated_at
BEFORE UPDATE ON public.funding_commitments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_commitment_currency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_req_currency CHAR(3);
BEGIN
    SELECT currency INTO v_req_currency
    FROM public.funding_requirements
    WHERE business_id = NEW.business_id AND id = NEW.requirement_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Funding requirement % not found in business %', NEW.requirement_id, NEW.business_id;
    END IF;

    IF NEW.currency <> v_req_currency THEN
        RAISE EXCEPTION 'Commitment currency (%) must match funding requirement currency (%)',
            NEW.currency, v_req_currency;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_commitment_currency
BEFORE INSERT OR UPDATE ON public.funding_commitments
FOR EACH ROW EXECUTE FUNCTION public.enforce_commitment_currency();
