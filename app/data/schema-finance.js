// Mirror of the Gate 1 finance schema: migrations 3 (capital and funding), 4 (ledger) and 5 (CSV import).
// Same column/table spec as schema.js, plus:
//   type 'money' = numeric(15,2), carried as numeric text; gt0 / gte0 are the amount CHECKs
//   uniques: [{ cols, where? }]   activity: ['insert', 'update'] (the ops record_activity() is attached to)
//   guards: BEFORE/AFTER trigger functions, ported from the migrations. q is the adapter's server-side view of the
//   caller's business: q.one(table, pred), q.all(table, pred), q.sysUpdate(table, row, patch), q.log(...), q.now().
// The migrations are the authority; a difference here is a bug in this file.
import { DataError } from './errors.js';
import { toCents, fromCents } from './money.js';
import { sha256 } from './sha256.js';

const uuid = { type: 'uuid' };
const id = { type: 'uuid', notNull: true, default: 'uuid' };
const businessId = { type: 'uuid', notNull: true };
const ts = { type: 'timestamptz', notNull: true, default: 'now' };
const text = { type: 'text' };
const date = { type: 'date' };
const bool = (d) => ({ type: 'bool', notNull: true, default: d });
const money = (extra = {}) => ({ type: 'money', notNull: true, ...extra });

export const FIN_ENUMS = {
  accountType: ['bank', 'cash', 'credit', 'escrow'],
  categoryKind: ['income', 'expense'],
  txType: ['income', 'expense', 'transfer'],
  contributionType: ['operational', 'capital_contribution', 'founder_loan', 'reimbursable_expense', 'reimbursement', 'loan_repayment',
    'third_party_equity', 'third_party_grant', 'third_party_loan'],
  lifecycle: ['draft', 'open', 'closed', 'cancelled'],
  frequency: ['weekly', 'monthly', 'quarterly', 'annually'],
  resolution: ['pending', 'import', 'skip', 'replace'],
  rowStatus: ['staged', 'imported', 'skipped', 'replaced'],
};

const check = msg => { throw new DataError('23514', msg); };
const fkFail = msg => { throw new DataError('23503', msg); };
const FUNDING_RECEIPTS = ['capital_contribution', 'founder_loan', 'third_party_equity', 'third_party_grant', 'third_party_loan'];
const same = (a, b, cols) => cols.every(c => (a[c] ?? null) === (b[c] ?? null));
const reversalShape = r => r.is_reversed === (r.reversed_at != null) && (r.reversed_at == null) === (r.reversal_reason == null);

// guard_transaction_insert()
function guardTransactionInsert(n, q) {
  if (n.is_reversed) check('a transaction cannot be created already reversed');
  for (const [col, what] of [['account_id', 'transaction'], ['transfer_to_account_id', 'transfer']]) {
    if (n[col] == null) continue;
    const a = q.one('financial_accounts', r => r.id === n[col]);
    if (!a) fkFail(`account ${n[col]} not found`);
    if (!a.is_active) check(`account ${n[col]} is inactive`);
    if (n.transaction_date < a.opening_balance_date) check(`${what} dated ${n.transaction_date} precedes the ${col === 'account_id' ? 'account' : 'destination'} opening balance date ${a.opening_balance_date}`);
  }
  if (n.settles_transaction_id != null) {
    const t = q.one('transactions', r => r.id === n.settles_transaction_id);
    if (!t) fkFail(`settled transaction ${n.settles_transaction_id} not found`);
    if (t.is_reversed) check('cannot settle a reversed transaction');
    if (!((n.contribution_type === 'reimbursement' && t.contribution_type === 'reimbursable_expense')
       || (n.contribution_type === 'loan_repayment' && t.contribution_type === 'founder_loan'))) check(`${n.contribution_type} cannot settle a ${t.contribution_type} transaction`);
    if ((t.participant_id ?? null) !== (n.participant_id ?? null)) check('settlement participant must match the original transaction participant');
    const settled = q.all('transactions', r => r.settles_transaction_id === t.id && !r.is_reversed).reduce((s, r) => s + toCents(r.amount), 0);
    if (settled + toCents(n.amount) > toCents(t.amount)) check(`settlement of ${n.amount} would exceed the outstanding amount on transaction ${t.id}`);
  }
}

const TX_FROZEN = ['id', 'business_id', 'account_id', 'transfer_to_account_id', 'participant_id', 'settles_transaction_id', 'import_batch_id',
  'replaces_transaction_id', 'transaction_date', 'amount', 'type', 'contribution_type', 'is_personal_founder_payment', 'created_at'];
const PA_FROZEN = ['id', 'business_id', 'commitment_id', 'transaction_id', 'amount', 'created_at'];
const reversalFinal = (o, n, what) => {
  if (o.is_reversed && (!n.is_reversed || n.reversed_at !== o.reversed_at || n.reversal_reason !== o.reversal_reason)) check(`reversal of ${what} ${o.id} is final`);
};

// guard_allocation_insert()
function guardAllocationInsert(n, q) {
  if (n.is_reversed) check('an allocation cannot be created already reversed');
  const t = q.one('transactions', r => r.id === n.transaction_id);
  if (!t) fkFail(`transaction ${n.transaction_id} not found`);
  if (t.is_reversed) check('cannot allocate a reversed transaction');
  if (!((t.type === 'income' && FUNDING_RECEIPTS.includes(t.contribution_type))
     || (t.is_personal_founder_payment && ['capital_contribution', 'founder_loan'].includes(t.contribution_type)))) {
    check(`only funding receipts (capital, loans, third-party funding) can satisfy a commitment; got ${t.type} ${t.contribution_type}`);
  }
  const c = q.one('funding_commitments', r => r.id === n.commitment_id);
  if (!c) fkFail(`commitment ${n.commitment_id} not found`);
  if (c.revoked_at != null) check(`commitment ${n.commitment_id} is revoked`);
  if (c.participant_id != null && (t.participant_id ?? null) !== c.participant_id) check('this commitment belongs to another participant; the payment must come from that participant');
  const used = q.all('payment_allocations', r => r.transaction_id === n.transaction_id && !r.is_reversed).reduce((s, r) => s + toCents(r.amount), 0);
  if (used + toCents(n.amount) > toCents(t.amount)) check(`allocations would exceed the transaction amount (${t.amount})`);
}

// prepare_import_row(): server-side normalisation, validation and fingerprinting of one staged CSV row
function prepareImportRow(n, q, o) {
  const batch = q.one('import_batches', r => r.id === n.batch_id);
  if (!batch) fkFail(`import batch ${n.batch_id} not found`);
  if (batch.status !== 'staged') check(`import batch ${n.batch_id} is already committed`);
  if (o) {
    if (JSON.stringify(n.payload) !== JSON.stringify(o.payload) || n.row_index !== o.row_index || n.batch_id !== o.batch_id) check('staged row content cannot change; delete and restage it');
    return;
  }
  const p = n.payload ?? {};
  Object.assign(n, { validation_error: null, parsed_date: null, parsed_amount: null, parsed_type: null, parsed_description: null, fingerprint: null, duplicate_of_transaction_id: null });
  try {
    const d = p.date == null ? '' : String(p.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) throw new Error('date must be YYYY-MM-DD');
    const amt = String(p.amount ?? '').trim();
    if (!/^\d{1,13}(\.\d{1,2})?$/.test(amt)) throw new Error('amount must be a positive number with at most 2 decimals');
    const cents = toCents(amt);
    if (cents <= 0) throw new Error('amount must be greater than zero');
    const type = String(p.type ?? '').trim().toLowerCase();
    if (!['income', 'expense'].includes(type)) throw new Error('type must be income or expense');
    const desc = String(p.description ?? '').replace(/\s+/g, ' ').trim();
    if (desc.length < 1 || desc.length > 500) throw new Error('description is required (max 500 characters)');
    Object.assign(n, { parsed_date: d, parsed_amount: fromCents(cents), parsed_type: type, parsed_description: desc });
  } catch (e) {
    n.validation_error = e.message;
    return;
  }
  n.fingerprint = sha256([batch.account_id, n.parsed_date, n.parsed_amount, n.parsed_type, n.parsed_description.toLowerCase()].join('|'));
  const norm = s => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const dup = q.all('transactions', t => t.account_id === batch.account_id && !t.is_reversed && t.transaction_date === n.parsed_date
    && toCents(t.amount) === toCents(n.parsed_amount) && t.type === n.parsed_type && norm(t.description) === n.parsed_description.toLowerCase())
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
  n.duplicate_of_transaction_id = dup?.id ?? null;
}

export const FINANCE_TABLES = {
  // ---- migration 3: capital structure and funding commitments ----
  capital_structures: {
    columns: {
      id, business_id: businessId, title: { ...text, notNull: true, default: 'Primary capital structure', len: [1, 200] },
      agreed_capital_target: money({ gte0: true }), contribution_basis: text, effective_date: { ...date, notNull: true, default: 'today' },
      is_current: bool(true), notes: text, created_at: ts, updated_at: ts,
    },
    insert: true, update: ['title', 'agreed_capital_target', 'contribution_basis', 'effective_date', 'is_current', 'notes'], delete: true,
  },
  capital_targets: {
    columns: {
      id, business_id: businessId, structure_id: { ...uuid, notNull: true }, name: { ...text, notNull: true, len: [1, 200] },
      target_amount: money({ gt0: true }), target_date: date, created_at: ts, updated_at: ts,
    },
    insert: true, update: ['name', 'target_amount', 'target_date'], delete: true,
    fks: [{ col: 'structure_id', ref: 'capital_structures', onDelete: 'cascade' }],
  },
  participant_capital_allocations: {
    columns: {
      id, business_id: businessId, structure_id: { ...uuid, notNull: true }, capital_target_id: uuid, participant_id: { ...uuid, notNull: true },
      allocated_amount: money({ gt0: true }), basis_notes: text, is_active: bool(true), created_at: ts, updated_at: ts,
    },
    insert: true, update: ['capital_target_id', 'allocated_amount', 'basis_notes', 'is_active'], delete: true,
    fks: [{ col: 'structure_id', ref: 'capital_structures', onDelete: 'restrict' },
          // fk_pca_target: (business_id, structure_id, capital_target_id) -> capital_targets(business_id, structure_id, id)
          { col: 'capital_target_id', ref: 'capital_targets', match: { structure_id: 'structure_id' }, onDelete: 'restrict' },
          { col: 'participant_id', ref: 'participants', onDelete: 'restrict' }],
  },
  funding_requirements: {
    columns: {
      id, business_id: businessId, project_id: uuid, milestone_id: uuid, title: { ...text, notNull: true, len: [1, 200] },
      required_amount: money({ gt0: true }), needed_by: date, lifecycle: { ...text, notNull: true, default: 'open', enum: FIN_ENUMS.lifecycle },
      notes: text, created_at: ts, updated_at: ts,
    },
    insert: true, update: ['project_id', 'milestone_id', 'title', 'required_amount', 'needed_by', 'lifecycle', 'notes'], delete: true,
    fks: [{ col: 'project_id', ref: 'projects', onDelete: 'set null' }, { col: 'milestone_id', ref: 'milestones', onDelete: 'set null' }],
    activity: ['insert', 'update'],
  },
  funding_commitments: {
    // status is NOT stored: vw_funding_commitment_status derives it. Revocation only through revoke_funding_commitment().
    columns: {
      id, business_id: businessId, requirement_id: { ...uuid, notNull: true }, participant_id: uuid, funder_name: { ...text, notNull: true, len: [1, 200] },
      committed_amount: money({ gt0: true }), expected_payment_date: date, notes: text, revoked_at: { type: 'timestamptz' }, revocation_reason: text,
      created_at: ts, updated_at: ts,
    },
    insert: ['business_id', 'requirement_id', 'participant_id', 'funder_name', 'committed_amount', 'expected_payment_date', 'notes'],
    update: ['funder_name', 'committed_amount', 'expected_payment_date', 'notes'], delete: false,
    fks: [{ col: 'requirement_id', ref: 'funding_requirements', onDelete: 'restrict' }, { col: 'participant_id', ref: 'participants', onDelete: 'restrict' }],
    checks: [r => (r.revoked_at == null) === (r.revocation_reason == null) || 'chk_fc_revocation'],
    activity: ['insert', 'update'],
    guards: {
      // guard_funding_commitment()
      beforeUpdate(o, n) {
        if (o.revoked_at != null) check(`commitment ${o.id} is revoked and can no longer change`);
        if (!same(o, n, ['requirement_id', 'participant_id', 'business_id'])) check('a commitment cannot move to another requirement, participant or business');
      },
    },
  },

  // ---- migration 4: ledger ----
  financial_accounts: {
    columns: {
      id, business_id: businessId, name: { ...text, notNull: true, len: [1, 200] }, account_type: { ...text, notNull: true, enum: FIN_ENUMS.accountType },
      institution: text, opening_balance: money({ default: '0.00' }), opening_balance_date: { ...date, notNull: true }, is_active: bool(true), notes: text,
      created_at: ts, updated_at: ts,
    },
    insert: ['business_id', 'name', 'account_type', 'institution', 'opening_balance', 'opening_balance_date', 'is_active', 'notes'],
    update: ['name', 'institution', 'is_active', 'notes'], delete: false,
  },
  financial_categories: {
    columns: {
      id, business_id: businessId, name: { ...text, notNull: true, len: [1, 120] }, kind: { ...text, notNull: true, enum: FIN_ENUMS.categoryKind },
      is_active: bool(true), created_at: ts,
    },
    insert: true, update: ['name', 'is_active'], delete: true,
    uniques: [{ cols: ['business_id', 'kind', 'name'], name: 'uq_financial_categories_name' }],
  },
  transactions: {
    // append-only: financial columns never change after insert; corrections are reverse_transaction() plus a new row
    columns: {
      id, business_id: businessId, account_id: uuid, transfer_to_account_id: uuid, category_id: uuid, participant_id: uuid,
      settles_transaction_id: uuid, import_batch_id: uuid, replaces_transaction_id: uuid, transaction_date: { ...date, notNull: true },
      amount: money({ gt0: true }), type: { ...text, notNull: true, enum: FIN_ENUMS.txType },
      contribution_type: { ...text, notNull: true, default: 'operational', enum: FIN_ENUMS.contributionType },
      is_personal_founder_payment: bool(false), description: { ...text, notNull: true, len: [1, 500] }, reference: text, notes: text,
      is_reversed: bool(false), reversed_at: { type: 'timestamptz' }, reversal_reason: text, created_at: ts, updated_at: ts,
    },
    insert: ['business_id', 'account_id', 'transfer_to_account_id', 'category_id', 'participant_id', 'settles_transaction_id', 'transaction_date', 'amount',
      'type', 'contribution_type', 'is_personal_founder_payment', 'description', 'reference', 'notes'],
    update: ['category_id', 'description', 'reference', 'notes'], delete: false,
    fks: [{ col: 'account_id', ref: 'financial_accounts' }, { col: 'transfer_to_account_id', ref: 'financial_accounts' },
          { col: 'category_id', ref: 'financial_categories' }, { col: 'participant_id', ref: 'participants' },
          { col: 'settles_transaction_id', ref: 'transactions' }, { col: 'replaces_transaction_id', ref: 'transactions' },
          { col: 'import_batch_id', ref: 'import_batches' }].map(f => ({ ...f, onDelete: 'restrict' })),
    checks: [
      r => (r.type === 'transfer' && r.account_id != null && r.transfer_to_account_id != null && r.account_id !== r.transfer_to_account_id
              && !r.is_personal_founder_payment && r.contribution_type === 'operational')
        || (['income', 'expense'].includes(r.type) && r.transfer_to_account_id == null
              && ((!r.is_personal_founder_payment && r.account_id != null) || (r.is_personal_founder_payment && r.account_id == null && r.type === 'expense')))
        || 'chk_tx_shape',
      r => (r.contribution_type === 'operational' && !r.is_personal_founder_payment && r.settles_transaction_id == null)
        || (['capital_contribution', 'founder_loan'].includes(r.contribution_type) && r.participant_id != null
              && (r.type === 'income' || r.is_personal_founder_payment) && r.settles_transaction_id == null)
        || (r.contribution_type === 'reimbursable_expense' && r.is_personal_founder_payment && r.participant_id != null && r.settles_transaction_id == null)
        || (['reimbursement', 'loan_repayment'].includes(r.contribution_type) && r.type === 'expense' && !r.is_personal_founder_payment
              && r.participant_id != null && r.settles_transaction_id != null)
        || (['third_party_equity', 'third_party_grant', 'third_party_loan'].includes(r.contribution_type) && r.type === 'income' && r.settles_transaction_id == null)
        || 'chk_tx_contribution',
      r => reversalShape(r) || 'chk_tx_reversal',
    ],
    activity: ['insert'],
    guards: {
      beforeInsert: guardTransactionInsert,
      // guard_transaction_update()
      beforeUpdate(o, n) {
        if (!same(o, n, TX_FROZEN)) check(`financial fields of transaction ${o.id} are immutable; reverse it and record a new transaction`);
        reversalFinal(o, n, 'transaction');
      },
      // cascade_transaction_reversal(): reversing a transaction reverses every active allocation of it
      afterUpdate(o, n, q) {
        if (o.is_reversed || !n.is_reversed) return;
        const hits = q.all('payment_allocations', a => a.transaction_id === n.id && !a.is_reversed);
        for (const a of hits) q.sysUpdate('payment_allocations', a, { is_reversed: true, reversed_at: n.reversed_at, reversal_reason: `Parent transaction reversed: ${n.reversal_reason}` });
        q.log('transactions.reversed', 'transactions', n.id, `Transaction reversed: ${n.description}`, { amount: n.amount, reason: n.reversal_reason, allocations_reversed: hits.length });
      },
    },
  },
  payment_allocations: {
    columns: {
      id, business_id: businessId, commitment_id: { ...uuid, notNull: true }, transaction_id: { ...uuid, notNull: true }, amount: money({ gt0: true }),
      notes: text, is_reversed: bool(false), reversed_at: { type: 'timestamptz' }, reversal_reason: text, created_at: ts, updated_at: ts,
    },
    insert: ['business_id', 'commitment_id', 'transaction_id', 'amount', 'notes'], update: ['notes'], delete: false,
    fks: [{ col: 'commitment_id', ref: 'funding_commitments', onDelete: 'restrict' }, { col: 'transaction_id', ref: 'transactions', onDelete: 'restrict' }],
    checks: [r => reversalShape(r) || 'chk_pa_reversal'],
    activity: ['insert'],
    guards: {
      beforeInsert: guardAllocationInsert,
      // guard_allocation_update()
      beforeUpdate(o, n) {
        if (!same(o, n, PA_FROZEN)) check(`allocation ${o.id} is immutable; reverse it and allocate again`);
        reversalFinal(o, n, 'allocation');
      },
    },
  },
  recurring_transactions: {
    // scheduling only; posting an occurrence is an explicit user action (Gate 2)
    columns: {
      id, business_id: businessId, account_id: { ...uuid, notNull: true }, category_id: uuid, type: { ...text, notNull: true, enum: FIN_ENUMS.categoryKind },
      amount: money({ gt0: true }), description: { ...text, notNull: true, len: [1, 500] }, frequency: { ...text, notNull: true, enum: FIN_ENUMS.frequency },
      start_date: { ...date, notNull: true }, end_date: date, next_due_date: { ...date, notNull: true }, is_active: bool(true), created_at: ts, updated_at: ts,
    },
    insert: true, update: ['account_id', 'category_id', 'type', 'amount', 'description', 'frequency', 'start_date', 'end_date', 'next_due_date', 'is_active'], delete: true,
    fks: [{ col: 'account_id', ref: 'financial_accounts', onDelete: 'restrict' }, { col: 'category_id', ref: 'financial_categories', onDelete: 'set null' }],
    checks: [r => r.end_date == null || r.end_date >= r.start_date || 'chk_rt_dates'],
  },

  // ---- migration 5: CSV import ----
  import_batches: {
    columns: {
      id, business_id: businessId, account_id: { ...uuid, notNull: true }, filename: { ...text, notNull: true, len: [1, 255] },
      file_checksum_sha256: { ...text, notNull: true, pattern: /^[0-9a-f]{64}$/ }, status: { ...text, notNull: true, default: 'staged', enum: ['staged', 'committed'] },
      imported_rows: { type: 'int', notNull: true, default: 0 }, skipped_rows: { type: 'int', notNull: true, default: 0 }, replaced_rows: { type: 'int', notNull: true, default: 0 },
      committed_at: { type: 'timestamptz' }, created_at: ts, updated_at: ts,
    },
    insert: ['business_id', 'account_id', 'filename', 'file_checksum_sha256'], update: false, delete: true,
    fks: [{ col: 'account_id', ref: 'financial_accounts', onDelete: 'restrict' }],
    checks: [r => (r.status === 'committed') === (r.committed_at != null) || 'chk_ib_committed'],
    uniques: [{ cols: ['business_id', 'account_id', 'file_checksum_sha256'], where: r => r.status === 'committed', name: 'uq_import_file_committed' }],
    guards: {
      // guard_import_batch(): a committed batch is permanent provenance
      beforeUpdate(o) { if (o.status === 'committed') throw new DataError('42501', `committed import batch ${o.id} is permanent provenance`); },
      beforeDelete(o) { if (o.status === 'committed') throw new DataError('42501', `committed import batch ${o.id} is permanent provenance`); },
    },
  },
  import_batch_rows: {
    columns: {
      id, business_id: businessId, batch_id: { ...uuid, notNull: true }, row_index: { type: 'int', notNull: true, between: [0, 2147483647] },
      payload: { type: 'jsonb', notNull: true },
      parsed_date: date, parsed_amount: { type: 'money' }, parsed_type: text, parsed_description: text, fingerprint: text, validation_error: text,
      duplicate_of_transaction_id: uuid, duplicate_in_batch: bool(false),
      resolution: { ...text, notNull: true, default: 'pending', enum: FIN_ENUMS.resolution }, replace_transaction_id: uuid,
      row_status: { ...text, notNull: true, default: 'staged', enum: FIN_ENUMS.rowStatus }, transaction_id: uuid, created_at: ts,
    },
    insert: ['business_id', 'batch_id', 'row_index', 'payload'], update: ['resolution', 'replace_transaction_id'], delete: true,
    fks: [{ col: 'batch_id', ref: 'import_batches', onDelete: 'cascade' }, { col: 'duplicate_of_transaction_id', ref: 'transactions', onDelete: 'restrict' },
          { col: 'replace_transaction_id', ref: 'transactions', onDelete: 'restrict' }, { col: 'transaction_id', ref: 'transactions', onDelete: 'restrict' }],
    checks: [r => (r.resolution === 'replace') === (r.replace_transaction_id != null) || 'chk_ibr_replace'],
    uniques: [{ cols: ['batch_id', 'row_index'], name: 'uq_import_rows_index' }],
    guards: {
      beforeInsert: (n, q) => prepareImportRow(n, q, null),
      beforeUpdate: (o, n, q) => prepareImportRow(n, q, o),
      // guard_import_row_delete()
      beforeDelete(o, q) {
        if (q.one('import_batches', b => b.id === o.batch_id && b.status === 'committed')) throw new DataError('42501', 'rows of a committed import batch are permanent provenance');
      },
    },
  },
};
