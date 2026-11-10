-- MER-ENG-SPEC-001 Rev 2.2, Section 6.1 -- transcribed verbatim for disposable validation.
-- MIGRATION 00007.up.sql: INDEXES & PERFORMANCE OPTIMIZATION

CREATE INDEX idx_participants_business ON public.participants(business_id) WHERE is_active = TRUE;
CREATE INDEX idx_projects_business_status ON public.projects(business_id, status);
CREATE INDEX idx_milestones_project_status ON public.milestones(business_id, project_id, status, due_date);
CREATE INDEX idx_tasks_project_status ON public.tasks(business_id, project_id, status, due_date);
CREATE INDEX idx_subtasks_task ON public.subtasks(business_id, task_id);
CREATE INDEX idx_contacts_business_category ON public.contacts(business_id, category);
CREATE INDEX idx_contact_interactions_contact ON public.contact_interactions(business_id, contact_id, interaction_date DESC);
CREATE INDEX idx_decisions_business_status ON public.decisions(business_id, status, decision_date DESC);
CREATE INDEX idx_calendar_business_window ON public.calendar_events(business_id, start_time, end_time);
CREATE INDEX idx_commitments_requirement ON public.funding_commitments(business_id, requirement_id, status);
CREATE INDEX idx_transactions_business_date ON public.transactions(business_id, date DESC) WHERE is_reversed = FALSE;
CREATE INDEX idx_transactions_account_cleared ON public.transactions(business_id, account_id, is_cleared) WHERE is_reversed = FALSE;
CREATE INDEX idx_import_rows_batch_fingerprint ON public.import_batch_rows(business_id, batch_id, fingerprint);
CREATE INDEX idx_allocations_commitment ON public.payment_allocations(business_id, commitment_id) WHERE is_reversed = FALSE;
CREATE INDEX idx_allocations_transaction ON public.payment_allocations(business_id, transaction_id) WHERE is_reversed = FALSE;
CREATE INDEX idx_documents_business_category ON public.documents(business_id, category) WHERE is_archived = FALSE;
CREATE UNIQUE INDEX uq_doc_assoc_proj ON public.document_associations(document_id, project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_assoc_mile ON public.document_associations(document_id, milestone_id) WHERE milestone_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_assoc_task ON public.document_associations(document_id, task_id) WHERE task_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_assoc_decs ON public.document_associations(document_id, decision_id) WHERE decision_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_assoc_cont ON public.document_associations(document_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_assoc_tran ON public.document_associations(document_id, transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_assoc_comm ON public.document_associations(document_id, commitment_id) WHERE commitment_id IS NOT NULL;
CREATE INDEX idx_activity_business_created ON public.activity_records(business_id, created_at DESC);
CREATE INDEX idx_outbox_pending ON public.transactional_outbox(status, available_at) WHERE status IN ('pending', 'failed');
