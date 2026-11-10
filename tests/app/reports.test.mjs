// M4.3 Reports: reporting periods and date boundaries, operational aggregates, ledger classification (hand-computed),
// CSV export, and consistency between Finance, Reports and the Command Centre (one shared financeSnapshot()).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFixtureAdapter } from '../../app/data/adapters/fixture.js';
import { buildFixtures, DEV_BUSINESS_ID, DEV_PROFILE_ID } from '../../app/data/fixtures/dev-fixtures.js';
import { createRepositories } from '../../app/data/repositories.js';
import { kpis } from '../../app/modules/projections.js';
import { periodPresets, resolvePeriod, inPeriod, taskThroughput, overdueAt, milestoneReport, ledgerTotals, financeSnapshot, toCsv, csvFilename } from '../../app/modules/reporting.js';
import { toCents } from '../../app/data/money.js';

const TODAY = '2026-11-08', TZ = 'Asia/Kolkata';
const make = () => {
  let clock = new Date('2026-11-08T06:00:00Z');
  const db = createFixtureAdapter({ seed: () => buildFixtures(TODAY), session: { business_id: DEV_BUSINESS_ID, profile_id: DEV_PROFILE_ID }, now: () => (clock = new Date(clock.getTime() + 1000)) });
  return { db, repo: createRepositories(db) };
};
const P = id => periodPresets(TODAY, 4).find(p => p.id === id);

test('periods: presets, financial-year start, month ends and leap years', () => {
  assert.deepEqual([P('month').from, P('month').to], ['2026-11-01', '2026-11-08']);
  assert.deepEqual([P('last-month').from, P('last-month').to], ['2026-10-01', '2026-10-31']);
  assert.deepEqual([P('quarter').from, P('30d').from], ['2026-10-01', '2026-10-10']);
  assert.deepEqual([P('fytd').from, P('fytd').to, P('fytd').fyEnd], ['2026-04-01', '2026-11-08', '2027-03-31']);
  assert.deepEqual([P('last-fy').from, P('last-fy').to], ['2025-04-01', '2026-03-31']);
  const jan = periodPresets('2028-01-15', 4); // January: FY started the previous April; last month crosses the year
  assert.deepEqual([jan.find(p => p.id === 'fytd').from, jan.find(p => p.id === 'last-month').from, jan.find(p => p.id === 'last-month').to], ['2027-04-01', '2027-12-01', '2027-12-31']);
  assert.equal(periodPresets('2028-03-10', 1).find(p => p.id === 'last-month').to, '2028-02-29'); // leap year
  assert.equal(periodPresets('2026-05-10', 1).find(p => p.id === 'fytd').from, '2026-01-01'); // calendar financial year
});

test('periods: custom ranges are validated and never extend past today', () => {
  assert.equal(resolvePeriod({ preset: 'custom', from: '2026-09-01', to: '2026-09-30' }, TODAY, 4).to, '2026-09-30');
  assert.equal(resolvePeriod({ preset: 'custom', from: '2026-09-01', to: '2027-01-01' }, TODAY, 4).to, TODAY);
  assert.equal(resolvePeriod({ preset: 'custom', from: '2026-10-01', to: '2026-09-01' }, TODAY, 4).id, 'month'); // inverted -> default
  assert.equal(resolvePeriod({ preset: 'custom', from: '2026-02-30', to: '2026-03-01' }, TODAY, 4).id, 'month');
  assert.equal(resolvePeriod({ preset: 'nonsense' }, TODAY, 4).id, 'month');
  assert.ok(inPeriod('2026-11-01', P('month')) && inPeriod('2026-11-08', P('month')) && !inPeriod('2026-10-31', P('month')), 'both ends inclusive');
});

test('date boundaries: timestamps count on their business-local date (Asia/Kolkata, +05:30)', () => {
  const tasks = [
    { id: 'a', status: 'Done', created_at: '2026-10-25T10:00:00Z', completed_at: '2026-10-31T18:29:59Z' }, // 31 Oct 23:59:59 IST
    { id: 'b', status: 'Done', created_at: '2026-10-25T10:00:00Z', completed_at: '2026-10-31T18:30:00Z' }, // 1 Nov 00:00 IST
    { id: 'c', status: 'Next', created_at: '2026-11-08T18:29:00Z', completed_at: null, due_date: '2026-11-05' }, // 8 Nov 23:59 IST
  ];
  const nov = taskThroughput(tasks, P('month'), TZ);
  assert.deepEqual([nov.created, nov.completed, nov.openAtEnd], [1, 1, 1]);
  const oct = taskThroughput(tasks, P('last-month'), TZ);
  assert.deepEqual([oct.created, oct.completed, oct.openAtEnd], [2, 1, 1]); // b was still open at the end of 31 Oct
  assert.equal(nov.weeks.reduce((s, w) => s + w.completed, 0), nov.completed, 'weekly buckets add up');
  assert.equal(nov.weeks[0].from, '2026-11-01', 'the first bucket is clipped to the period');
  assert.deepEqual(overdueAt({ tasks, milestones: [] }, '2026-11-06', TZ).tasks.map(t => t.id), [], 'c did not exist on 6 Nov');
});

test('operational: overdue as of today equals the Command Centre KPI; milestone achievement is dated', async () => {
  const { repo } = make();
  const [tasks, projects, milestones] = await Promise.all([repo.tasks.list(), repo.projects.list(), repo.milestones.list()]);
  const o = overdueAt({ tasks, milestones }, TODAY, TZ);
  assert.equal(o.tasks.length, kpis({ tasks, projects, milestones }, TODAY).overdue);
  const all = { id: 'all', from: '2026-01-01', to: TODAY };
  const mr = milestoneReport(milestones, all, TODAY, TZ);
  assert.equal(mr.achieved.length, milestones.filter(m => m.status === 'Achieved').length);
  assert.equal(mr.delayed.length, kpis({ tasks, projects, milestones }, TODAY).lateMilestones);
});

test('ledger: classification over the whole development history, hand-computed from the fixture list', async () => {
  const { repo } = make();
  const t = ledgerTotals(await repo.transactions.list(), { from: '2026-01-01', to: TODAY });
  const L = Object.fromEntries(Object.entries(t.lines).map(([k, v]) => [k, `${v.amount}/${v.count}`]));
  assert.deepEqual(L, {
    operational_income: '222000.00/2', // 180000 + 42000 (the duplicate invoice is reversed and never counts)
    operational_expense: '433900.00/11', // rent 4x45000, hosting 3x12500, fees 30000, contractors 120000 + 64000, courier 2400
    capital_contribution: '1000000.00/3', founder_loan: '200000.00/1', third_party_equity: '0.00/0', third_party_grant: '300000.00/1', third_party_loan: '0.00/0',
    reimbursement: '10000.00/1', loan_repayment: '50000.00/1', personal: '18500.00/1', transfer: '330000.00/3',
  });
  assert.equal(t.operationalNet, '-211900.00');
  // reconciliation to get_available_cash: opening petty cash 5000 + every in - every out, with the two transfers that cross
  // the cash boundary (90000 into escrow, 40000 drawn from credit); the reserve transfer stays inside cash
  const recon = 5000 + 222000 - 433900 + 1000000 + 200000 + 300000 - 10000 - 50000 - 90000 + 40000;
  assert.equal(toCents(await repo.accounts.availableCash(TODAY)), recon * 100);
  // a period boundary: November holds only the courier, contractor and month-4 rent expenses
  const nov = ledgerTotals(await repo.transactions.list(), P('month'));
  assert.equal(`${nov.lines.operational_expense.amount}/${nov.lines.operational_expense.count}`, '111400.00/3');
  // ...and the cash RPC agrees: November's change in available cash is exactly those three expenses
  const [end, start] = await Promise.all([financeSnapshot(repo, TODAY), financeSnapshot(repo, '2026-10-31')]);
  assert.equal(toCents(end.cash) - toCents(start.cash), -11140000);
});

test('consistency: Finance, Reports and the Command Centre read one snapshot with identical figures', async () => {
  const { repo } = make();
  for (const asOf of [TODAY, '2026-09-30', '2026-07-01']) {
    const s = await financeSnapshot(repo, asOf);
    assert.equal(s.cash, await repo.accounts.availableCash(asOf), 'same RPC as the Finances overview');
    assert.equal(toCents(s.cash), s.balances.filter(b => b.counts_as_available_cash).reduce((x, b) => x + toCents(b.balance), 0));
  }
  const s = await financeSnapshot(repo, TODAY);
  const reqs = await repo.funding.requirementSummaries();
  assert.equal(toCents(s.funding.received), reqs.reduce((x, r) => x + toCents(r.received_amount), 0), 'commitment view and requirement view agree');
  assert.equal(`${s.funding.committed}/${s.funding.received}/${s.funding.outstanding}`, '1700000.00/1300000.00/400000.00', 'pledged, received and outstanding stay separate');
  assert.equal(s.owed.total, '158500.00'); // loan 150000 + reimbursable 8500
  // both screens take their finance figures from financeSnapshot() and nowhere else
  for (const f of ['app/modules/command.js', 'app/modules/reports.js']) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.ok(src.includes('financeSnapshot('), `${f} uses financeSnapshot`);
    assert.ok(!/\.availableCash\(|\.balances\(|\.rpc\(/.test(src), `${f} does not call the cash RPCs on its own`);
  }
});

test('csv: quoting, formula-injection guard, plain money with currency, development file name', () => {
  const cols = [{ key: 'd', label: 'Description' }, { key: 'a', label: 'Amount', kind: 'money' }, { key: 'c', label: 'Currency' }];
  const csv = toCsv(cols, [{ d: 'Rent, "studio"', a: '-45000.00', c: 'INR' }, { d: '=HYPERLINK("x")', a: '10.00', c: 'INR' }, { d: null, a: '0.00', c: 'INR' }]);
  assert.equal(csv, 'Description,Amount,Currency\r\n"Rent, ""studio""",-45000.00,INR\r\n"\'=HYPERLINK(""x"")",10.00,INR\r\n,0.00,INR\r\n');
  assert.equal(csvFilename('cash-position', { from: '2026-11-01', to: '2026-11-08' }, true), 'meridian-DEVELOPMENT-fictional-cash-position-2026-11-01_to_2026-11-08.csv');
});
