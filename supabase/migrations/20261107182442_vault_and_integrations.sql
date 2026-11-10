-- =====================================================================================
-- Meridian V1 · Gate 1 · Migration 6/6: Company Vault metadata, Supabase Storage
-- bucket + policies, integration connection registry.
-- Files live in exactly one provider (no mirroring). The database row is the index;
-- sha256 + size make every file verifiable after a restore.
-- =====================================================================================

CREATE TABLE public.documents (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id             uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    title                   text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    category                text NOT NULL CHECK (category IN ('Legal', 'Financial', 'Technical', 'Marketing', 'Administrative', 'Other')),
    storage_provider        text NOT NULL CHECK (storage_provider IN ('supabase_storage', 'external_connector', 'google_drive')),
    storage_key             text NOT NULL CHECK (char_length(storage_key) BETWEEN 1 AND 512),
    original_filename       text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
    mime_type               text NOT NULL,
    size_bytes              bigint NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 52428800),
    sha256                  text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    version_number          integer NOT NULL DEFAULT 1 CHECK (version_number >= 1),
    previous_version_id     uuid,
    is_archived             boolean NOT NULL DEFAULT false,
    uploaded_by             uuid DEFAULT auth.uid(),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_documents_business UNIQUE (business_id, id),
    CONSTRAINT uq_documents_object UNIQUE (business_id, storage_provider, storage_key),
    CONSTRAINT fk_documents_previous FOREIGN KEY (business_id, previous_version_id) REFERENCES public.documents(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_documents_uploader FOREIGN KEY (business_id, uploaded_by) REFERENCES public.profiles(business_id, id) ON DELETE SET NULL (uploaded_by),
    -- Supabase Storage and connector keys are always inside the business folder
    CONSTRAINT chk_documents_key_scope CHECK (storage_provider = 'google_drive' OR storage_key LIKE business_id::text || '/%')
);

CREATE TABLE public.document_links (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    document_id     uuid NOT NULL,
    project_id      uuid,
    milestone_id    uuid,
    task_id         uuid,
    decision_id     uuid,
    contact_id      uuid,
    transaction_id  uuid,
    commitment_id   uuid,
    requirement_id  uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_document_links_business UNIQUE (business_id, id),
    CONSTRAINT fk_dl_document FOREIGN KEY (business_id, document_id) REFERENCES public.documents(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_dl_project FOREIGN KEY (business_id, project_id) REFERENCES public.projects(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_dl_milestone FOREIGN KEY (business_id, milestone_id) REFERENCES public.milestones(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_dl_task FOREIGN KEY (business_id, task_id) REFERENCES public.tasks(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_dl_decision FOREIGN KEY (business_id, decision_id) REFERENCES public.decisions(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_dl_contact FOREIGN KEY (business_id, contact_id) REFERENCES public.contacts(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_dl_transaction FOREIGN KEY (business_id, transaction_id) REFERENCES public.transactions(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_dl_commitment FOREIGN KEY (business_id, commitment_id) REFERENCES public.funding_commitments(business_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_dl_requirement FOREIGN KEY (business_id, requirement_id) REFERENCES public.funding_requirements(business_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_dl_one_target CHECK (num_nonnulls(project_id, milestone_id, task_id, decision_id, contact_id, transaction_id, commitment_id, requirement_id) = 1)
);
CREATE UNIQUE INDEX uq_document_links_target ON public.document_links (business_id, document_id,
    COALESCE(project_id, milestone_id, task_id, decision_id, contact_id, transaction_id, commitment_id, requirement_id));

-- Registry only. OAuth tokens are never stored here: they go to Supabase Vault (vault.secrets)
-- through a server-side flow, and only the secret's id is kept. Clients cannot read that id.
CREATE TABLE public.integration_connections (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    provider            text NOT NULL CHECK (provider IN ('google_drive', 'google_calendar', 'gmail')),
    status              text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error', 'revoked')),
    granted_scopes      text[] NOT NULL DEFAULT '{}',
    account_label       text,
    vault_secret_id     uuid,
    last_synced_at      timestamptz,
    last_error          text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_integration_connections_business UNIQUE (business_id, id),
    CONSTRAINT uq_integration_provider UNIQUE (business_id, provider)
);

CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_documents_no_delete BEFORE DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
CREATE TRIGGER trg_documents_activity AFTER INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.record_activity();
CREATE TRIGGER trg_integrations_updated_at BEFORE UPDATE ON public.integration_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['documents', 'document_links', 'integration_connections'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY %1$s_tenant ON public.%1$I FOR ALL TO authenticated USING (business_id = public.get_current_business_id()) WITH CHECK (business_id = public.get_current_business_id())', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('REVOKE TRUNCATE ON public.%I FROM service_role', t);
    END LOOP;
END $$;

GRANT SELECT ON public.documents TO authenticated;
GRANT INSERT (business_id, title, category, storage_provider, storage_key, original_filename, mime_type, size_bytes, sha256,
              version_number, previous_version_id) ON public.documents TO authenticated;
GRANT UPDATE (title, category, is_archived) ON public.documents TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.document_links TO authenticated;
GRANT SELECT (id, business_id, provider, status, granted_scopes, account_label, last_synced_at, last_error, created_at, updated_at)
    ON public.integration_connections TO authenticated;

CREATE INDEX idx_documents_business_category ON public.documents (business_id, category) WHERE NOT is_archived;
CREATE INDEX idx_document_links_document ON public.document_links (business_id, document_id);

-- -------------------------------------------------------------------------------------
-- Supabase Storage: private bucket, objects under "<business_id>/...". Founders can
-- upload and read their own folder; nobody but the server can overwrite or delete.
-- Folder comparison is textual so a malformed object name cannot break listings (Rev 2.2 D-07).
-- -------------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('company-vault', 'company-vault', false, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY company_vault_read ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'company-vault' AND (storage.foldername(name))[1] = public.get_current_business_id()::text);
CREATE POLICY company_vault_upload ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'company-vault' AND (storage.foldername(name))[1] = public.get_current_business_id()::text);
