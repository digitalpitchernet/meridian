// Parity with the SQL suites tests/sql/20_financial.sql and 30_csv_import.sql: the same fixtures, the same steps,
// the same hand-computed expected values and SQLSTATEs, replayed through the development adapter.
// If one of these fails, the adapter disagrees with the database (the database is the authority).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureAdapter, DataError } from '../../app/data/adapters/fixture.js';
import { buildFixtures, DEV_BUSINESS_ID, DEV_PROFILE_ID } from '../../app/data/fixtures/dev-fixtures.js';
import { FINANCE_TABLES } from '../../app/data/schema-finance.js';

const TODAY = '2026-11-08';
const code = async (p, c, label) => { await assert.rejects(p, e => e instanceof DataError && e.code === c, `${label}: expected SQLSTATE ${c}`); };

// business A with the founder (60%) and cofounder (40%), no finance rows yet
function setup() {
  let clock = new Date('2026-11-08T06:00:00Z');
  const seed = () => { const f = buildFixtures(TODAY); for (const t of Object.keys(FINANCE_TABLES)) f[t] = []; return f; };
  const db = createFixtureAdapter({ seed, session: { business_id: DEV_BUSINESS_ID, profile_id: DEV_PROFILE_ID }, now: () => { clock = new Date(clock.getTime() + 1000); return clock; } });
  return db;
}

async function financialFixtures(db) {
  const [f, c] = (await db.select('participants', { order: [{ col: 'created_at' }] })).map(p => p.id);
  const id = {};
  const acct = async (k, name, account_type, opening_balance, opening_balance_date = '2026-04-01') => {
    id[k] = (await db.insert('financial_accounts', { name, account_type, opening_balance, opening_balance_date })).id;
  };
  await acct('bank1', 'HDFC Current', 'bank', 10000); await acct('bank2', 'ICICI Current', 'bank', 5000);
  await acct('cash', 'Petty cash', 'cash', 500); await acct('credit', 'Credit line', 'credit', -2000); await acct('escrow', 'Escrow', 'escrow', 0);
  await acct('bank3', 'Kotak (new)', 'bank', 1000, '2026-09-01'); await acct('old', 'Old bank', 'bank', 300);
  await db.update('financial_accounts', id.old, { is_active: false });

  id.req = (await db.insert('funding_requirements', { title: 'Seed round', required_amount: 30000, needed_by: '2026-12-31' })).id;
  const commit = async (k, participant_id, funder_name, committed_amount) => { id[k] = (await db.insert('funding_commitments', { requirement_id: id.req, participant_id, funder_name, committed_amount })).id; };
  await commit('c_founder', f, 'Asha (founder)', 20000); await commit('c_cofounder', c, 'Chandra (cofounder)', 10000); await commit('c_angel', null, 'Angel fund', 5000);

  const tx = async (k, row) => { id[k] = (await db.insert('transactions', row)).id; };
  await tx('t1', { account_id: id.bank1, participant_id: f, transaction_date: '2026-05-10', amount: 10000, type: 'income', contribution_type: 'capital_contribution', description: 'Founder capital 1' });
  await tx('t2', { account_id: id.bank1, participant_id: f, transaction_date: '2026-05-20', amount: 10000, type: 'income', contribution_type: 'capital_contribution', description: 'Founder capital 2' });
  await tx('t3', { account_id: id.bank2, participant_id: c, transaction_date: '2026-06-01', amount: 4000, type: 'income', contribution_type: 'capital_contribution', description: 'Cofounder capital part' });
  await tx('t4', { account_id: id.bank1, participant_id: f, transaction_date: '2026-06-05', amount: 1000, type: 'income', contribution_type: 'capital_contribution', description: 'Founder top-up' });
  await tx('t5', { account_id: id.bank2, transaction_date: '2026-06-10', amount: 2500, type: 'income', contribution_type: 'third_party_grant', description: 'Startup grant' });
  await tx('t6', { account_id: id.bank1, transaction_date: '2026-06-12', amount: 3000, type: 'income', description: 'Customer invoice 001' });
  await tx('t7', { account_id: id.bank2, transaction_date: '2026-06-14', amount: 3000, type: 'income', contribution_type: 'third_party_equity', description: 'Angel tranche' });
  return { id, f, c };
}

const view = async (db, name, key, value) => (await db.select(name, { eq: { [key]: value } }))[0];
const status = async (db, cid) => view(db, 'vw_funding_commitment_status', 'commitment_id', cid);
const alloc = (db, commitment_id, transaction_id, amount) => db.insert('payment_allocations', { commitment_id, transaction_id, amount });
const cash = (db, p_as_of) => db.rpc('get_available_cash', { p_as_of });

// runs 20_financial up to the end of each block, so later tests can start from the same state
async function runFinancial(db, upTo = 'cash') {
  const ctx = await financialFixtures(db);
  const { id, f, c } = ctx;
  const T = {};
  // FIN-01..14
  T['FIN-01'] = await status(db, id.c_founder);
  await alloc(db, id.c_founder, id.t1, 10000);
  T['FIN-03'] = await status(db, id.c_founder);
  await alloc(db, id.c_founder, id.t2, 10000);
  T['FIN-05'] = await status(db, id.c_founder);
  await alloc(db, id.c_cofounder, id.t3, 4000);
  T['FIN-07'] = await view(db, 'vw_funding_requirement_summary', 'requirement_id', id.req);
  await code(alloc(db, id.c_cofounder, id.t4, 1000), '23514', 'FIN-08');
  await code(alloc(db, id.c_cofounder, id.t5, 100), '23514', 'FIN-09');
  await code(alloc(db, id.c_angel, id.t6, 100), '23514', 'FIN-10');
  await alloc(db, id.c_angel, id.t5, 2500);
  await code(alloc(db, id.c_angel, id.t5, 1), '23514', 'FIN-12');
  await alloc(db, id.c_angel, id.t7, 3000);
  T['FIN-14'] = await status(db, id.c_angel);
  if (upTo === 'allocations') return { ...ctx, T };

  // FIN-20..40
  await code(db.rpc('reverse_transaction', { p_transaction_id: id.t2, p_reason: '  ' }), '23514', 'FIN-20');
  T['FIN-21'] = await db.rpc('reverse_transaction', { p_transaction_id: id.t2, p_reason: 'Bank returned the transfer' });
  T['FIN-22'] = (await db.select('payment_allocations', { eq: { transaction_id: id.t2 } })).every(a => a.is_reversed);
  T['FIN-23'] = await status(db, id.c_founder);
  T['FIN-24'] = (await db.select('activity_records', { eq: { entity_id: id.t2, event_type: 'transactions.reversed' } }))[0];
  await code(db.rpc('reverse_transaction', { p_transaction_id: id.t2, p_reason: 'again' }), '23514', 'FIN-25');
  await code(alloc(db, id.c_founder, id.t2, 1), '23514', 'FIN-26');
  await code(db.update('transactions', id.t1, { amount: 1 }), '42501', 'FIN-27');
  await db.update('funding_commitments', id.c_founder, { committed_amount: 10000 });
  T['FIN-29'] = await status(db, id.c_founder);
  await code(db.rpc('revoke_funding_commitment', { p_commitment_id: id.c_cofounder, p_reason: 'Cofounder withdrew' }), '23514', 'FIN-30');
  const coAlloc = (await db.select('payment_allocations', { eq: { commitment_id: id.c_cofounder, is_reversed: false } }))[0];
  await db.rpc('reverse_payment_allocation', { p_allocation_id: coAlloc.id, p_reason: 'Moved to loan' });
  await db.rpc('revoke_funding_commitment', { p_commitment_id: id.c_cofounder, p_reason: 'Cofounder withdrew' });
  T['FIN-33'] = await status(db, id.c_cofounder);
  await code(alloc(db, id.c_cofounder, id.t3, 1), '23514', 'FIN-34');
  await code(db.update('funding_commitments', id.c_cofounder, { committed_amount: 1 }), '23514', 'FIN-35');
  T['FIN-36'] = (await db.select('activity_records', { eq: { entity_id: id.c_cofounder, event_type: 'funding_commitments.revoked' } }))[0];
  await code(db.updateWhere('payment_allocations', { transaction_id: id.t2 }, { is_reversed: false }), '42501', 'FIN-37');

  // FIN-50..61
  id.re1 = (await db.insert('transactions', { participant_id: f, transaction_date: '2026-06-15', amount: 1200, type: 'expense', contribution_type: 'reimbursable_expense', is_personal_founder_payment: true, description: 'Domain + hosting paid personally' })).id;
  await code(db.insert('transactions', { participant_id: f, transaction_date: '2026-06-15', amount: 10, type: 'expense', is_personal_founder_payment: true, description: 'x' }), '23514', 'FIN-51');
  await code(db.insert('transactions', { account_id: id.bank1, transaction_date: '2026-06-15', amount: 10, type: 'income', contribution_type: 'capital_contribution', description: 'x' }), '23514', 'FIN-52');
  const settle = (participant_id, settles, amount, contribution_type = 'reimbursement', date = '2026-06-21') => db.insert('transactions', {
    account_id: id.bank1, participant_id, settles_transaction_id: settles, transaction_date: date, amount, type: 'expense', contribution_type, description: 'x' });
  await settle(f, id.re1, 700, 'reimbursement', '2026-06-20');
  T['FIN-54'] = await view(db, 'vw_settlement_status', 'transaction_id', id.re1);
  await code(settle(f, id.re1, 600), '23514', 'FIN-55');
  await code(settle(c, id.re1, 100), '23514', 'FIN-56');
  await code(settle(f, id.t6, 100), '23514', 'FIN-57');
  await code(db.rpc('reverse_transaction', { p_transaction_id: id.re1, p_reason: 'x' }), '23514', 'FIN-58');
  id.loan1 = (await db.insert('transactions', { account_id: id.bank1, participant_id: f, transaction_date: '2026-06-25', amount: 5000, type: 'income', contribution_type: 'founder_loan', description: 'Founder loan' })).id;
  await settle(f, id.loan1, 2000, 'loan_repayment', '2026-07-01');
  T['FIN-61'] = await view(db, 'vw_participant_contribution_summary', 'participant_id', f);
  if (upTo === 'settlements') return { ...ctx, T };

  // FIN-70..75
  const s = (await db.insert('capital_structures', { agreed_capital_target: 1000000, contribution_basis: '60/40 founders' })).id;
  const tseed = (await db.insert('capital_targets', { structure_id: s, name: 'Seed', target_amount: 200000 })).id;
  await db.insert('capital_targets', { structure_id: s, name: 'Series A', target_amount: 900000 });
  const s2 = (await db.insert('capital_structures', { agreed_capital_target: 1, is_current: false, title: 'Draft structure' })).id;
  const tother = (await db.insert('capital_targets', { structure_id: s2, name: 'Other', target_amount: 1 })).id;
  await db.insert('participant_capital_allocations', { structure_id: s, capital_target_id: tseed, participant_id: f, allocated_amount: 300000 });
  await db.insert('participant_capital_allocations', { structure_id: s, participant_id: c, allocated_amount: 400000 });
  await code(db.insert('participant_capital_allocations', { structure_id: s, capital_target_id: tother, participant_id: f, allocated_amount: 1 }), '23503', 'FIN-72');
  T['FIN-73'] = await view(db, 'vw_capital_target_summary', 'capital_target_id', tseed);
  T['FIN-74'] = await view(db, 'vw_capital_structure_summary', 'structure_id', s);
  T['FIN-75'] = (await db.select('participants')).map(p => p.agreed_equity_percentage).filter(Boolean).sort().reverse().join('/');

  // CASH-01..18
  T['CASH-01'] = await cash(db, '2026-07-04');
  const transfer = (from, to, date, amount, description) => db.insert('transactions', { account_id: from, transfer_to_account_id: to, transaction_date: date, amount, type: 'transfer', description });
  await transfer(id.bank1, id.bank2, '2026-07-05', 1500, 'Rebalance');
  T['CASH-03'] = [await cash(db, '2026-07-05'), await cash(db, '2026-07-04')];
  await transfer(id.bank1, id.escrow, '2026-07-10', 2000, 'Security deposit to escrow');
  T['CASH-05'] = [await cash(db, '2026-07-10'), await cash(db, '2026-07-09')];
  await transfer(id.credit, id.bank1, '2026-07-12', 1000, 'Credit draw');
  T['CASH-07'] = [await cash(db, '2026-07-12'), await cash(db, '2026-07-11')];
  await db.insert('transactions', { account_id: id.bank2, transaction_date: '2026-07-15', amount: 800, type: 'expense', description: 'Office rent July' });
  await db.insert('transactions', { account_id: id.bank1, transaction_date: '2099-01-01', amount: 9999, type: 'income', description: 'Scheduled receivable' });
  await code(db.insert('transactions', { account_id: id.bank3, transaction_date: '2026-08-01', amount: 10, type: 'income', description: 'x' }), '23514', 'CASH-10');
  await code(db.insert('transactions', { account_id: id.old, transaction_date: '2026-08-01', amount: 10, type: 'income', description: 'x' }), '23514', 'CASH-11');
  for (const d of ['2026-07-31', '2026-05-15', '2026-03-31', '2026-11-08', '2099-12-31']) T[`cash@${d}`] = await cash(db, d);
  T.today = await db.rpc('get_available_cash');
  T['CASH-17'] = (await db.rpc('get_account_balances', { p_as_of: '2026-07-31' })).sort((a, b) => (a.name < b.name ? -1 : 1)).map(b => `${b.name}=${b.balance}:${b.counts_as_available_cash}`).join(', ');
  T['CASH-18'] = [await cash(db, '2026-06-16'), await cash(db, '2026-06-14')];
  return { ...ctx, T };
}

const diff = ([a, b]) => (Math.round(Number(a) * 100) - Math.round(Number(b) * 100)) / 100;

test('20_financial FIN-01..14: pledge -> payment -> derived status; eligibility and over-allocation guards', async () => {
  const { T } = await runFinancial(setup(), 'allocations');
  assert.equal(`${T['FIN-01'].status}/${T['FIN-01'].received_amount}`, 'pledged/0.00');
  assert.equal(`${T['FIN-03'].status}/${T['FIN-03'].outstanding_amount}`, 'partially_paid/10000.00');
  assert.equal(`${T['FIN-05'].status}/${T['FIN-05'].received_amount}/${T['FIN-05'].outstanding_amount}`, 'fulfilled/20000.00/0.00');
  const r = T['FIN-07'];
  assert.equal(`${r.required_amount}/${r.committed_amount}/${r.received_amount}/${r.outstanding_commitments}/${r.uncommitted_gap}`, '30000.00/35000.00/24000.00/11000.00/0.00');
  assert.equal(`${T['FIN-14'].status}/${T['FIN-14'].received_amount}/${T['FIN-14'].outstanding_amount}`, 'over_allocated/5500.00/0.00');
});

test('20_financial FIN-20..37: reversal cascade, immutability, committed-amount change, revocation', async () => {
  const { T } = await runFinancial(setup(), 'settlements');
  assert.deepEqual(T['FIN-21'].status, 'reversed');
  assert.equal(T['FIN-22'], true);
  assert.equal(`${T['FIN-23'].status}/${T['FIN-23'].received_amount}`, 'partially_paid/10000.00');
  assert.equal(T['FIN-24'].metadata.allocations_reversed, 1);
  assert.equal(T['FIN-29'].status, 'fulfilled');
  assert.equal(`${T['FIN-33'].status}/${T['FIN-33'].outstanding_amount}`, 'revoked/0.00');
  assert.equal(`${T['FIN-36'].actor_type}/${T['FIN-36'].metadata.reason}`, 'user/Cofounder withdrew');
});

test('20_financial FIN-38..40: even server-side writes cannot un-reverse or back-date (trigger guards)', async () => {
  // the founder is stopped by column grants (42501); the triggers behind them stop everyone else (23514)
  const { FINANCE_TABLES: F } = await import('../../app/data/schema-finance.js');
  const o = { id: 't', is_reversed: true, reversed_at: '2026-11-08T00:00:00Z', reversal_reason: 'r', amount: '1.00', transaction_date: '2026-05-10' };
  assert.throws(() => F.transactions.guards.beforeUpdate(o, { ...o, is_reversed: false, reversed_at: null, reversal_reason: null }), e => e.code === '23514');
  assert.throws(() => F.payment_allocations.guards.beforeUpdate(o, { ...o, is_reversed: false, reversed_at: null, reversal_reason: null }), e => e.code === '23514');
  assert.throws(() => F.transactions.guards.beforeUpdate(o, { ...o, transaction_date: '2026-04-02' }), e => e.code === '23514');
});

test('20_financial FIN-50..61: loans and reimbursable expenses stay separate from equity and each other', async () => {
  const { T } = await runFinancial(setup(), 'settlements');
  assert.equal(`${T['FIN-54'].settled_amount}/${T['FIN-54'].outstanding_amount}`, '700.00/500.00');
  const s = T['FIN-61'];
  assert.equal(`${s.agreed_equity_percentage}/${s.capital_contributed}/${s.loans_advanced}/${s.loans_outstanding}/${s.reimbursements_owed}`, '60.00/11000.00/5000.00/3000.00/500.00');
});

test('20_financial FIN-70..75 and CASH-01..18: capital views and available cash, hand-computed', async () => {
  const { T } = await runFinancial(setup());
  assert.equal(`${T['FIN-73'].allocation_status}/${T['FIN-73'].over_allocated_amount}`, 'over_allocated/100000.00');
  const s = T['FIN-74'];
  assert.equal(`${s.allocated_amount}/${s.allocation_status}/${s.targets_exceed_structure_by}/${s.over_allocated_target_count}`, '700000.00/under_allocated/100000.00/1');
  assert.equal(T['FIN-75'], '60.00/40.00');
  assert.equal(T['CASH-01'], '41300.00');
  assert.equal(diff(T['CASH-03']), 0);
  assert.equal(diff(T['CASH-05']), -2000);
  assert.equal(diff(T['CASH-07']), 1000);
  assert.equal(T['cash@2026-07-31'], '39500.00');
  assert.equal(T['cash@2026-05-15'], '25500.00');
  assert.equal(T['cash@2026-03-31'], '0.00'); // CASH-14 (migration 9: always 2 decimals)
  assert.equal(T['cash@2026-11-08'], '40500.00');
  assert.equal(T.today, '40500.00'); // no date: business-local today
  assert.equal(T['cash@2099-12-31'], '50499.00');
  assert.equal(T['CASH-17'], 'Credit line=-3000.00:false, Escrow=2000.00:false, HDFC Current=23800.00:true, ICICI Current=15200.00:true, Old bank=300.00:false, Petty cash=500.00:true');
  assert.equal(diff(T['CASH-18']), 0);
});

test('30_csv_import CSV-01..32: stage, server parse, duplicates, decisions, atomic commit, provenance', async () => {
  const db = setup();
  const { id } = await runFinancial(db);
  const B = id.bank1;
  const txRow = async row => (await db.insert('transactions', row)).id;
  id.typo = await txRow({ account_id: B, transaction_date: '2026-08-05', amount: 450, type: 'expense', description: 'Typo vendor' });
  id.other = await txRow({ account_id: id.bank2, transaction_date: '2026-08-05', amount: 100, type: 'expense', description: 'Other-account expense' });
  id.transfer = (await db.select('transactions', { eq: { type: 'transfer', description: 'Rebalance' } }))[0].id;
  const batch = async (filename, ch, payloads) => {
    const b = (await db.insert('import_batches', { account_id: B, filename, file_checksum_sha256: ch.repeat(64) })).id;
    for (const [i, payload] of payloads.entries()) await db.insert('import_batch_rows', { batch_id: b, row_index: i, payload });
    return b;
  };
  const rowsOf = async b => db.select('import_batch_rows', { eq: { batch_id: b }, order: [{ col: 'row_index' }] });
  const commit = b => db.rpc('commit_import_batch', { p_batch_id: b });

  const b1 = await batch('hdfc-aug.csv', 'a', [
    { date: '2026-08-03', amount: '1200.50', type: 'expense', description: 'AWS  August' },
    { date: '2026-08-04', amount: '300', type: 'income', description: 'Stripe payout' },
    { date: '03/08/2026', amount: '10', type: 'expense', description: 'bad date' },
    { date: '2026-08-04', amount: '-5', type: 'expense', description: 'negative' },
    { date: '2026-06-12', amount: '3000.00', type: 'income', description: 'customer invoice   001' },
    { date: '2026-08-03', amount: '1200.5', type: 'expense', description: 'aws august' }]);
  let r = await rowsOf(b1);
  assert.equal(r.slice(0, 2).map(x => `${x.parsed_date} ${x.parsed_amount} ${x.parsed_type} ${x.parsed_description}`).join(' | '), '2026-08-03 1200.50 expense AWS August | 2026-08-04 300.00 income Stripe payout'); // CSV-01
  assert.equal(r.slice(2, 4).map(x => `${x.row_index}:${x.validation_error != null}`).join(','), '2:true,3:true'); // CSV-02
  assert.equal(r[4].duplicate_of_transaction_id, id.t6); // CSV-03
  await code(commit(b1), '23514', 'CSV-04');
  assert.equal((await db.updateWhere('import_batch_rows', { batch_id: b1, row_index: 2 }, { resolution: 'skip' })).length
    + (await db.updateWhere('import_batch_rows', { batch_id: b1, row_index: 3 }, { resolution: 'skip' })).length, 2); // CSV-05
  await code(commit(b1), '23514', 'CSV-06');
  assert.equal(`${(await db.get('import_batches', b1)).status}/${(await db.select('transactions', { eq: { import_batch_id: b1 } })).length}`, 'staged/0'); // CSV-07
  await db.updateWhere('import_batch_rows', { batch_id: b1, row_index: 4 }, { resolution: 'skip' }); // CSV-08
  await db.updateWhere('import_batch_rows', { batch_id: b1, row_index: 5 }, { resolution: 'import' });
  const res = await commit(b1);
  assert.equal(`${res.imported}/${res.skipped}`, '3/3'); // CSV-09
  assert.equal((await db.select('transactions', { eq: { import_batch_id: b1 } })).length, 3); // CSV-10
  assert.equal((await rowsOf(b1))[5].duplicate_in_batch, true); // CSV-11
  assert.equal((await db.select('activity_records', { eq: { entity_id: b1, event_type: 'import_batches.committed' } }))[0].metadata.imported, 3); // CSV-12
  await code(commit(b1), '23514', 'CSV-13');
  await code(db.remove('import_batches', b1), '42501', 'CSV-14');
  await code(db.removeWhere('import_batch_rows', { batch_id: b1 }), '42501', 'CSV-15');
  await code(db.insert('import_batch_rows', { batch_id: b1, row_index: 9, payload: { date: '2026-08-09', amount: '1', type: 'expense', description: 'late' } }), '23514', 'CSV-16');
  await code(db.updateWhere('import_batch_rows', { batch_id: b1, row_index: 0 }, { resolution: 'skip' }), '23514', 'CSV-17');

  const again = await batch('hdfc-aug-again.csv', 'a', [{ date: '2026-08-06', amount: '1', type: 'expense', description: 'same file' }]);
  await code(commit(again), '23505', 'CSV-20');
  await db.remove('import_batches', again);

  for (const [k, target] of [[1, id.other], [2, id.transfer], [3, id.t1], [4, id.t2]]) {
    const b = await batch(`replace-${k}.csv`, String(k), [{ date: '2026-08-07', amount: '10', type: 'expense', description: 'replacement' }]);
    await db.updateWhere('import_batch_rows', { batch_id: b }, { resolution: 'replace', replace_transaction_id: target });
    await code(commit(b), '23514', `CSV-2${k}`);
    await db.remove('import_batches', b);
  }
  const twice = await batch('replace-twice.csv', 'e', [
    { date: '2026-08-05', amount: '540', type: 'expense', description: 'Vendor (corrected)' },
    { date: '2026-08-05', amount: '541', type: 'expense', description: 'Vendor (corrected again)' }]);
  await db.updateWhere('import_batch_rows', { batch_id: twice }, { resolution: 'replace', replace_transaction_id: id.typo });
  await code(commit(twice), '23514', 'CSV-25');
  await db.remove('import_batches', twice);

  const fix = await batch('correction.csv', 'f', [{ date: '2026-08-05', amount: '540', type: 'expense', description: 'Vendor (corrected)' }]);
  await db.updateWhere('import_batch_rows', { batch_id: fix }, { resolution: 'replace', replace_transaction_id: id.typo });
  await commit(fix); // CSV-26
  const typo = await db.get('transactions', id.typo);
  assert.equal(`${typo.is_reversed}/${typo.reversal_reason.startsWith('Replaced by CSV import correction.csv')}`, 'true/true'); // CSV-27
  assert.equal((await db.select('transactions', { eq: { replaces_transaction_id: id.typo } }))[0].amount, '540.00'); // CSV-28

  const atomic = await batch('atomic.csv', '9', [
    { date: '2026-08-08', amount: '77', type: 'expense', description: 'would be fine alone' },
    { date: '2026-03-01', amount: '88', type: 'expense', description: 'before the account opened' }]);
  await code(commit(atomic), '23514', 'CSV-29');
  assert.equal(`${(await db.get('import_batches', atomic)).status}/${(await db.select('transactions', { eq: { import_batch_id: atomic } })).length}/${(await db.select('transactions', { eq: { description: 'would be fine alone' } })).length}`, 'staged/0/0'); // CSV-30
  // CSV-31/32 (another tenant): RLS scoping is covered by data.test.mjs; an unknown batch is P0002
  await code(db.rpc('commit_import_batch', { p_batch_id: '00000000-0000-4000-8000-0000000000ff' }), 'P0002', 'CSV-31');
});

test('ledger: no deletes for transactions, allocations or commitments; activity on insert carries the amount', async () => {
  const db = setup();
  const { id } = await runFinancial(db, 'allocations');
  await code(db.remove('transactions', id.t1), '42501', 'tx delete');
  await code(db.remove('funding_commitments', id.c_angel), '42501', 'commitment delete');
  await code(db.remove('financial_accounts', id.bank1), '42501', 'account delete');
  const a = (await db.select('activity_records', { eq: { entity_id: id.t6 } }))[0];
  assert.equal(`${a.event_type}/${a.summary}/${a.metadata.amount}`, 'transactions.insert/Transactions insert: Customer invoice 001/3000.00');
  // a participant with money on record cannot be deleted (ON DELETE RESTRICT), and the failed delete changed nothing
  const before = (await db.select('participants')).length;
  await code(db.remove('participants', (await db.select('participants'))[0].id), '23503', 'participant restrict');
  assert.equal((await db.select('participants')).length, before);
});
