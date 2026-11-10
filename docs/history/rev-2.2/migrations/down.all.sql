-- MER-ENG-SPEC-001 Rev 2.2, Section 6.2 -- transcribed verbatim, 00007.down -> 00001.down in order.

-- 00007.down.sql
DROP INDEX IF EXISTS public.idx_outbox_pending;
DROP INDEX IF EXISTS public.idx_activity_business_created;
DROP INDEX IF EXISTS public.uq_doc_assoc_comm;
DROP INDEX IF EXISTS public.uq_doc_assoc_tran;
DROP INDEX IF EXISTS public.uq_doc_assoc_cont;
DROP INDEX IF EXISTS public.uq_doc_assoc_decs;
DROP INDEX IF EXISTS public.uq_doc_assoc_task;
DROP INDEX IF EXISTS public.uq_doc_assoc_mile;
DROP INDEX IF EXISTS public.uq_doc_assoc_proj;
DROP INDEX IF EXISTS public.idx_documents_business_category;
DROP INDEX IF EXISTS public.idx_allocations_transaction;
DROP INDEX IF EXISTS public.idx_allocations_commitment;
DROP INDEX IF EXISTS public.idx_import_rows_batch_fingerprint;
DROP INDEX IF EXISTS public.idx_transactions_account_cleared;
DROP INDEX IF EXISTS public.idx_transactions_business_date;
DROP INDEX IF EXISTS public.idx_commitments_requirement;
DROP INDEX IF EXISTS public.idx_calendar_business_window;
DROP INDEX IF EXISTS public.idx_decisions_business_status;
DROP INDEX IF EXISTS public.idx_contact_interactions_contact;
DROP INDEX IF EXISTS public.idx_contacts_business_category;
DROP INDEX IF EXISTS public.idx_subtasks_task;
DROP INDEX IF EXISTS public.idx_tasks_project_status;
DROP INDEX IF EXISTS public.idx_milestones_project_status;
DROP INDEX IF EXISTS public.idx_projects_business_status;
DROP INDEX IF EXISTS public.idx_participants_business;

-- 00006.down.sql
DROP POLICY IF EXISTS vault_storage_delete ON storage.objects;
DROP POLICY IF EXISTS vault_storage_insert ON storage.objects;
DROP POLICY IF EXISTS vault_storage_select ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'company_vault';

DROP FUNCTION IF EXISTS public.complete_outbox_item(UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.claim_outbox_batch(INTEGER);

DROP TRIGGER IF EXISTS trg_payment_allocations_activity ON public.payment_allocations;
DROP TRIGGER IF EXISTS trg_transactions_activity ON public.transactions;
DROP TRIGGER IF EXISTS trg_funding_commitments_activity ON public.funding_commitments;
DROP TRIGGER IF EXISTS trg_decisions_activity ON public.decisions;
DROP TRIGGER IF EXISTS trg_milestones_activity ON public.milestones;
DROP TRIGGER IF EXISTS trg_tasks_activity ON public.tasks;
DROP TRIGGER IF EXISTS trg_projects_activity ON public.projects;
DROP FUNCTION IF EXISTS public.record_domain_activity();

DROP TABLE IF EXISTS public.transactional_outbox;
DROP TRIGGER IF EXISTS trg_prevent_activity_mutation ON public.activity_records;
DROP FUNCTION IF EXISTS public.prevent_activity_mutation();
DROP TABLE IF EXISTS public.activity_records;
DROP TRIGGER IF EXISTS trg_integration_connections_updated_at ON public.integration_connections;
DROP TABLE IF EXISTS public.integration_connections;
DROP TABLE IF EXISTS public.document_associations;
DROP TRIGGER IF EXISTS trg_documents_updated_at ON public.documents;
DROP TABLE IF EXISTS public.documents;

-- 00005.down.sql
DROP FUNCTION IF EXISTS public.commit_import_batch(UUID);
DROP TRIGGER IF EXISTS trg_no_delete_payment_allocations ON public.payment_allocations;
DROP TRIGGER IF EXISTS trg_no_delete_transactions ON public.transactions;
DROP FUNCTION IF EXISTS public.prevent_financial_history_deletion();
DROP TRIGGER IF EXISTS trg_cascade_transaction_reversal ON public.transactions;
DROP FUNCTION IF EXISTS public.cascade_transaction_reversal();
DROP TRIGGER IF EXISTS trg_sync_commitment_status ON public.payment_allocations;
DROP FUNCTION IF EXISTS public.sync_funding_commitment_status();
DROP TRIGGER IF EXISTS trg_enforce_payment_allocation ON public.payment_allocations;
DROP FUNCTION IF EXISTS public.enforce_payment_allocation_invariants();
DROP TRIGGER IF EXISTS trg_enforce_transaction_currency ON public.transactions;
DROP FUNCTION IF EXISTS public.enforce_transaction_currency_and_transfer();

-- 00004.down.sql
DROP TABLE IF EXISTS public.payment_allocations;
DROP TABLE IF EXISTS public.import_batch_rows;
DROP TRIGGER IF EXISTS trg_transactions_updated_at ON public.transactions;
DROP TABLE IF EXISTS public.transactions;
DROP TRIGGER IF EXISTS trg_recurring_transactions_updated_at ON public.recurring_transactions;
DROP TABLE IF EXISTS public.recurring_transactions;
DROP TRIGGER IF EXISTS trg_import_batches_updated_at ON public.import_batches;
DROP TABLE IF EXISTS public.import_batches;
DROP TABLE IF EXISTS public.financial_categories;
DROP TRIGGER IF EXISTS trg_financial_accounts_updated_at ON public.financial_accounts;
DROP TABLE IF EXISTS public.financial_accounts;

-- 00003.down.sql
DROP TRIGGER IF EXISTS trg_enforce_commitment_currency ON public.funding_commitments;
DROP FUNCTION IF EXISTS public.enforce_commitment_currency();
DROP TRIGGER IF EXISTS trg_funding_commitments_updated_at ON public.funding_commitments;
DROP TABLE IF EXISTS public.funding_commitments;
DROP TRIGGER IF EXISTS trg_funding_requirements_updated_at ON public.funding_requirements;
DROP TABLE IF EXISTS public.funding_requirements;
DROP VIEW IF EXISTS public.vw_capital_structure_allocation_summary;
DROP TRIGGER IF EXISTS trg_enforce_pca_currency ON public.participant_capital_allocations;
DROP TRIGGER IF EXISTS trg_enforce_capital_target_currency ON public.capital_targets;
DROP FUNCTION IF EXISTS public.enforce_capital_currency_consistency();
DROP TRIGGER IF EXISTS trg_pca_updated_at ON public.participant_capital_allocations;
DROP TABLE IF EXISTS public.participant_capital_allocations;
DROP TRIGGER IF EXISTS trg_capital_targets_updated_at ON public.capital_targets;
DROP TABLE IF EXISTS public.capital_targets;
DROP TRIGGER IF EXISTS trg_capital_structures_updated_at ON public.capital_structures;
DROP TABLE IF EXISTS public.capital_structures;

-- 00002.down.sql
DROP TRIGGER IF EXISTS trg_calendar_events_updated_at ON public.calendar_events;
DROP TABLE IF EXISTS public.calendar_events;
ALTER TABLE IF EXISTS public.decisions DROP CONSTRAINT IF EXISTS fk_decisions_selected_option;
DROP TABLE IF EXISTS public.decision_options;
DROP TRIGGER IF EXISTS trg_decisions_updated_at ON public.decisions;
DROP TABLE IF EXISTS public.decisions;
DROP TRIGGER IF EXISTS trg_subtasks_updated_at ON public.subtasks;
DROP TABLE IF EXISTS public.subtasks;
DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks;
DROP TABLE IF EXISTS public.tasks;
DROP TRIGGER IF EXISTS trg_milestones_updated_at ON public.milestones;
DROP TABLE IF EXISTS public.milestones;
DROP TRIGGER IF EXISTS trg_contact_interactions_updated_at ON public.contact_interactions;
DROP TABLE IF EXISTS public.contact_interactions;
DROP TABLE IF EXISTS public.project_contacts;
DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
DROP TABLE IF EXISTS public.projects;
DROP TRIGGER IF EXISTS trg_contacts_updated_at ON public.contacts;
DROP TABLE IF EXISTS public.contacts;

-- 00001.down.sql
DROP FUNCTION IF EXISTS public.get_current_business_id() CASCADE;
DROP TRIGGER IF EXISTS trg_participants_updated_at ON public.participants;
DROP TABLE IF EXISTS public.participants;
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
DROP TABLE IF EXISTS public.profiles;
DROP TRIGGER IF EXISTS trg_businesses_updated_at ON public.businesses;
DROP TABLE IF EXISTS public.businesses;
DROP FUNCTION IF EXISTS public.set_updated_at();
