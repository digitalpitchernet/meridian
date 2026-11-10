// Development-adapter emulation of the finance VIEWS and RPCs (migrations 3-5, plus migration 9's 2-decimal cash).
// Each function is ported from its SQL definition; the SQL is the authority. q is the caller's business-scoped
// server context (see fixture.js): q.all / q.one read, q.sysInsert / q.sysUpdate write as SECURITY DEFINER
// (no column grants, triggers still fire), q.log = log_activity(), q.now() = now(), q.today() = business_local_date().
import { DataError } from '../errors.js';
import { toCents, fromCents } from '../money.js';

const sum = (list, f) => list.reduce((s, x) => s + toCents(f(x)), 0);
const m = fromCents;
const reasonRequired = (p, what) => { if (p == null || !String(p).trim()) throw new DataError('23514', `a ${what} reason is required`); return String(p).trim(); };

// ---------------- views (security_invoker: the caller's own business only) ----------------
function commitmentStatus(q) {
  return q.all('funding_commitments').map(c => {
    const received = sum(q.all('payment_allocations', a => a.commitment_id === c.id && !a.is_reversed), a => a.amount);
    const committed = toCents(c.committed_amount);
    const status = c.revoked_at != null ? 'revoked' : received === 0 ? 'pledged' : received < committed ? 'partially_paid' : received === committed ? 'fulfilled' : 'over_allocated';
    return {
      commitment_id: c.id, business_id: c.business_id, requirement_id: c.requirement_id, participant_id: c.participant_id, funder_name: c.funder_name,
      committed_amount: c.committed_amount, expected_payment_date: c.expected_payment_date, revoked_at: c.revoked_at, revocation_reason: c.revocation_reason,
      received_amount: m(received), outstanding_amount: m(c.revoked_at != null ? 0 : Math.max(committed - received, 0)), status,
    };
  });
}

function settlementStatus(q) {
  return q.all('transactions', t => ['reimbursable_expense', 'founder_loan'].includes(t.contribution_type) && !t.is_reversed).map(t => {
    const settled = sum(q.all('transactions', s => s.settles_transaction_id === t.id && !s.is_reversed), s => s.amount);
    return {
      transaction_id: t.id, business_id: t.business_id, participant_id: t.participant_id, contribution_type: t.contribution_type,
      transaction_date: t.transaction_date, description: t.description, amount: t.amount, settled_amount: m(settled), outstanding_amount: m(toCents(t.amount) - settled),
    };
  });
}

function capitalTargetSummary(q) {
  return q.all('capital_targets').map(ct => {
    const alloc = sum(q.all('participant_capital_allocations', a => a.capital_target_id === ct.id && a.is_active), a => a.allocated_amount);
    const target = toCents(ct.target_amount);
    return {
      business_id: ct.business_id, structure_id: ct.structure_id, capital_target_id: ct.id, name: ct.name, target_amount: ct.target_amount,
      allocated_amount: m(alloc), unallocated_amount: m(Math.max(target - alloc, 0)), over_allocated_amount: m(Math.max(alloc - target, 0)),
      allocation_status: alloc < target ? 'under_allocated' : alloc === target ? 'fully_allocated' : 'over_allocated',
    };
  });
}

export const VIEWS = {
  vw_funding_commitment_status: commitmentStatus,

  vw_funding_requirement_summary(q) {
    const st = commitmentStatus(q);
    return q.all('funding_requirements').map(r => {
      const mine = st.filter(s => s.requirement_id === r.id);
      const committed = sum(mine.filter(s => s.status !== 'revoked'), s => s.committed_amount);
      return {
        requirement_id: r.id, business_id: r.business_id, title: r.title, lifecycle: r.lifecycle, needed_by: r.needed_by, required_amount: r.required_amount,
        committed_amount: m(committed), received_amount: m(sum(mine, s => s.received_amount)), outstanding_commitments: m(sum(mine, s => s.outstanding_amount)),
        uncommitted_gap: m(Math.max(toCents(r.required_amount) - committed, 0)),
      };
    });
  },

  vw_settlement_status: settlementStatus,

  // contributor-level reporting: separate figures, never netted into ownership
  vw_participant_contribution_summary(q) {
    const st = settlementStatus(q), cs = commitmentStatus(q);
    const current = new Set(q.all('capital_structures', s => s.is_current).map(s => s.id));
    return q.all('participants').map(p => {
      const tx = type => sum(q.all('transactions', t => t.participant_id === p.id && t.contribution_type === type && !t.is_reversed), t => t.amount);
      const owed = type => sum(st.filter(s => s.participant_id === p.id && s.contribution_type === type), s => s.outstanding_amount);
      return {
        participant_id: p.id, business_id: p.business_id, full_name: p.full_name, participant_type: p.participant_type, agreed_equity_percentage: p.agreed_equity_percentage,
        capital_contributed: m(tx('capital_contribution')), loans_advanced: m(tx('founder_loan')), loans_outstanding: m(owed('founder_loan')),
        reimbursements_owed: m(owed('reimbursable_expense')),
        capital_allocated: m(sum(q.all('participant_capital_allocations', a => a.participant_id === p.id && a.is_active && current.has(a.structure_id)), a => a.allocated_amount)),
        commitments_outstanding: m(sum(cs.filter(s => s.participant_id === p.id), s => s.outstanding_amount)),
      };
    });
  },

  vw_capital_target_summary: capitalTargetSummary,

  vw_capital_structure_summary(q) {
    const ts = capitalTargetSummary(q);
    return q.all('capital_structures').map(cs => {
      const alloc = sum(q.all('participant_capital_allocations', a => a.structure_id === cs.id && a.is_active), a => a.allocated_amount);
      const agreed = toCents(cs.agreed_capital_target);
      const mine = ts.filter(t => t.structure_id === cs.id);
      const totalTargets = sum(mine, t => t.target_amount);
      return {
        business_id: cs.business_id, structure_id: cs.id, title: cs.title, agreed_capital_target: cs.agreed_capital_target, is_current: cs.is_current,
        allocated_amount: m(alloc), unallocated_amount: m(Math.max(agreed - alloc, 0)), over_allocated_amount: m(Math.max(alloc - agreed, 0)),
        allocation_status: alloc < agreed ? 'under_allocated' : alloc === agreed ? 'fully_allocated' : 'over_allocated',
        total_target_amount: m(totalTargets), targets_exceed_structure_by: m(Math.max(totalTargets - agreed, 0)),
        over_allocated_target_count: mine.filter(t => t.allocation_status === 'over_allocated').length,
      };
    });
  },
};

// ---------------- compute_account_balances(p_business_id, p_as_of) ----------------
function accountBalances(q, asOf) {
  if (asOf != null && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new DataError('22007', `invalid input syntax for type date: "${asOf}"`);
  return q.all('financial_accounts', a => a.opening_balance_date <= asOf).map(a => {
    const live = t => !t.is_reversed && t.transaction_date >= a.opening_balance_date && t.transaction_date <= asOf;
    const inflow = sum(q.all('transactions', t => live(t) && ((t.type === 'income' && t.account_id === a.id) || (t.type === 'transfer' && t.transfer_to_account_id === a.id))), t => t.amount);
    const outflow = sum(q.all('transactions', t => live(t) && t.account_id === a.id && (t.type === 'expense' || t.type === 'transfer')), t => t.amount);
    return {
      account_id: a.id, name: a.name, account_type: a.account_type, is_active: a.is_active,
      balance: m(toCents(a.opening_balance) + inflow - outflow), counts_as_available_cash: a.is_active && ['bank', 'cash'].includes(a.account_type),
    };
  });
}

// ---------------- RPCs (SECURITY DEFINER, executable by authenticated) ----------------
export const RPCS = {
  get_available_cash(q, { p_as_of = null } = {}) {
    return m(sum(accountBalances(q, p_as_of ?? q.today()).filter(b => b.counts_as_available_cash), b => b.balance));
  },

  get_account_balances(q, { p_as_of = null } = {}) {
    return accountBalances(q, p_as_of ?? q.today());
  },

  reverse_transaction(q, { p_transaction_id, p_reason }) {
    const reason = reasonRequired(p_reason, 'reversal');
    const t = q.one('transactions', r => r.id === p_transaction_id);
    if (!t) throw new DataError('P0002', `transaction ${p_transaction_id} not found`);
    if (t.is_reversed) throw new DataError('23514', `transaction ${p_transaction_id} is already reversed`);
    if (q.one('transactions', r => r.settles_transaction_id === p_transaction_id && !r.is_reversed)) {
      throw new DataError('23514', `reverse the reimbursements/repayments of transaction ${p_transaction_id} first`);
    }
    q.sysUpdate('transactions', t, { is_reversed: true, reversed_at: q.now(), reversal_reason: reason });
    return { transaction_id: p_transaction_id, status: 'reversed' };
  },

  reverse_payment_allocation(q, { p_allocation_id, p_reason }) {
    const reason = reasonRequired(p_reason, 'reversal');
    const a = q.one('payment_allocations', r => r.id === p_allocation_id);
    if (!a) throw new DataError('P0002', `allocation ${p_allocation_id} not found`);
    if (a.is_reversed) throw new DataError('23514', `allocation ${p_allocation_id} is already reversed`);
    q.sysUpdate('payment_allocations', a, { is_reversed: true, reversed_at: q.now(), reversal_reason: reason });
    q.log('payment_allocations.reversed', 'payment_allocations', p_allocation_id, 'Payment allocation reversed', { amount: a.amount, commitment_id: a.commitment_id, reason });
    return { allocation_id: p_allocation_id, status: 'reversed' };
  },

  revoke_funding_commitment(q, { p_commitment_id, p_reason }) {
    const reason = reasonRequired(p_reason, 'revocation');
    const c = q.one('funding_commitments', r => r.id === p_commitment_id);
    if (!c) throw new DataError('P0002', `commitment ${p_commitment_id} not found`);
    if (c.revoked_at != null) throw new DataError('23514', `commitment ${p_commitment_id} is already revoked`);
    if (q.one('payment_allocations', a => a.commitment_id === p_commitment_id && !a.is_reversed)) {
      throw new DataError('23514', `commitment ${p_commitment_id} has received payments; reverse those allocations before revoking`);
    }
    q.sysUpdate('funding_commitments', c, { revoked_at: q.now(), revocation_reason: reason });
    q.log('funding_commitments.revoked', 'funding_commitments', p_commitment_id, `Commitment revoked: ${c.funder_name}`, { committed_amount: c.committed_amount, reason });
    return { commitment_id: p_commitment_id, status: 'revoked' };
  },

  // Atomic: the adapter runs every RPC in one transaction, so any raise below leaves nothing written.
  commit_import_batch(q, { p_batch_id }) {
    const batch = q.one('import_batches', b => b.id === p_batch_id);
    if (!batch) throw new DataError('P0002', `import batch ${p_batch_id} not found`);
    if (batch.status !== 'staged') throw new DataError('23514', `import batch ${p_batch_id} is already committed`);
    if (q.one('import_batches', b => b.account_id === batch.account_id && b.file_checksum_sha256 === batch.file_checksum_sha256 && b.status === 'committed')) {
      throw new DataError('23505', `this file (sha256 ${batch.file_checksum_sha256}) was already imported into this account`);
    }
    const rows = () => q.all('import_batch_rows', r => r.batch_id === p_batch_id).sort((a, b) => a.row_index - b.row_index);
    if (!rows().length) throw new DataError('23514', `import batch ${p_batch_id} has no rows`);
    if (rows().some(r => r.validation_error != null && r.resolution !== 'skip')) throw new DataError('23514', `import batch ${p_batch_id} has invalid rows; fix the file or mark them skip`);

    for (const r of rows()) {
      if (r.validation_error == null && rows().some(o => o.fingerprint === r.fingerprint && o.row_index < r.row_index)) q.sysUpdate('import_batch_rows', r, { duplicate_in_batch: true });
    }
    if (rows().some(r => r.resolution === 'pending' && (r.duplicate_of_transaction_id != null || r.duplicate_in_batch))) {
      throw new DataError('23514', `import batch ${p_batch_id} has suspected duplicates without a decision (import, skip or replace)`);
    }
    const targets = rows().filter(r => r.resolution === 'replace').map(r => r.replace_transaction_id);
    if (new Set(targets).size !== targets.length) throw new DataError('23514', 'two rows replace the same transaction');

    let imported = 0, skipped = 0, replaced = 0;
    for (const r of rows()) {
      if (r.resolution === 'skip') { q.sysUpdate('import_batch_rows', r, { row_status: 'skipped' }); skipped++; continue; }
      if (r.resolution === 'replace') {
        const t = q.one('transactions', x => x.id === r.replace_transaction_id);
        if (!t) throw new DataError('P0002', `row ${r.row_index}: transaction to replace not found`);
        if (t.account_id !== batch.account_id) throw new DataError('23514', `row ${r.row_index}: the replaced transaction belongs to another account`);
        if (t.is_reversed) throw new DataError('23514', `row ${r.row_index}: the replaced transaction is already reversed`);
        if (t.type === 'transfer' || t.contribution_type !== 'operational') throw new DataError('23514', `row ${r.row_index}: only ordinary income/expense can be replaced from a CSV; edit ${t.contribution_type} records by reversal`);
        if (q.one('payment_allocations', a => a.transaction_id === t.id && !a.is_reversed)) throw new DataError('23514', `row ${r.row_index}: the replaced transaction has payment allocations; reverse them first`);
      }
      const tx = q.sysInsert('transactions', {
        account_id: batch.account_id, import_batch_id: p_batch_id, replaces_transaction_id: r.replace_transaction_id, transaction_date: r.parsed_date,
        amount: r.parsed_amount, type: r.parsed_type, description: r.parsed_description,
      });
      if (r.resolution === 'replace') {
        q.sysUpdate('transactions', q.one('transactions', x => x.id === r.replace_transaction_id),
          { is_reversed: true, reversed_at: q.now(), reversal_reason: `Replaced by CSV import ${batch.filename} row ${r.row_index}` });
        q.sysUpdate('import_batch_rows', r, { row_status: 'replaced', transaction_id: tx.id }); replaced++;
      } else {
        q.sysUpdate('import_batch_rows', r, { row_status: 'imported', transaction_id: tx.id }); imported++;
      }
    }
    q.sysUpdate('import_batches', batch, { status: 'committed', committed_at: q.now(), imported_rows: imported, skipped_rows: skipped, replaced_rows: replaced });
    q.log('import_batches.committed', 'import_batches', p_batch_id, `CSV imported: ${batch.filename}`, { imported, skipped, replaced });
    return { batch_id: p_batch_id, status: 'committed', imported, skipped, replaced };
  },
};
