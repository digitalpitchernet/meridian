// FICTIONAL finance fixtures for Kestrel Ridge Studio (INR). Invented accounts, invented institutions, invented money.
// Rows are stored exactly as the database would hold them after the same writes (including one reversal and one
// revocation); tests/app/finance.test.mjs replays them through the adapter's guards to prove they are reachable.
// Derived figures (balances, cash, statuses, outstanding amounts) are NOT stored: the views and RPCs compute them.
import { TABLES } from '../schema.js';

// a complete row: every column present, unset columns at their schema default (or null)
const full = (table, partial) => {
  const row = {};
  for (const [col, c] of Object.entries(TABLES[table].columns)) {
    row[col] = col in partial ? partial[col] : typeof c.default === 'function' ? c.default() : (c.default !== undefined && !['uuid', 'now', 'today'].includes(c.default) ? c.default : null);
  }
  return row;
};

export function buildFinanceFixtures({ B, d, ts, fid, founder, cofounder, project }) {
  const at = (n, extra) => ({ business_id: B, created_at: ts(n, 11), ...extra });
  const A = n => fid('f', n), K = n => fid('f', 20 + n), X = n => fid('g', n), H = n => fid('h', n), Q = n => fid('h', 50 + n), S = n => fid('f', 40 + n);

  const financial_accounts = [
    [1, 'Operating account', 'bank', 'Larkspur Co-operative Bank (fictional)', '0.00'],
    [2, 'Reserve account', 'bank', 'Larkspur Co-operative Bank (fictional)', '0.00'],
    [3, 'Petty cash', 'cash', null, '5000.00'],
    [4, 'Card credit line', 'credit', 'Larkspur Co-operative Bank (fictional)', '0.00'],
    [5, 'Studio lease deposit', 'escrow', 'Held by the landlord (fictional)', '0.00'],
  ].map(([n, name, account_type, institution, opening_balance]) => full('financial_accounts', at(-115, {
    id: A(n), name, account_type, institution, opening_balance, opening_balance_date: d(-115), updated_at: ts(-115, 11),
  })));

  const cats = [[1, 'Client projects', 'income'], [2, 'Grants', 'income'], [3, 'Software & hosting', 'expense'], [4, 'Rent & workspace', 'expense'],
    [5, 'Contractors', 'expense'], [6, 'Travel', 'expense'], [7, 'Professional fees', 'expense']];
  const financial_categories = cats.map(([n, name, kind]) => full('financial_categories', at(-115, { id: K(n), name, kind })));
  const cat = name => K(cats.find(c => c[1] === name)[0]);

  // [n, day, account, type, amount, description, extra]
  const t = (n, day, account, type, amount, description, extra = {}) => full('transactions', at(day, {
    id: X(n), account_id: account ? A(account) : null, transaction_date: d(day), amount, type, description, updated_at: ts(day, 11), ...extra,
  }));
  const capital = (p) => ({ participant_id: p, contribution_type: 'capital_contribution' });
  const transactions = [
    t(1, -110, 1, 'income', '600000.00', 'Founder capital: Asha Varma', capital(founder)),
    t(2, -105, 1, 'income', '250000.00', 'Co-founder capital: Rohan Mehra (1 of 2)', capital(cofounder)),
    t(3, -90, 1, 'expense', '45000.00', 'Studio rent, month 1', { category_id: cat('Rent & workspace') }),
    t(4, -88, 1, 'transfer', '90000.00', 'Studio lease deposit', { transfer_to_account_id: A(5) }),
    t(5, -85, 1, 'expense', '12500.00', 'Design tools and hosting', { category_id: cat('Software & hosting') }),
    t(6, -80, 1, 'transfer', '200000.00', 'Move runway buffer to reserve', { transfer_to_account_id: A(2) }),
    t(7, -70, 1, 'income', '200000.00', 'Founder loan: Asha Varma', { participant_id: founder, contribution_type: 'founder_loan' }),
    t(8, -60, 1, 'expense', '45000.00', 'Studio rent, month 2', { category_id: cat('Rent & workspace') }),
    t(9, -60, 1, 'income', '150000.00', 'Co-founder capital: Rohan Mehra (2 of 2)', capital(cofounder)),
    t(10, -55, 1, 'expense', '12500.00', 'Design tools and hosting', { category_id: cat('Software & hosting') }),
    t(11, -50, 1, 'income', '180000.00', 'Client: Halden Foods brand sprint', { category_id: cat('Client projects'), reference: 'INV-2026-011' }),
    t(12, -45, 1, 'expense', '30000.00', 'Company secretary and filings', { category_id: cat('Professional fees') }),
    t(13, -40, 2, 'income', '300000.00', 'Regional innovation grant, tranche 1 (fictional)', { contribution_type: 'third_party_grant', category_id: cat('Grants') }),
    t(14, -35, 1, 'expense', '120000.00', 'Contract illustrator, brand system', { category_id: cat('Contractors') }),
    t(15, -30, 1, 'expense', '45000.00', 'Studio rent, month 3', { category_id: cat('Rent & workspace') }),
    t(16, -28, null, 'expense', '18500.00', 'Design conference travel, paid personally', { participant_id: founder, contribution_type: 'reimbursable_expense', is_personal_founder_payment: true, category_id: cat('Travel') }),
    t(17, -25, 1, 'expense', '12500.00', 'Design tools and hosting', { category_id: cat('Software & hosting') }),
    t(18, -20, 1, 'expense', '50000.00', 'Founder loan repayment 1', { participant_id: founder, contribution_type: 'loan_repayment', settles_transaction_id: X(7) }),
    t(19, -18, 1, 'income', '42000.00', 'Client: Halden Foods, invoice 014', { category_id: cat('Client projects'), reference: 'INV-2026-014',
      is_reversed: true, reversed_at: ts(-16, 15), reversal_reason: 'Recorded twice; the bank statement shows one receipt', updated_at: ts(-16, 15) }),
    t(20, -18, 1, 'income', '42000.00', 'Client: Halden Foods, invoice 014', { category_id: cat('Client projects'), reference: 'INV-2026-014' }),
    t(21, -15, 4, 'transfer', '40000.00', 'Draw on the card credit line', { transfer_to_account_id: A(1) }),
    t(22, -10, 1, 'expense', '10000.00', 'Reimburse conference travel (part)', { participant_id: founder, contribution_type: 'reimbursement', settles_transaction_id: X(16) }),
    t(23, -6, 3, 'expense', '2400.00', 'Courier and stationery', { category_id: cat('Professional fees') }),
    t(24, -3, 1, 'expense', '64000.00', 'Contract developer, prototype', { category_id: cat('Contractors') }),
    t(25, 0, 1, 'expense', '45000.00', 'Studio rent, month 4', { category_id: cat('Rent & workspace') }),
  ];

  const funding_requirements = [
    full('funding_requirements', at(-100, { id: H(1), project_id: project, title: 'Seed operating runway', required_amount: '1500000.00', needed_by: d(60), lifecycle: 'open',
      notes: 'Twelve months of studio costs before the first retained client.', updated_at: ts(-100, 11) })),
    full('funding_requirements', at(-30, { id: H(2), project_id: null, title: 'Prototype hardware and testing', required_amount: '250000.00', needed_by: d(45), lifecycle: 'draft', updated_at: ts(-30, 11) })),
  ];
  const c = (n, day, participant_id, funder_name, committed_amount, extra = {}) => full('funding_commitments', at(day, {
    id: H(10 + n), requirement_id: H(1), participant_id, funder_name, committed_amount, updated_at: ts(day, 11), ...extra }));
  const funding_commitments = [
    c(1, -100, founder, 'Asha Varma (founder)', '600000.00'),
    c(2, -100, cofounder, 'Rohan Mehra (co-founder)', '500000.00', { expected_payment_date: d(20), notes: 'Final tranche after the beta ships.' }),
    c(3, -45, null, 'Regional innovation grant (fictional)', '300000.00'),
    c(4, -20, null, 'Lumen Angels (fictional)', '300000.00', { expected_payment_date: d(30), notes: 'Term sheet signed; wire expected after due diligence.' }),
    c(5, -60, null, 'Harbor Seed Fund (fictional)', '250000.00', { revoked_at: ts(-22, 12), revocation_reason: 'The fund paused new investments this quarter.', updated_at: ts(-22, 12) }),
  ];
  const pa = (n, day, cn, tn, amount) => full('payment_allocations', at(day, { id: H(30 + n), commitment_id: H(10 + cn), transaction_id: X(tn), amount, updated_at: ts(day, 11) }));
  const payment_allocations = [pa(1, -110, 1, 1, '600000.00'), pa(2, -105, 2, 2, '250000.00'), pa(3, -60, 2, 9, '150000.00'), pa(4, -40, 3, 13, '300000.00')];

  const capital_structures = [full('capital_structures', at(-100, {
    id: S(1), title: 'Founding capital plan', agreed_capital_target: '1500000.00', contribution_basis: '60/40 founders, plus outside seed', effective_date: d(-100), is_current: true, updated_at: ts(-100, 11) }))];
  const capital_targets = [
    full('capital_targets', at(-100, { id: S(2), structure_id: S(1), name: 'Founder capital', target_amount: '1000000.00', target_date: d(-30), updated_at: ts(-100, 11) })),
    full('capital_targets', at(-100, { id: S(3), structure_id: S(1), name: 'Outside seed', target_amount: '500000.00', target_date: d(90), updated_at: ts(-100, 11) })),
  ];
  const participant_capital_allocations = [
    full('participant_capital_allocations', at(-100, { id: S(4), structure_id: S(1), capital_target_id: S(2), participant_id: founder, allocated_amount: '600000.00', basis_notes: '60% of founder capital', updated_at: ts(-100, 11) })),
    full('participant_capital_allocations', at(-100, { id: S(5), structure_id: S(1), capital_target_id: S(2), participant_id: cofounder, allocated_amount: '400000.00', basis_notes: '40% of founder capital', updated_at: ts(-100, 11) })),
  ];

  const recurring_transactions = [
    full('recurring_transactions', at(-90, { id: Q(1), account_id: A(1), category_id: cat('Rent & workspace'), type: 'expense', amount: '45000.00', description: 'Studio rent', frequency: 'monthly', start_date: d(-90), next_due_date: d(30), updated_at: ts(-90, 11) })),
    full('recurring_transactions', at(-85, { id: Q(2), account_id: A(1), category_id: cat('Software & hosting'), type: 'expense', amount: '12500.00', description: 'Design tools and hosting', frequency: 'monthly', start_date: d(-85), next_due_date: d(5), updated_at: ts(-85, 11) })),
  ];

  return { financial_accounts, financial_categories, transactions, payment_allocations, recurring_transactions, funding_requirements, funding_commitments,
    capital_structures, capital_targets, participant_capital_allocations, import_batches: [], import_batch_rows: [] };
}
