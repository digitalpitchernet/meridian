-- =====================================================================================
-- Meridian V1 · Gate 1 · Migration 3/6: capital structure and funding commitments.
-- All amounts are in businesses.base_currency (single currency per business; there are
-- deliberately no currency columns below the tenant root).
-- Ownership (participants.agreed_equity_percentage), capital targets and allocations
-- are independent records; nothing here derives one from another.
-- =====================================================================================

CREATE TABLE public.capital_structures (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id             uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    title                   text NOT NULL DEFAULT 'Primary capital structure' CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    agreed_capital_target   numeric(15,2) NOT NULL CHECK (agreed_capital_target >= 0),
    contribution_basis      text,
    effective_date          date NOT NULL DEFAULT CURRENT_DATE,
    is_current              boolean NOT NULL DEFAULT true,
    notes                   text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_capital_structures_business UNIQUE (business_id, id)
);

CREATE TABLE public.capital_targets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    structure_id    uuid NOT NULL,
    name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    target_amount   numeric(15,2) NOT NULL CHECK (target_amount > 0),
    target_date     date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_capital_targets_business UNIQUE (business_id, id),
    CONSTRAINT uq_capital_targets_structure UNIQUE (business_id, structure_id, id),
    CONSTRAINT fk_ct_structure FOREIGN KEY (business_id, structure_id) REFERENCES public.capital_structures(business_id, id) ON DELETE CASCADE
);

-- Participant capital allocation: what a participant is expected to contribute (not ownership, not cash).
CREATE TABLE public.participant_capital_allocations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    structure_id        uuid NOT NULL,
    capital_target_id   uuid,
    participant_id      uuid NOT NULL,
    allocated_amount    numeric(15,2) NOT NULL CHECK (allocated_amount > 0),
    basis_notes         text,
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_pca_business UNIQUE (business_id, id),
    CONSTRAINT fk_pca_structure FOREIGN KEY (business_id, structure_id) REFERENCES public.capital_structures(business_id, id) ON DELETE RESTRICT,
    -- a target, when given, must belong to the same structure (enforced by the key, no trigger needed)
    CONSTRAINT fk_pca_target FOREIGN KEY (business_id, structure_id, capital_target_id)
        REFERENCES public.capital_targets(business_id, structure_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_pca_participant FOREIGN KEY (business_id, participant_id) REFERENCES public.participants(business_id, id) ON DELETE RESTRICT
);

-- Over-allocation is surfaced, never blocked or auto-corrected.
CREATE VIEW public.vw_capital_target_summary WITH (security_invoker = true) AS
SELECT ct.business_id, ct.structure_id, ct.id AS capital_target_id, ct.name, ct.target_amount,
       COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active), 0)::numeric(15,2) AS allocated_amount,
       GREATEST(ct.target_amount - COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active), 0), 0)::numeric(15,2) AS unallocated_amount,
       GREATEST(COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active), 0) - ct.target_amount, 0)::numeric(15,2) AS over_allocated_amount,
       CASE WHEN COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active), 0) < ct.target_amount THEN 'under_allocated'
            WHEN COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active), 0) = ct.target_amount THEN 'fully_allocated'
            ELSE 'over_allocated' END AS allocation_status
FROM public.capital_targets ct
LEFT JOIN public.participant_capital_allocations pca
       ON pca.business_id = ct.business_id AND pca.capital_target_id = ct.id
GROUP BY ct.business_id, ct.structure_id, ct.id, ct.name, ct.target_amount;

CREATE VIEW public.vw_capital_structure_summary WITH (security_invoker = true) AS
SELECT cs.business_id, cs.id AS structure_id, cs.title, cs.agreed_capital_target, cs.is_current,
       a.allocated_amount,
       GREATEST(cs.agreed_capital_target - a.allocated_amount, 0)::numeric(15,2) AS unallocated_amount,
       GREATEST(a.allocated_amount - cs.agreed_capital_target, 0)::numeric(15,2) AS over_allocated_amount,
       CASE WHEN a.allocated_amount < cs.agreed_capital_target THEN 'under_allocated'
            WHEN a.allocated_amount = cs.agreed_capital_target THEN 'fully_allocated'
            ELSE 'over_allocated' END AS allocation_status,
       t.total_target_amount,
       GREATEST(t.total_target_amount - cs.agreed_capital_target, 0)::numeric(15,2) AS targets_exceed_structure_by,
       t.over_allocated_target_count
FROM public.capital_structures cs
CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(pca.allocated_amount) FILTER (WHERE pca.is_active), 0)::numeric(15,2) AS allocated_amount
    FROM public.participant_capital_allocations pca
    WHERE pca.business_id = cs.business_id AND pca.structure_id = cs.id) a
CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(s.target_amount), 0)::numeric(15,2) AS total_target_amount,
           COUNT(*) FILTER (WHERE s.allocation_status = 'over_allocated')::integer AS over_allocated_target_count
    FROM public.vw_capital_target_summary s
    WHERE s.business_id = cs.business_id AND s.structure_id = cs.id) t;

-- Funding requirement -> commitment -> payment (allocation, migration 4) -> reconciliation (views, migration 4)
CREATE TABLE public.funding_requirements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    project_id      uuid,
    milestone_id    uuid,
    title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    required_amount numeric(15,2) NOT NULL CHECK (required_amount > 0),
    needed_by       date,
    lifecycle       text NOT NULL DEFAULT 'open' CHECK (lifecycle IN ('draft', 'open', 'closed', 'cancelled')),
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_funding_requirements_business UNIQUE (business_id, id),
    CONSTRAINT fk_fr_project FOREIGN KEY (business_id, project_id) REFERENCES public.projects(business_id, id) ON DELETE SET NULL (project_id),
    CONSTRAINT fk_fr_milestone FOREIGN KEY (business_id, milestone_id) REFERENCES public.milestones(business_id, id) ON DELETE SET NULL (milestone_id)
);

-- Commitment status is NOT stored: it is derived from active allocations in
-- vw_funding_commitment_status (migration 4), so it can never be forged or go stale.
CREATE TABLE public.funding_commitments (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id             uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    requirement_id          uuid NOT NULL,
    participant_id          uuid,
    funder_name             text NOT NULL CHECK (char_length(btrim(funder_name)) BETWEEN 1 AND 200),
    committed_amount        numeric(15,2) NOT NULL CHECK (committed_amount > 0),
    expected_payment_date   date,
    notes                   text,
    revoked_at              timestamptz,
    revocation_reason       text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_funding_commitments_business UNIQUE (business_id, id),
    CONSTRAINT fk_fc_requirement FOREIGN KEY (business_id, requirement_id) REFERENCES public.funding_requirements(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_fc_participant FOREIGN KEY (business_id, participant_id) REFERENCES public.participants(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_fc_revocation CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL))
);

CREATE FUNCTION public.guard_funding_commitment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'commitment % is revoked and can no longer change', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.requirement_id IS DISTINCT FROM OLD.requirement_id OR NEW.participant_id IS DISTINCT FROM OLD.participant_id
       OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
        RAISE EXCEPTION 'a commitment cannot move to another requirement, participant or business' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_fc_guard BEFORE UPDATE ON public.funding_commitments FOR EACH ROW EXECUTE FUNCTION public.guard_funding_commitment();
CREATE TRIGGER trg_fc_no_delete BEFORE DELETE ON public.funding_commitments FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
CREATE TRIGGER trg_fc_no_truncate BEFORE TRUNCATE ON public.funding_commitments FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['capital_structures', 'capital_targets', 'participant_capital_allocations', 'funding_requirements', 'funding_commitments'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY %1$s_tenant ON public.%1$I FOR ALL TO authenticated USING (business_id = public.get_current_business_id()) WITH CHECK (business_id = public.get_current_business_id())', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('REVOKE TRUNCATE ON public.%I FROM service_role', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['funding_requirements', 'funding_commitments'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%1$s_activity AFTER INSERT OR UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.record_activity()', t);
    END LOOP;
END $$;

GRANT SELECT, INSERT, DELETE ON public.capital_structures, public.capital_targets, public.participant_capital_allocations TO authenticated;
GRANT UPDATE (title, agreed_capital_target, contribution_basis, effective_date, is_current, notes) ON public.capital_structures TO authenticated;
GRANT UPDATE (name, target_amount, target_date) ON public.capital_targets TO authenticated;
GRANT UPDATE (capital_target_id, allocated_amount, basis_notes, is_active) ON public.participant_capital_allocations TO authenticated;

GRANT SELECT, INSERT, DELETE ON public.funding_requirements TO authenticated;
GRANT UPDATE (project_id, milestone_id, title, required_amount, needed_by, lifecycle, notes) ON public.funding_requirements TO authenticated;

-- Commitments: revocation columns are written only by revoke_funding_commitment(); no client DELETE.
GRANT SELECT ON public.funding_commitments TO authenticated;
GRANT INSERT (business_id, requirement_id, participant_id, funder_name, committed_amount, expected_payment_date, notes) ON public.funding_commitments TO authenticated;
GRANT UPDATE (funder_name, committed_amount, expected_payment_date, notes) ON public.funding_commitments TO authenticated;
REVOKE DELETE ON public.funding_commitments FROM service_role;

REVOKE ALL ON public.vw_capital_target_summary, public.vw_capital_structure_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_capital_target_summary, public.vw_capital_structure_summary TO authenticated;
REVOKE ALL ON FUNCTION public.guard_funding_commitment() FROM PUBLIC, anon, authenticated;

CREATE INDEX idx_pca_structure ON public.participant_capital_allocations (business_id, structure_id) WHERE is_active;
CREATE INDEX idx_pca_target ON public.participant_capital_allocations (business_id, capital_target_id) WHERE is_active;
CREATE INDEX idx_commitments_requirement ON public.funding_commitments (business_id, requirement_id);
