// M3 finance: fixtures are reachable through the real guards, repositories expose only contract operations,
// and the projections the screens use are derived from views/RPCs (never recomputed differently on screen).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureAdapter, DataError } from '../../app/data/adapters/fixture.js';
import { buildFixtures, DEV_BUSINESS_ID, DEV_PROFILE_ID } from '../../app/data/fixtures/dev-fixtures.js';
import { createRepositories } from '../../app/data/repositories.js';
import { FINANCE_TABLES } from '../../app/data/schema-finance.js';
import { toCents, fromCents, money } from '../../app/data/money.js';
import { sha256 } from '../../app/data/sha256.js';

const TODAY = '2026-11-08';
const session = { business_id: DEV_BUSINESS_ID, profile_id: DEV_PROFILE_ID };
const make = (seed = () => buildFixtures(TODAY)) => {
  let clock = new Date('2026-11-08T06:00:00Z');
  const db = createFixtureAdapter({ seed, session, now: () => (clock = new Date(clock.getTime() + 1000)) });
  return { db, repo: createRepositories(db) };
};
const code = async (p, c) => { await assert.rejects(p, e => e instanceof DataError && e.code === c, `expected SQLSTATE ${c}`); };

test('money: exact cents, Postgres rounding, overflow and bad input', () => {
  assert.equal(money('1200.5'), '1200.50');
  assert.equal(money('0.105'), '0.11');      // half away from zero, not binary-float 0.10
  assert.equal(money('-0.125'), '-0.13');
  assert.equal(fromCents(toCents('9999999999999.99')), '9999999999999.99');
  assert.throws(() => toCents('10000000000000'), e => e.code === '22003');
  assert.throws(() => toCents('12,50'), e => e.code === '22P02');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('fixtures: every finance row is reachable through the guards (replay gives the same derived figures)', async () => {
  const seeded = make();
  const f = buildFixtures(TODAY);
  const replay = make(() => { const g = buildFixtures(TODAY); for (const t of Object.keys(FINANCE_TABLES)) g[t] = []; return g; });
  const { db } = replay;
  const insertAs = (table, row) => {
    const grant = FINANCE_TABLES[table].insert;
    const cols = grant === true ? Object.keys(row).filter(c => !['created_at', 'updated_at'].includes(c)) : grant;
    return db.insert(table, Object.fromEntries(cols.filter(c => c in row).map(c => [c, row[c]])));
  };
  // keep the fixture ids so references line up: id (a defaulted column) is granted for the replay only
  for (const t of ['financial_accounts', 'transactions', 'payment_allocations', 'funding_commitments']) FINANCE_TABLES[t].insert = [...FINANCE_TABLES[t].insert, 'id'];
  try {
    for (const r of f.financial_accounts) await insertAs('financial_accounts', r);
    for (const r of f.financial_categories) await insertAs('financial_categories', r);
    for (const r of f.funding_requirements) await insertAs('funding_requirements', r);
    for (const r of f.funding_commitments) await insertAs('funding_commitments', r);
    const txs = [...f.transactions].sort((a, b) => (a.transaction_date < b.transaction_date ? -1 : a.transaction_date > b.transaction_date ? 1 : a.id < b.id ? -1 : 1));
    for (const r of txs) await insertAs('transactions', r);
    for (const r of f.payment_allocations) await insertAs('payment_allocations', r);
    for (const t of f.transactions.filter(x => x.is_reversed)) await db.rpc('reverse_transaction', { p_transaction_id: t.id, p_reason: t.reversal_reason });
    for (const c of f.funding_commitments.filter(x => x.revoked_at)) await db.rpc('revoke_funding_commitment', { p_commitment_id: c.id, p_reason: c.revocation_reason });
    for (const t of ['capital_structures', 'capital_targets', 'participant_capital_allocations', 'recurring_transactions']) for (const r of f[t]) await insertAs(t, r);
  } finally {
    for (const t of ['financial_accounts', 'transactions', 'payment_allocations', 'funding_commitments']) FINANCE_TABLES[t].insert = FINANCE_TABLES[t].insert.filter(c => c !== 'id');
  }
  const figures = async x => JSON.stringify({
    cash: await x.db.rpc('get_available_cash'),
    balances: (await x.db.rpc('get_account_balances')).map(b => `${b.name}=${b.balance}`).sort(),
    commitments: (await x.db.select('vw_funding_commitment_status')).map(s => `${s.funder_name}:${s.status}:${s.received_amount}:${s.outstanding_amount}`).sort(),
    requirements: (await x.db.select('vw_funding_requirement_summary')).map(s => `${s.title}:${s.committed_amount}:${s.received_amount}:${s.uncommitted_gap}`).sort(),
    settlements: (await x.db.select('vw_settlement_status')).map(s => `${s.description}:${s.outstanding_amount}`).sort(),
    contributions: (await x.db.select('vw_participant_contribution_summary')).map(s => Object.values(s).slice(2).join(':')).sort(),
    capital: (await x.db.select('vw_capital_structure_summary')).map(s => `${s.allocated_amount}:${s.allocation_status}`),
  });
  assert.equal(await figures(replay), await figures(seeded));
});

test('fixtures: hand-checked figures for the development business', async () => {
  const { repo } = make();
  // Operating: 600000+250000-45000-90000-12500-200000+200000-45000+150000-12500+180000-30000-120000-45000-12500-50000+42000+40000-10000-64000-45000
  //          = 680500 ; Reserve 200000+300000 = 500000 ; Petty cash 5000-2400 = 2600 (the reversed duplicate invoice never counts)
  const b = Object.fromEntries((await repo.accounts.balances()).map(x => [x.name, x.balance]));
  assert.deepEqual(b, { 'Operating account': '680500.00', 'Reserve account': '500000.00', 'Petty cash': '2600.00', 'Card credit line': '-40000.00', 'Studio lease deposit': '90000.00' });
  assert.equal(await repo.accounts.availableCash(), '1183100.00');
  const st = Object.fromEntries((await repo.funding.commitments()).map(s => [s.funder_name, `${s.status}/${s.outstanding_amount}`]));
  assert.deepEqual(st, {
    'Asha Varma (founder)': 'fulfilled/0.00', 'Rohan Mehra (co-founder)': 'partially_paid/100000.00', 'Regional innovation grant (fictional)': 'fulfilled/0.00',
    'Lumen Angels (fictional)': 'pledged/300000.00', 'Harbor Seed Fund (fictional)': 'revoked/0.00' });
  const owed = (await repo.transactions.settlements()).map(s => `${s.contribution_type}:${s.outstanding_amount}`).sort();
  assert.deepEqual(owed, ['founder_loan:150000.00', 'reimbursable_expense:8500.00']);
});

test('repositories: the ledger is append-only through the repository too', async () => {
  const { repo } = make();
  const [t] = await repo.transactions.list({ eq: { description: 'Courier and stationery' } });
  await code(repo.transactions.annotate(t.id, { amount: '1.00' }), '42501');
  await code(repo.transactions.annotate(t.id, { transaction_date: '2026-01-01' }), '42501');
  assert.equal((await repo.transactions.annotate(t.id, { notes: 'Receipt in the vault' })).notes, 'Receipt in the vault');
  assert.equal(repo.transactions.remove, undefined, 'no delete operation is exposed');
  await code(repo.transactions.reverse(t.id, ''), '23514');
  await repo.transactions.reverse(t.id, 'Courier refunded the order');
  assert.equal(await repo.accounts.availableCash(), '1185500.00'); // +2400
  await code(repo.accounts.update((await repo.accounts.list())[0].id, { opening_balance: '1.00' }), '42501');
});

test('repositories: funding allocations follow eligibility; revocation needs allocations reversed first', async () => {
  const { repo } = make();
  const all = await repo.funding.commitments();
  const rohan = all.find(s => s.funder_name.startsWith('Rohan'));
  const angels = all.find(s => s.funder_name.startsWith('Lumen'));
  const [ops] = (await repo.accounts.list()).filter(a => a.name === 'Operating account');
  const founderIncome = (await repo.transactions.list({ eq: { contribution_type: 'founder_loan' } }))[0];
  await code(repo.funding.allocate({ commitment_id: rohan.commitment_id, transaction_id: founderIncome.id, amount: '1000' }), '23514'); // wrong participant
  const wire = await repo.transactions.create({ account_id: ops.id, transaction_date: TODAY, amount: '300000', type: 'income', contribution_type: 'third_party_equity', description: 'Lumen Angels wire' });
  await repo.funding.allocate({ commitment_id: angels.commitment_id, transaction_id: wire.id, amount: '300000' });
  assert.equal((await repo.funding.commitments({ eq: { commitment_id: angels.commitment_id } }))[0].status, 'fulfilled');
  await code(repo.funding.revokeCommitment(rohan.commitment_id, 'Withdrew'), '23514');
  for (const a of await repo.funding.allocations({ eq: { commitment_id: rohan.commitment_id, is_reversed: false } })) await repo.funding.reverseAllocation(a.id, 'Re-papered as a loan');
  await repo.funding.revokeCommitment(rohan.commitment_id, 'Withdrew');
  assert.equal((await repo.funding.commitments({ eq: { commitment_id: rohan.commitment_id } }))[0].status, 'revoked');
});

test('repositories: a CSV import stages raw rows, the server parses them, commit is all-or-nothing', async () => {
  const { repo } = make();
  const [ops] = (await repo.accounts.list()).filter(a => a.name === 'Operating account');
  const batch = await repo.imports.stage({ account_id: ops.id, filename: 'statement.csv', file_checksum_sha256: sha256('statement') }, [
    { date: '2026-11-07', amount: '1500', type: 'Expense', description: ' Taxi  to client ' },
    { date: '2026-11-08', amount: '45000.00', type: 'expense', description: 'Studio rent, month 4' }, // already recorded today
    { date: '07/11/2026', amount: '10', type: 'expense', description: 'bad date' }]);
  const rows = await repo.imports.rows(batch.id);
  assert.equal(`${rows[0].parsed_amount} ${rows[0].parsed_type} ${rows[0].parsed_description}`, '1500.00 expense Taxi to client');
  assert.ok(rows[1].duplicate_of_transaction_id);
  assert.match(rows[2].validation_error, /YYYY-MM-DD/);
  await code(repo.imports.commit(batch.id), '23514');
  await repo.imports.resolve(rows[2].id, 'skip');
  await repo.imports.resolve(rows[1].id, 'skip');
  const res = await repo.imports.commit(batch.id);
  assert.equal(`${res.imported}/${res.skipped}/${res.replaced}`, '1/2/0');
  await code(repo.imports.discard(batch.id), '42501');
});

test('finance-model: every transaction kind the form offers is a shape the CHECK constraints accept', async () => {
  const { TX_KINDS, transactionRow, kindOf } = await import('../../app/modules/finance-model.js');
  const { repo } = make();
  const [ops, reserve] = await repo.accounts.list().then(l => [l.find(a => a.name === 'Operating account'), l.find(a => a.name === 'Reserve account')]);
  const [founder] = await repo.workspace.participants();
  const owed = await repo.transactions.settlements();
  const settles = { reimbursable_expense: owed.find(s => s.contribution_type === 'reimbursable_expense').transaction_id, founder_loan: owed.find(s => s.contribution_type === 'founder_loan').transaction_id };
  for (const kind of TX_KINDS) {
    const row = transactionRow(kind, { transaction_date: TODAY, amount: '100', description: `Kind ${kind.id}`, account_id: ops.id, transfer_to_account_id: reserve.id,
      participant_id: founder.id, settles_transaction_id: settles[kind.settles], funding: 'third_party_grant', category_id: null });
    const created = await repo.transactions.create(row);
    assert.equal(kindOf(created).id, kind.id, `${kind.id} round-trips`);
  }
});

test('finance-model: CSV reading, mapping, signs, eligibility and in-file duplicates', async () => {
  const m = await import('../../app/modules/finance-model.js');
  assert.deepEqual(m.parseCsv('﻿Date,Narration,Amount,Type\r\n2026-11-01,"Cab, airport",450.00,expense\n\n2026-11-02,"Say ""hi""",10,income\n'),
    [['Date', 'Narration', 'Amount', 'Type'], ['2026-11-01', 'Cab, airport', '450.00', 'expense'], ['2026-11-02', 'Say "hi"', '10', 'income']]);
  assert.deepEqual(m.guessMapping(['Txn Date', 'Narration', 'Amount', 'Type']), { date: 0, amount: 2, type: 3, description: 1 });
  assert.deepEqual(m.payloads([['03/08/2026', 'x', '-5', 'Dr']], { date: 0, description: 1, amount: 2, type: 3 }), [{ date: '03/08/2026', amount: '-5', type: 'Dr', description: 'x' }]); // staged as read
  assert.equal(m.signedCents({ type: 'transfer', amount: '10.00', account_id: 'a', transfer_to_account_id: 'b' }), 0);
  assert.equal(m.signedCents({ type: 'transfer', amount: '10.00', account_id: 'a', transfer_to_account_id: 'b' }, 'a'), -1000);
  assert.equal(m.signedCents({ type: 'expense', amount: '10.00', account_id: null, is_personal_founder_payment: true }), null);
  const txs = [{ id: 't1', type: 'income', contribution_type: 'capital_contribution', participant_id: 'p1', amount: '100.00', is_reversed: false },
    { id: 't2', type: 'income', contribution_type: 'operational', participant_id: null, amount: '100.00', is_reversed: false },
    { id: 't3', type: 'income', contribution_type: 'third_party_grant', participant_id: null, amount: '100.00', is_reversed: false }];
  assert.deepEqual(m.eligibleReceipts({ participant_id: 'p1' }, txs, [{ transaction_id: 't1', amount: '40.00', is_reversed: false }]).map(x => `${x.t.id}:${x.remaining}`), ['t1:6000']);
  assert.deepEqual(m.eligibleReceipts({ participant_id: null }, txs, []).map(x => x.t.id), ['t1', 't3']);
  const dup = m.inFileDuplicateOf([{ id: 'a', row_index: 0, fingerprint: 'f' }, { id: 'b', row_index: 1, fingerprint: 'g' }, { id: 'c', row_index: 2, fingerprint: 'f' }, { id: 'd', row_index: 3, fingerprint: null }]);
  assert.deepEqual([...dup], [['c', 0]]);
});
