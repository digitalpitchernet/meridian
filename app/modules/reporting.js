// Reporting calculations shared by Reports (M4.3) and the Command Centre. Two kinds:
//  1. Finance figures are NOT computed here: financeSnapshot() reads the same RPCs and views the Finances module uses
//     (get_available_cash, get_account_balances, vw_funding_*, vw_settlement_status, vw_capital_*, vw_participant_*).
//  2. Operational and ledger aggregates over a reporting period, built on projections.js. ledgerTotals() is the one
//     app-level money aggregation: no approved view sums income/expenses for a period (README R-1); it only adds up
//     non-reversed ledger rows by classification and never nets them.
// Periods are inclusive business-local dates [from, to]; timestamps are converted with the business time zone.
import { addDays, utcToZoned, startOfWeek } from '../core/format.js';
import { toCents, fromCents } from '../data/money.js';
import { isOpen, milestoneOpen, projectProgress } from './projections.js';

// ---------------- periods ----------------
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const monthStart = (y, m) => { while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return [y, m]; };

export function periodPresets(today, fyStartMonth = 4) {
  const [y, m] = today.split('-').map(Number);
  const [ly, lm] = monthStart(y, m - 1);
  const q0 = m - ((m - 1) % 3);
  const fyY = m >= fyStartMonth ? y : y - 1;
  const [fyEndY, fyEndM] = monthStart(fyY + 1, fyStartMonth - 1);
  const [pfyEndY, pfyEndM] = monthStart(fyY, fyStartMonth - 1);
  return [
    { id: 'month', label: 'This month', from: iso(y, m, 1), to: today },
    { id: 'last-month', label: 'Last month', from: iso(ly, lm, 1), to: iso(ly, lm, lastDay(ly, lm)) },
    { id: 'quarter', label: 'This quarter', from: iso(y, q0, 1), to: today },
    { id: '30d', label: 'Last 30 days', from: addDays(today, -29), to: today },
    { id: 'fytd', label: `Financial year to date (FY ${fyY}–${String(fyEndY).slice(2)})`, from: iso(fyY, fyStartMonth, 1), to: today, fyEnd: iso(fyEndY, fyEndM, lastDay(fyEndY, fyEndM)) },
    { id: 'last-fy', label: `Last financial year (FY ${fyY - 1}–${String(fyY).slice(2)})`, from: iso(fyY - 1, fyStartMonth, 1), to: iso(pfyEndY, pfyEndM, lastDay(pfyEndY, pfyEndM)) },
  ];
}

export function resolvePeriod({ preset, from, to }, today, fyStartMonth) {
  const presets = periodPresets(today, fyStartMonth);
  // round-trip check: Date accepts 2026-02-30 and rolls it over to 2 March
  const valid = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  if (preset === 'custom' && valid(from) && valid(to) && from <= to) return { id: 'custom', label: 'Custom period', from, to: to > today ? today : to };
  return presets.find(p => p.id === preset) ?? presets[0];
}

const localDate = (ts, tz) => (ts ? utcToZoned(ts, tz).date : null);
export const inPeriod = (date, p) => date != null && date >= p.from && date <= p.to;

// ---------------- operational ----------------
// a task was open at the end of asOf if it existed by then and was not completed by then
const openAt = (t, asOf, tz) => localDate(t.created_at, tz) <= asOf && (t.completed_at ? localDate(t.completed_at, tz) > asOf : isOpen(t));

export function projectReport({ projects, tasks, milestones }, asOf) {
  const rows = projects.map(p => {
    const pt = tasks.filter(t => t.project_id === p.id);
    const next = milestones.filter(m => m.project_id === p.id && milestoneOpen(m)).sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null;
    return { project: p, progress: projectProgress(pt), open: pt.filter(isOpen).length, overdue: pt.filter(t => isOpen(t) && t.due_date && t.due_date < asOf).length, next };
  });
  const byStatus = {};
  for (const p of projects) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  return { rows, byStatus };
}

// created / completed in the period, with weekly buckets (profile week start) and the open count at the period end
export function taskThroughput(tasks, period, tz, weekStart = 'Monday') {
  const created = tasks.filter(t => inPeriod(localDate(t.created_at, tz), period));
  const completed = tasks.filter(t => inPeriod(localDate(t.completed_at, tz), period));
  const weeks = [];
  for (let w = startOfWeek(period.from, weekStart); w <= period.to; w = addDays(w, 7)) {
    const wp = { from: w < period.from ? period.from : w, to: addDays(w, 6) > period.to ? period.to : addDays(w, 6) };
    weeks.push({ week: w, from: wp.from, to: wp.to, created: created.filter(t => inPeriod(localDate(t.created_at, tz), wp)).length, completed: completed.filter(t => inPeriod(localDate(t.completed_at, tz), wp)).length });
  }
  const openAtEnd = tasks.filter(t => openAt(t, period.to, tz)).length;
  return { created: created.length, completed: completed.length, openAtEnd, weeks };
}

// overdue as of a date: open at the end of that day with a due date before it. For asOf = today this is exactly kpis().overdue.
export function overdueAt({ tasks, milestones }, asOf, tz) {
  const t = tasks.filter(x => x.due_date && x.due_date < asOf && openAt(x, asOf, tz)).sort((a, b) => a.due_date.localeCompare(b.due_date));
  // milestones: achieved_at is the only dated status change in the schema; other statuses are current state
  const m = milestones.filter(x => x.due_date < asOf && x.status !== 'Cancelled' && (x.status === 'Achieved' ? localDate(x.achieved_at, tz) > asOf : true))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  return { tasks: t, milestones: m };
}

export function milestoneReport(milestones, period, asOf, tz) {
  const achieved = milestones.filter(m => m.status === 'Achieved' && inPeriod(localDate(m.achieved_at, tz), period))
    .map(m => ({ m, onTime: localDate(m.achieved_at, tz) <= m.due_date }));
  return {
    achieved, achievedOnTime: achieved.filter(a => a.onTime).length,
    dueInPeriod: milestones.filter(m => inPeriod(m.due_date, period) && m.status !== 'Cancelled'),
    delayed: milestones.filter(m => m.status === 'Delayed' || (milestoneOpen(m) && m.due_date < asOf)),
    cancelled: milestones.filter(m => m.status === 'Cancelled'),
  };
}

// ---------------- ledger classification over a period (README R-1) ----------------
export const LEDGER_LINES = [
  ['operational_income', 'Operational income', 'in'], ['operational_expense', 'Operational expenses', 'out'],
  ['capital_contribution', 'Capital contributions received', 'in'], ['founder_loan', 'Founder loans received', 'in'],
  ['third_party_equity', 'Outside equity received', 'in'], ['third_party_grant', 'Grants received', 'in'], ['third_party_loan', 'Outside loans received', 'in'],
  ['reimbursement', 'Reimbursements paid', 'out'], ['loan_repayment', 'Loan repayments paid', 'out'],
  ['personal', 'Paid personally by participants (no business cash moved)', 'none'], ['transfer', 'Transfers between accounts (cash-neutral overall)', 'none'],
];
export function ledgerLine(t) {
  if (t.type === 'transfer') return 'transfer';
  if (t.is_personal_founder_payment) return 'personal';
  if (t.contribution_type === 'operational') return t.type === 'income' ? 'operational_income' : 'operational_expense';
  return t.contribution_type;
}
// reversed rows never count, at any date (same rule as get_available_cash; register A12)
export function ledgerTotals(transactions, period) {
  const lines = Object.fromEntries(LEDGER_LINES.map(([id]) => [id, { cents: 0, count: 0 }]));
  const byCategory = new Map();
  for (const t of transactions) {
    if (t.is_reversed || !inPeriod(t.transaction_date, period)) continue;
    const id = ledgerLine(t);
    lines[id].cents += toCents(t.amount); lines[id].count++;
    if (id === 'operational_income' || id === 'operational_expense') {
      const k = `${id}|${t.category_id ?? ''}`;
      const c = byCategory.get(k) ?? { line: id, category_id: t.category_id ?? null, cents: 0, count: 0 };
      c.cents += toCents(t.amount); c.count++; byCategory.set(k, c);
    }
  }
  const out = Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, { amount: fromCents(v.cents), count: v.count }]));
  return { lines: out, byCategory: [...byCategory.values()].map(c => ({ ...c, amount: fromCents(c.cents) })),
    operationalNet: fromCents(lines.operational_income.cents - lines.operational_expense.cents) };
}

// ---------------- finance snapshot: the single loader used by Reports and the Command Centre ----------------
// cash and balances are as of `asOf` (RPCs); funding, settlement and capital views have no as-of date: they are current.
export async function financeSnapshot(data, asOf) {
  const [cash, balances, requirements, commitments, settlements, structures, targets, contributions] = await Promise.all([
    data.accounts.availableCash(asOf), data.accounts.balances(asOf), data.funding.requirementSummaries(), data.funding.commitments(),
    data.transactions.settlements(), data.capital.structureSummaries(), data.capital.targetSummaries(), data.transactions.contributions()]);
  const sum = (list, f) => fromCents(list.reduce((s, x) => s + toCents(f(x)), 0));
  const live = commitments.filter(c => c.status !== 'revoked');
  return {
    asOf, cash, balances,
    funding: {
      requirements, commitments,
      required: sum(requirements.filter(r => r.lifecycle !== 'cancelled'), r => r.required_amount),
      committed: sum(live, c => c.committed_amount), // pledges: promises, not money
      received: sum(commitments, c => c.received_amount), // money actually received and allocated to commitments
      outstanding: sum(commitments, c => c.outstanding_amount), // committed but not yet received
      pledgedOnly: live.filter(c => c.status === 'pledged').length,
      revoked: commitments.filter(c => c.status === 'revoked').length,
    },
    owed: { settlements: settlements.filter(s => toCents(s.outstanding_amount) > 0), total: sum(settlements, s => s.outstanding_amount) },
    capital: { structures, targets, contributions },
  };
}

// ---------------- CSV ----------------
// RFC 4180 quoting; text cells that a spreadsheet would evaluate as a formula are prefixed with ' (CSV injection);
// money is written as plain 2-decimal numeric text with a separate currency column, never a formatted string.
const FORMULA = /^[=+\-@\t\r]/;
export function toCsv(columns, rows) {
  const cell = (v, kind) => {
    if (v == null) return '';
    let s = String(v);
    if (kind !== 'money' && kind !== 'number' && FORMULA.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(c => cell(c.label)).join(','), ...rows.map(r => columns.map(c => cell(r[c.key], c.kind)).join(','))].join('\r\n') + '\r\n';
}
export const csvFilename = (report, period, devData) => `meridian-${devData ? 'DEVELOPMENT-fictional-' : ''}${report}-${period.from}_to_${period.to}.csv`;
