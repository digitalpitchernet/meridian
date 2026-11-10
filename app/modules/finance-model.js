// Pure finance helpers for the screens. Nothing here computes a stored or derived financial figure that the backend
// owns (balances, cash, commitment status, outstanding amounts): those come only from views and RPCs.
// What is here: the transaction kinds the CHECK constraints allow (chk_tx_shape + chk_tx_contribution), labels,
// display signs, a pre-filter for allocation pickers (the server guard still decides), and CSV reading.
import { toCents } from '../data/money.js';

// Every kind is exactly one allowed (type, contribution_type, is_personal_founder_payment) shape. Fields the form shows:
// account (account_id), to (transfer_to_account_id), participant, settles (settles_transaction_id), category, funding (third-party type)
export const TX_KINDS = [
  { id: 'income', group: 'Everyday', label: 'Income', type: 'income', contribution_type: 'operational', fields: ['account', 'category'] },
  { id: 'expense', group: 'Everyday', label: 'Expense', type: 'expense', contribution_type: 'operational', fields: ['account', 'category'] },
  { id: 'transfer', group: 'Everyday', label: 'Transfer between accounts', type: 'transfer', contribution_type: 'operational', fields: ['account', 'to'] },
  { id: 'capital', group: 'Founders and participants', label: 'Capital contribution received', type: 'income', contribution_type: 'capital_contribution', fields: ['account', 'participant'] },
  { id: 'loan', group: 'Founders and participants', label: 'Founder loan received', type: 'income', contribution_type: 'founder_loan', fields: ['account', 'participant'] },
  { id: 'reimbursable', group: 'Paid personally', label: 'Business expense paid personally, to be reimbursed', type: 'expense', contribution_type: 'reimbursable_expense', personal: true, fields: ['participant', 'category'] },
  { id: 'capital_personal', group: 'Paid personally', label: 'Business expense paid personally, as capital', type: 'expense', contribution_type: 'capital_contribution', personal: true, fields: ['participant', 'category'] },
  { id: 'loan_personal', group: 'Paid personally', label: 'Business expense paid personally, as a loan', type: 'expense', contribution_type: 'founder_loan', personal: true, fields: ['participant', 'category'] },
  { id: 'reimbursement', group: 'Settling what is owed', label: 'Reimbursement to a participant', type: 'expense', contribution_type: 'reimbursement', settles: 'reimbursable_expense', fields: ['account', 'participant', 'settles'] },
  { id: 'loan_repayment', group: 'Settling what is owed', label: 'Loan repayment to a participant', type: 'expense', contribution_type: 'loan_repayment', settles: 'founder_loan', fields: ['account', 'participant', 'settles'] },
  { id: 'third_party', group: 'Outside funding', label: 'Outside funding received', type: 'income', contribution_type: null, fields: ['account', 'funding'] },
];
export const THIRD_PARTY = [['third_party_equity', 'Equity investment'], ['third_party_grant', 'Grant'], ['third_party_loan', 'Loan from a third party']];

export function kindOf(t) {
  if (t.contribution_type?.startsWith('third_party')) return TX_KINDS.find(k => k.id === 'third_party');
  return TX_KINDS.find(k => k.type === t.type && (k.contribution_type === t.contribution_type) && !!k.personal === !!t.is_personal_founder_payment) ?? null;
}

// the row a kind's form produces; columns the kind does not use are left out (the database defaults them)
export function transactionRow(kind, v) {
  const row = { type: kind.type, contribution_type: kind.contribution_type ?? v.funding, transaction_date: v.transaction_date, amount: v.amount, description: v.description };
  if (kind.personal) row.is_personal_founder_payment = true;
  const pick = { account: 'account_id', to: 'transfer_to_account_id', participant: 'participant_id', settles: 'settles_transaction_id', category: 'category_id' };
  for (const f of kind.fields) if (pick[f]) row[pick[f]] = v[pick[f]] || null;
  for (const k of ['reference', 'notes']) if (v[k]) row[k] = v[k];
  return row;
}

export const CONTRIBUTION_LABEL = {
  operational: 'Operational', capital_contribution: 'Capital', founder_loan: 'Founder loan', reimbursable_expense: 'Reimbursable',
  reimbursement: 'Reimbursement', loan_repayment: 'Loan repayment', third_party_equity: 'Equity', third_party_grant: 'Grant', third_party_loan: 'Third-party loan',
};
export const ACCOUNT_TYPE_LABEL = { bank: 'Bank', cash: 'Cash', credit: 'Credit', escrow: 'Escrow' };
export const COMMITMENT_TONE = { pledged: 'info', partially_paid: 'warn', fulfilled: 'ok', over_allocated: 'bad', revoked: 'idle' };
export const COMMITMENT_LABEL = { pledged: 'Pledged', partially_paid: 'Partially paid', fulfilled: 'Fulfilled', over_allocated: 'Over-allocated', revoked: 'Revoked' };
export const ALLOCATION_LABEL = { under_allocated: 'Under-allocated', fully_allocated: 'Fully allocated', over_allocated: 'Over-allocated' };

// How a transaction moves money in the context of one account (or the business, when accountId is null), in cents:
// +inflow, -outflow, 0 for a transfer seen business-wide, null when no business account moved (paid personally).
export function signedCents(t, accountId = null) {
  const a = toCents(t.amount);
  if (t.type === 'transfer') return accountId == null ? 0 : t.transfer_to_account_id === accountId ? a : t.account_id === accountId ? -a : 0;
  if (t.account_id == null) return null;
  return t.type === 'income' ? a : -a;
}

// UX pre-filter for "record a payment against this commitment": mirrors guard_allocation_insert(); the server decides.
export function eligibleReceipts(commitment, transactions, allocations) {
  const used = new Map();
  for (const a of allocations) if (!a.is_reversed) used.set(a.transaction_id, (used.get(a.transaction_id) ?? 0) + toCents(a.amount));
  return transactions.filter(t => !t.is_reversed
    && ((t.type === 'income' && ['capital_contribution', 'founder_loan', 'third_party_equity', 'third_party_grant', 'third_party_loan'].includes(t.contribution_type))
      || (t.is_personal_founder_payment && ['capital_contribution', 'founder_loan'].includes(t.contribution_type)))
    && (commitment.participant_id == null || t.participant_id === commitment.participant_id))
    .map(t => ({ t, remaining: toCents(t.amount) - (used.get(t.id) ?? 0) }))
    .filter(x => x.remaining > 0);
}

// ---- CSV ----
// RFC 4180: quoted fields, "" escapes, CRLF or LF, a trailing newline; blank lines are dropped.
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

// first header that looks like each payload key, or -1
export function guessMapping(headers) {
  const find = re => headers.findIndex(x => re.test(x.trim().toLowerCase()));
  return { date: find(/date/), amount: find(/amount|value/), type: find(/^type$|kind|direction|dr\/?cr/), description: find(/desc|narration|particular|details|memo/) };
}

// the payload prepare_import_row() accepts: the cells exactly as read, no client-side reinterpretation
export function payloads(rows, map) {
  return rows.map(r => ({ date: r[map.date] ?? '', amount: r[map.amount] ?? '', type: r[map.type] ?? '', description: r[map.description] ?? '' }));
}

// fingerprints are server-computed (import_batch_rows.fingerprint); an earlier row with the same one is an in-file duplicate
export function inFileDuplicateOf(rows) {
  const first = new Map(), out = new Map();
  for (const r of [...rows].sort((a, b) => a.row_index - b.row_index)) {
    if (!r.fingerprint) continue;
    if (first.has(r.fingerprint)) out.set(r.id, first.get(r.fingerprint)); else first.set(r.fingerprint, r.row_index);
  }
  return out;
}
