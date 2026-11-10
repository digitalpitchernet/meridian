// Mirror of Gate 1 migration 6 (20261107182442_vault_and_integrations.sql): documents, document_links,
// integration_connections. Same spec format as schema.js / schema-finance.js. The migration is the authority.
// Storage (the company-vault bucket and its policies) is NOT emulated: the development build stores no file bytes.

const uuid = { type: 'uuid' };
const id = { type: 'uuid', notNull: true, default: 'uuid' };
const businessId = { type: 'uuid', notNull: true };
const ts = { type: 'timestamptz', notNull: true, default: 'now' };
const text = { type: 'text' };

export const VAULT_ENUMS = {
  category: ['Legal', 'Financial', 'Technical', 'Marketing', 'Administrative', 'Other'],
  provider: ['supabase_storage', 'external_connector', 'google_drive'],
};
// document_links: exactly one of these is set (chk_dl_one_target)
export const LINK_TARGETS = ['project_id', 'milestone_id', 'task_id', 'decision_id', 'contact_id', 'transaction_id', 'commitment_id', 'requirement_id'];

export const VAULT_TABLES = {
  documents: {
    // archive-only: no DELETE for anyone (trg_documents_no_delete -> reject_mutation)
    columns: {
      id, business_id: businessId, title: { ...text, notNull: true, len: [1, 300] },
      category: { ...text, notNull: true, enum: VAULT_ENUMS.category }, storage_provider: { ...text, notNull: true, enum: VAULT_ENUMS.provider },
      storage_key: { ...text, notNull: true, rawLen: [1, 512] }, original_filename: { ...text, notNull: true, rawLen: [1, 255] }, mime_type: { ...text, notNull: true },
      size_bytes: { type: 'int', notNull: true, between: [0, 52428800] }, sha256: { ...text, notNull: true, pattern: /^[0-9a-f]{64}$/ },
      version_number: { type: 'int', notNull: true, default: 1, between: [1, 2147483647] }, previous_version_id: uuid,
      is_archived: { type: 'bool', notNull: true, default: false }, uploaded_by: { ...uuid, default: 'auth_uid' }, created_at: ts, updated_at: ts,
    },
    insert: ['business_id', 'title', 'category', 'storage_provider', 'storage_key', 'original_filename', 'mime_type', 'size_bytes', 'sha256', 'version_number', 'previous_version_id'],
    update: ['title', 'category', 'is_archived'], delete: false,
    fks: [{ col: 'previous_version_id', ref: 'documents', onDelete: 'restrict' }, { col: 'uploaded_by', ref: 'profiles', onDelete: 'set null' }],
    checks: [r => r.storage_provider === 'google_drive' || String(r.storage_key).startsWith(`${r.business_id}/`) || 'chk_documents_key_scope'],
    uniques: [{ cols: ['business_id', 'storage_provider', 'storage_key'], name: 'uq_documents_object' }],
    activity: ['insert'],
  },
  document_links: {
    columns: {
      id, business_id: businessId, document_id: { ...uuid, notNull: true }, ...Object.fromEntries(LINK_TARGETS.map(c => [c, uuid])), created_at: ts,
    },
    insert: ['business_id', 'document_id', ...LINK_TARGETS], update: false, delete: true,
    fks: [{ col: 'document_id', ref: 'documents', onDelete: 'cascade' }, { col: 'project_id', ref: 'projects', onDelete: 'cascade' },
          { col: 'milestone_id', ref: 'milestones', onDelete: 'cascade' }, { col: 'task_id', ref: 'tasks', onDelete: 'cascade' },
          { col: 'decision_id', ref: 'decisions', onDelete: 'cascade' }, { col: 'contact_id', ref: 'contacts', onDelete: 'cascade' },
          { col: 'transaction_id', ref: 'transactions', onDelete: 'restrict' }, { col: 'commitment_id', ref: 'funding_commitments', onDelete: 'restrict' },
          { col: 'requirement_id', ref: 'funding_requirements', onDelete: 'cascade' }],
    checks: [r => LINK_TARGETS.filter(c => r[c] != null).length === 1 || 'chk_dl_one_target'],
    // uq_document_links_target: (business_id, document_id, COALESCE(<targets>))
    uniques: [{ cols: ['business_id', 'document_id'], key: r => LINK_TARGETS.map(c => r[c]).find(v => v != null) ?? null, name: 'uq_document_links_target' }],
  },
  integration_connections: {
    // registry only; clients may SELECT some columns and write nothing (OAuth is a server-side flow, Gate 2)
    columns: {
      id, business_id: businessId, provider: { ...text, notNull: true, enum: ['google_drive', 'google_calendar', 'gmail'] },
      status: { ...text, notNull: true, default: 'disconnected', enum: ['connected', 'disconnected', 'error', 'revoked'] },
      granted_scopes: { type: 'jsonb', notNull: true, default: () => [] }, account_label: text, vault_secret_id: uuid,
      last_synced_at: { type: 'timestamptz' }, last_error: text, created_at: ts, updated_at: ts,
    },
    insert: false, update: false, delete: false,
    uniques: [{ cols: ['business_id', 'provider'], name: 'uq_integration_provider' }],
  },
};
