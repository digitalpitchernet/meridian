// Settings participant management: add, remove where safe, deactivate where history depends on the participant.
// participants is referenced ON DELETE RESTRICT by transactions, funding_commitments and participant_capital_allocations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFixtureAdapter, DataError } from '../../app/data/adapters/fixture.js';
import { buildFixtures, DEV_BUSINESS_ID, DEV_PROFILE_ID } from '../../app/data/fixtures/dev-fixtures.js';
import { createRepositories } from '../../app/data/repositories.js';

const TODAY = '2026-11-08';
const make = () => {
  let clock = new Date('2026-11-08T06:00:00Z');
  const db = createFixtureAdapter({ seed: () => buildFixtures(TODAY), session: { business_id: DEV_BUSINESS_ID, profile_id: DEV_PROFILE_ID }, now: () => (clock = new Date(clock.getTime() + 1000)) });
  return { db, repo: createRepositories(db) };
};
const code = async (p, c) => { await assert.rejects(p, e => e instanceof DataError && e.code === c, `expected SQLSTATE ${c}`); };
const byName = async (repo, name) => (await repo.workspace.participants()).find(p => p.full_name === name);
// every financial figure that mentions participants, as one comparable string
const history = async (repo, db, except = null) => JSON.stringify({
  tx: (await db.select('transactions')).map(t => [t.id, t.participant_id, t.amount, t.is_reversed]),
  commitments: await repo.funding.commitments(), allocations: await repo.capital.allocations(),
  contributions: (await repo.transactions.contributions()).filter(c => c.participant_id !== except), settlements: await repo.transactions.settlements(), cash: await repo.accounts.availableCash(),
});

test('participants: add with the schema defaults; equity is NOT NULL and 0–100', async () => {
  const { repo } = make();
  const p = await repo.workspace.createParticipant({ full_name: 'Imogen Achterberg', participant_type: 'advisor' });
  assert.equal(`${p.agreed_equity_percentage}/${p.is_active}`, '0.00/true');
  await code(repo.workspace.createParticipant({ full_name: 'Too much', participant_type: 'investor', agreed_equity_percentage: '100.5' }), '23514');
  await code(repo.workspace.createParticipant({ full_name: 'Null equity', participant_type: 'investor', agreed_equity_percentage: null }), '23502');
  await code(repo.workspace.createParticipant({ full_name: ' ', participant_type: 'investor' }), '23514');
});

test('participants: one with no financial records is removable, and removing them changes nothing else', async () => {
  const { repo, db } = make();
  const p = await repo.workspace.createParticipant({ full_name: 'Tobias Rennick', participant_type: 'advisor', agreed_equity_percentage: '1.5' });
  assert.deepEqual(await repo.workspace.participantUsage(p.id), { transactions: 0, commitments: 0, capitalAllocations: 0, total: 0 });
  const before = await history(repo, db, p.id);
  assert.equal(p.agreed_equity_percentage, '1.50', 'numeric(5,2)');
  assert.equal(await repo.workspace.removeParticipant(p.id), true);
  assert.equal(await byName(repo, 'Tobias Rennick'), undefined);
  assert.equal(await history(repo, db, p.id), before);
});

test('participants: anyone in the financial history cannot be deleted (23503) and every record stays intact', async () => {
  const { repo, db } = make();
  const rohan = await byName(repo, 'Rohan Mehra');
  const usage = await repo.workspace.participantUsage(rohan.id);
  assert.deepEqual(usage, { transactions: 2, commitments: 1, capitalAllocations: 1, total: 4 });
  const before = await history(repo, db);
  await code(repo.workspace.removeParticipant(rohan.id), '23503');
  assert.ok(await byName(repo, 'Rohan Mehra'), 'still there');
  assert.equal(await history(repo, db), before, 'the refused delete changed nothing (statement rolled back)');
});

test('participants: a reversed transaction alone still blocks deletion; history is history', async () => {
  const { repo } = make();
  const p = await repo.workspace.createParticipant({ full_name: 'Wilhelmina Oduya', participant_type: 'investor' });
  const [ops] = (await repo.accounts.list()).filter(a => a.name === 'Operating account');
  const t = await repo.transactions.create({ account_id: ops.id, participant_id: p.id, transaction_date: TODAY, amount: '1000', type: 'income', contribution_type: 'capital_contribution', description: 'Capital (entered in error)' });
  await repo.transactions.reverse(t.id, 'Entered against the wrong person');
  assert.equal((await repo.workspace.participantUsage(p.id)).transactions, 1);
  await code(repo.workspace.removeParticipant(p.id), '23503');
});

test('participants: deactivation keeps every record, can be undone, and a deactivated lender can still be repaid', async () => {
  const { repo, db } = make();
  const rohan = await byName(repo, 'Rohan Mehra');
  const before = await history(repo, db);
  assert.equal((await repo.workspace.setParticipantActive(rohan.id, false)).is_active, false);
  assert.equal(await history(repo, db), before, 'deactivation touches no financial record');
  assert.equal((await repo.workspace.setParticipantActive(rohan.id, true)).is_active, true);

  const lender = await repo.workspace.createParticipant({ full_name: 'Bartholomew Quint-Adeyemi', participant_type: 'lender' });
  const [ops] = (await repo.accounts.list()).filter(a => a.name === 'Operating account');
  const loan = await repo.transactions.create({ account_id: ops.id, participant_id: lender.id, transaction_date: TODAY, amount: '50000', type: 'income', contribution_type: 'founder_loan', description: 'Bridge loan' });
  await repo.workspace.setParticipantActive(lender.id, false);
  await repo.transactions.create({ account_id: ops.id, participant_id: lender.id, settles_transaction_id: loan.id, transaction_date: TODAY, amount: '20000', type: 'expense', contribution_type: 'loan_repayment', description: 'Bridge loan repayment' });
  const s = (await repo.transactions.settlements()).find(x => x.transaction_id === loan.id);
  assert.equal(`${s.settled_amount}/${s.outstanding_amount}`, '20000.00/30000.00');
});

test('participants: the account owner is identifiable (profile_id) for the app rule that protects it', async () => {
  const { repo } = make();
  const owner = (await repo.workspace.participants()).filter(p => p.profile_id === DEV_PROFILE_ID);
  assert.equal(owner.length, 1);
  assert.equal(owner[0].full_name, 'Asha Varma');
});

test('sidebar: the account section is width-constrained (regression guard for long founder names)', () => {
  const css = readFileSync(new URL('../../app/styles/shell.css', import.meta.url), 'utf8');
  assert.match(css, /\.sidebar-foot \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.me \{[^}]*min-width: 0/);
  assert.match(css, /\.me-text \{[^}]*min-width: 0/);
  assert.match(css, /\.me-name \{[^}]*text-overflow: ellipsis/);
  assert.match(css, /\.me > \.avatar, \.me > \.seg \{ flex: none; \}/);
  const shell = readFileSync(new URL('../../app/shell/shell.js', import.meta.url), 'utf8');
  assert.match(shell, /class: 'me-text', title:/, 'the full name is available as a tooltip');
});
