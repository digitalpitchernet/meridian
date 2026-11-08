// Turn data-layer errors (Postgres SQLSTATE, as the adapters raise them) into plain messages for the founder.
const CONSTRAINTS = {
  chk_projects_dates: 'The target date can’t be before the start date.',
  chk_tasks_recurrence: 'Choose both a repeat rule and an interval, or neither.',
  chk_calendar_times: 'The end can’t be before the start.',
};
const LABELS = { name: 'Name', title: 'Title', status: 'Status', priority: 'Priority', due_date: 'Due date', target_date: 'Target date', start_date: 'Start date',
  project_id: 'Project', first_name: 'First name', category: 'Category', decision_date: 'Decision date', review_date: 'Review date', starts_at: 'Start', ends_at: 'End',
  superseded_by_id: 'Superseding decision', selected_option_id: 'Selected option', relationship_role: 'Role' };

// finance guards (migrations 3-5) raise 23514 with a message; these are the founder-facing versions
const FINANCE = [
  [/precedes the (account|destination) opening balance date/, 'That date is before the account’s opening balance date.'],
  [/account .* is inactive/, 'That account is inactive. Reactivate it first, or choose another account.'],
  [/cannot settle a reversed/, 'That item was reversed, so there is nothing to settle.'],
  [/cannot settle a/, 'A reimbursement settles a reimbursable expense; a loan repayment settles a founder loan.'],
  [/settlement participant must match/, 'The settlement must go to the same participant as the original.'],
  [/would exceed the outstanding/, 'That is more than is still owed.'],
  [/only funding receipts/, 'Only capital, loans and outside funding can count towards a commitment. Customer revenue cannot.'],
  [/belongs to another participant/, 'This commitment belongs to another participant; the payment must come from them.'],
  [/allocations .* would exceed the transaction amount/, 'That is more than is left unallocated on this payment.'],
  [/cannot allocate a reversed/, 'That payment was reversed.'],
  [/commitment .* is revoked/, 'This commitment was revoked; it can no longer change or receive payments.'],
  [/has received payments; reverse those allocations/, 'Money has been received against this commitment. Reverse those payments first, then revoke it.'],
  [/reverse the reimbursements\/repayments/, 'Reverse its reimbursements or repayments first.'],
  [/is already reversed/, 'This was already reversed.'],
  [/is already revoked/, 'This commitment was already revoked.'],
  [/has invalid rows/, 'Some rows are invalid. Mark them Skip, or fix the file and import it again.'],
  [/suspected duplicates without a decision/, 'Decide each possible duplicate first: import, skip or replace.'],
  [/two rows replace the same transaction/, 'Two rows replace the same transaction. Choose one.'],
  [/already imported into this account/, 'This exact file was already imported into this account.'],
  [/permanent provenance/, 'A committed import is permanent provenance and cannot be changed or deleted.'],
  [/replaced transaction belongs to another account/, 'Only a transaction on the same account can be replaced.'],
  [/only ordinary income\/expense can be replaced/, 'Only ordinary income or expenses can be replaced from a CSV. Correct funding records by reversal.'],
  [/replaced transaction has payment allocations/, 'That transaction has payments allocated to commitments. Reverse those first.'],
  [/before the account opening|row \d+:/, null],
];
Object.assign(CONSTRAINTS, {
  chk_tx_shape: 'That combination of accounts doesn’t describe a valid movement of money.',
  chk_tx_contribution: 'That type needs the right participant and account details.',
  chk_rt_dates: 'The end date can’t be before the start date.',
  uq_financial_categories_name: 'A category with that name already exists.',
});
Object.assign(LABELS, { amount: 'Amount', transaction_date: 'Date', account_id: 'Account', transfer_to_account_id: 'Destination account', participant_id: 'Participant',
  description: 'Description', opening_balance: 'Opening balance', opening_balance_date: 'Opening balance date', required_amount: 'Required amount',
  committed_amount: 'Committed amount', funder_name: 'Funder', target_amount: 'Target amount', allocated_amount: 'Allocated amount', agreed_capital_target: 'Agreed capital target',
  settles_transaction_id: 'What it settles', filename: 'File name' });

export function friendlyError(e) {
  const col = e?.details?.column;
  const label = LABELS[col] || col;
  const fin = ['23514', '23505', '42501', '23503'].includes(e?.code) && FINANCE.find(([re]) => re.test(e.message || ''));
  if (fin) return { column: null, message: fin[1] ?? e.message };
  switch (e?.code) {
    case '22P02': return { column: col, message: `${label || 'That'} must be a number.` };
    case '22003': return { column: col, message: `${label || 'That amount'} is too large.` };
    case '23505': return { column: col, message: e.details?.constraint && CONSTRAINTS[e.details.constraint] ? CONSTRAINTS[e.details.constraint] : 'That already exists.' };
    case '23502': return { column: col, message: `${label || 'This field'} is required.` };
    case '23514':
      if (e.details?.constraint && CONSTRAINTS[e.details.constraint]) return { column: e.details.constraint === 'chk_projects_dates' ? 'target_date' : null, message: CONSTRAINTS[e.details.constraint] };
      if (/length (\d+)–(\d+)/.test(e.message)) { const [, a, b] = e.message.match(/length (\d+)–(\d+)/); return { column: col, message: `${label} must be ${a}–${b} characters.` }; }
      return { column: col, message: `${label || 'That value'} isn’t allowed.` };
    case '23503': return { column: col, message: 'The linked record no longer exists. Refresh and try again.' };
    case '42501': return { column: col, message: 'Not permitted. Meridian manages that field itself.' };
    case '22007': return { column: col, message: `${label || 'That date'} isn’t a valid date.` };
    default: return { column: col, message: e?.message || 'Something went wrong.' };
  }
}
