// Reports (M4.3): read-only reports over the module repositories. Finance figures come only from financeSnapshot()
// (the RPCs and views the Finances module uses); operational figures from reporting.js on top of projections.js.
// Each section states its scope: "for the period", "as of <date>" or "current" (views without an as-of date).
import { h, mount } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { button, pageHeader, stateBlock, chip } from '../ui/components.js';
import { select, dateInput } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { formatDate, addDays } from '../core/format.js';
import { periodPresets, resolvePeriod, projectReport, taskThroughput, overdueAt, milestoneReport, ledgerTotals, LEDGER_LINES, financeSnapshot, toCsv, csvFilename } from './reporting.js';
import { COMMITMENT_LABEL, COMMITMENT_TONE, ACCOUNT_TYPE_LABEL, ALLOCATION_LABEL } from './finance-model.js';
import { fmt, figure } from './finance-ui.js';
import { toCents, fromCents } from '../data/money.js';

const DEV = ctx => ctx.dataSource.kind === 'development';

function download(ctx, name, period, columns, rows) {
  const data = rows.map(r => ({ ...r, data_source: DEV(ctx) ? 'development (fictional)' : ctx.dataSource.kind }));
  const csv = toCsv([...columns, { key: 'data_source', label: 'Data source' }], data);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: csvFilename(name, period, DEV(ctx)) });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ctx.toast(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`);
}

const table = (head, rows, { numeric = [] } = {}) => h('div', { class: 'table-scroll' }, h('table', { class: 'fin-table' },
  h('thead', null, h('tr', null, head.map((x, i) => h('th', { scope: 'col', class: numeric.includes(i) ? 'num' : null }, x)))),
  h('tbody', null, rows.length ? rows.map(r => h('tr', null, r.map((c, i) => h(i === 0 ? 'th' : 'td', { scope: i === 0 ? 'row' : null, class: numeric.includes(i) ? 'num' : null }, c))))
    : h('tr', null, h('td', { colspan: head.length, class: 'faint' }, 'Nothing in this period.')))));

function section(title, scope, body, onExport) {
  return h('section', { class: 'fin-section rep-section' },
    h('div', { class: 'rep-head' }, h('h2', { class: 'subsection-title' }, title), h('span', { class: 'rep-scope' }, scope),
      onExport && button('CSV', { kind: 'ghost', size: 'sm', iconName: 'arrowRight', title: `Export ${title} as CSV`, onClick: onExport })),
    body);
}

// ---------- operations ----------
async function operations(ctx, period) {
  const [projects, tasks, milestones] = await Promise.all([ctx.data.projects.list(), ctx.data.tasks.list(), ctx.data.milestones.list()]);
  const tz = ctx.business.timezone, df = d => formatDate(d, ctx.profile.date_format), asOf = period.to;
  const pr = projectReport({ projects, tasks, milestones }, asOf);
  const tp = taskThroughput(tasks, period, tz, ctx.profile.week_start_day);
  const od = overdueAt({ tasks, milestones }, asOf, tz);
  const mr = milestoneReport(milestones, period, asOf, tz);
  const pname = id => projects.find(p => p.id === id)?.name ?? '';
  const live = pr.rows.filter(r => !['Archived'].includes(r.project.status));
  return [
    section('Projects', 'Current status and progress', h('div', null,
      h('div', { class: 'fig-strip' }, Object.entries(pr.byStatus).map(([s, n]) => figure(s, String(n)))),
      table(['Project', 'Status', 'Progress', 'Open tasks', 'Overdue', 'Next milestone'], live.map(r => [h('a', { class: 'link', href: `#/projects/${r.project.id}` }, r.project.name), r.project.status,
        `${r.progress.pct}% (${r.progress.done}/${r.progress.total})`, String(r.open), String(r.overdue), r.next ? `${r.next.title} · ${df(r.next.due_date)}` : '—']), { numeric: [2, 3, 4] })),
      () => download(ctx, 'projects', period, [{ key: 'name', label: 'Project' }, { key: 'status', label: 'Status' }, { key: 'pct', label: 'Progress %', kind: 'number' }, { key: 'done', label: 'Tasks done', kind: 'number' },
        { key: 'total', label: 'Tasks total', kind: 'number' }, { key: 'open', label: 'Open tasks', kind: 'number' }, { key: 'overdue', label: 'Overdue tasks', kind: 'number' }, { key: 'next', label: 'Next milestone' }, { key: 'next_due', label: 'Next milestone due' }],
        live.map(r => ({ name: r.project.name, status: r.project.status, pct: r.progress.pct, done: r.progress.done, total: r.progress.total, open: r.open, overdue: r.overdue, next: r.next?.title, next_due: r.next?.due_date })))),
    section('Task throughput', `For the period · open count at the end of ${df(asOf)}`, h('div', null,
      h('div', { class: 'fig-strip' }, figure('Created', String(tp.created)), figure('Completed', String(tp.completed), { tone: 'ok' }), figure(`Open on ${df(asOf)}`, String(tp.openAtEnd))),
      table(['Week from', 'Created', 'Completed'], tp.weeks.map(w => [df(w.from), String(w.created), String(w.completed)]), { numeric: [1, 2] })),
      () => download(ctx, 'task-throughput', period, [{ key: 'from', label: 'Week from' }, { key: 'to', label: 'Week to' }, { key: 'created', label: 'Created', kind: 'number' }, { key: 'completed', label: 'Completed', kind: 'number' }], tp.weeks)),
    section('Overdue', `As of ${df(asOf)}`, h('div', null,
      table(['Task', 'Project', 'Due', 'Priority'], od.tasks.map(t => [h('a', { class: 'link', href: `#/tasks/${t.id}` }, t.title), pname(t.project_id), df(t.due_date), t.priority])),
      h('h3', { class: 'rep-sub' }, 'Milestones past due'),
      table(['Milestone', 'Project', 'Due', 'Status now'], od.milestones.map(m => [h('a', { class: 'link', href: `#/milestones/${m.id}` }, m.title), pname(m.project_id), df(m.due_date), m.status]))),
      () => download(ctx, 'overdue', period, [{ key: 'kind', label: 'Kind' }, { key: 'title', label: 'Title' }, { key: 'project', label: 'Project' }, { key: 'due', label: 'Due' }, { key: 'status', label: 'Status' }],
        [...od.tasks.map(t => ({ kind: 'task', title: t.title, project: pname(t.project_id), due: t.due_date, status: t.status })), ...od.milestones.map(m => ({ kind: 'milestone', title: m.title, project: pname(m.project_id), due: m.due_date, status: m.status }))])),
    section('Milestones', 'Achieved in the period; delayed and cancelled are current', h('div', null,
      h('div', { class: 'fig-strip' }, figure('Achieved in period', String(mr.achieved.length), { tone: 'ok', sub: `${mr.achievedOnTime} on or before the due date` }),
        figure('Due in period', String(mr.dueInPeriod.length)), figure('Delayed or late now', String(mr.delayed.length), { tone: mr.delayed.length ? 'bad' : undefined }), figure('Cancelled', String(mr.cancelled.length))),
      table(['Achieved', 'Project', 'Due', 'Result'], mr.achieved.map(({ m, onTime }) => [m.title, pname(m.project_id), df(m.due_date), onTime ? 'On time' : 'Late']))),
      () => download(ctx, 'milestones', period, [{ key: 'title', label: 'Milestone' }, { key: 'project', label: 'Project' }, { key: 'status', label: 'Status' }, { key: 'due', label: 'Due' }, { key: 'achieved_at', label: 'Achieved at (UTC)' }],
        milestones.map(m => ({ title: m.title, project: pname(m.project_id), status: m.status, due: m.due_date, achieved_at: m.achieved_at })))),
  ];
}

// ---------- finance ----------
async function finance(ctx, period) {
  const df = d => formatDate(d, ctx.profile.date_format), cur = ctx.business.base_currency;
  const [snap, before, txs, categories, participants] = await Promise.all([financeSnapshot(ctx.data, period.to), financeSnapshot(ctx.data, addDays(period.from, -1)),
    ctx.data.transactions.list(), ctx.data.accounts.categories(), ctx.data.workspace.participants()]);
  const lt = ledgerTotals(txs, period);
  const cname = id => categories.find(c => c.id === id)?.name ?? 'Uncategorised';
  const pname = id => participants.find(p => p.id === id)?.full_name ?? '';
  const change = fromCents(toCents(snap.cash) - toCents(before.cash));
  const fr = snap.funding;
  return [
    section('Cash position', `As of ${df(period.to)} · get_available_cash, get_account_balances`, h('div', null,
      h('div', { class: 'fig-strip' }, figure(`Available cash on ${df(period.to)}`, fmt(ctx, snap.cash)), figure(`On ${df(addDays(period.from, -1))}`, fmt(ctx, before.cash)),
        figure('Change over the period', fmt(ctx, change), { tone: toCents(change) < 0 ? 'bad' : 'ok' })),
      table(['Account', 'Type', 'Balance', 'Counts as cash'], snap.balances.map(b => [b.name, ACCOUNT_TYPE_LABEL[b.account_type], fmt(ctx, b.balance), b.counts_as_available_cash ? 'Yes' : 'No']), { numeric: [2] })),
      () => download(ctx, 'cash-position', period, [{ key: 'name', label: 'Account' }, { key: 'account_type', label: 'Type' }, { key: 'balance', label: 'Balance', kind: 'money' }, { key: 'currency', label: 'Currency' }, { key: 'counts', label: 'Counts as available cash' }, { key: 'as_of', label: 'As of' }],
        snap.balances.map(b => ({ ...b, currency: cur, counts: b.counts_as_available_cash ? 'yes' : 'no', as_of: period.to })))),
    section('Income and expenses', 'For the period · ledger rows by classification, reversed rows excluded, nothing netted', h('div', null,
      table(['Line', 'Transactions', 'Amount'], LEDGER_LINES.map(([id, label]) => [label, String(lt.lines[id].count), fmt(ctx, lt.lines[id].amount)]), { numeric: [1, 2] }),
      h('p', { class: 'faint small' }, `Operational income minus operational expenses: ${fmt(ctx, lt.operationalNet)}. Capital, loans and grants are funding, not income, and are listed separately.`),
      lt.byCategory.length ? [h('h3', { class: 'rep-sub' }, 'Operational, by category'),
        table(['Category', 'Line', 'Transactions', 'Amount'], lt.byCategory.map(c => [cname(c.category_id), c.line === 'operational_income' ? 'Income' : 'Expense', String(c.count), fmt(ctx, c.amount)]), { numeric: [2, 3] })] : null),
      () => download(ctx, 'income-and-expenses', period, [{ key: 'line', label: 'Line' }, { key: 'category', label: 'Category' }, { key: 'count', label: 'Transactions', kind: 'number' }, { key: 'amount', label: 'Amount', kind: 'money' }, { key: 'currency', label: 'Currency' }],
        [...LEDGER_LINES.map(([id, label]) => ({ line: label, category: '', count: lt.lines[id].count, amount: lt.lines[id].amount, currency: cur })),
          ...lt.byCategory.map(c => ({ line: c.line === 'operational_income' ? 'Operational income' : 'Operational expenses', category: cname(c.category_id), count: c.count, amount: c.amount, currency: cur }))])),
    section('Funding: pledged, received, outstanding', 'Current · views have no as-of date', h('div', null,
      h('div', { class: 'fig-strip' }, figure('Required (not cancelled)', fmt(ctx, fr.required)), figure('Committed (pledges)', fmt(ctx, fr.committed), { sub: 'Promises, not money. Excludes revoked' }),
        figure('Received', fmt(ctx, fr.received), { tone: 'ok', sub: 'Money received and allocated' }), figure('Outstanding pledges', fmt(ctx, fr.outstanding), { tone: 'warn', sub: `${fr.pledgedOnly} with nothing received yet` })),
      table(['Requirement', 'Lifecycle', 'Required', 'Committed', 'Received', 'Outstanding', 'Not yet committed'], fr.requirements.map(r => [h('a', { class: 'link', href: `#/finances/funding/${r.requirement_id}` }, r.title), r.lifecycle,
        fmt(ctx, r.required_amount), fmt(ctx, r.committed_amount), fmt(ctx, r.received_amount), fmt(ctx, r.outstanding_commitments), fmt(ctx, r.uncommitted_gap)]), { numeric: [2, 3, 4, 5, 6] }),
      h('h3', { class: 'rep-sub' }, 'Commitments'),
      table(['Funder', 'Status', 'Committed', 'Received', 'Outstanding', 'Expected'], fr.commitments.map(c => [c.funder_name, chip(COMMITMENT_LABEL[c.status], { tone: COMMITMENT_TONE[c.status] }),
        fmt(ctx, c.committed_amount), fmt(ctx, c.received_amount), fmt(ctx, c.outstanding_amount), c.expected_payment_date ? df(c.expected_payment_date) : '—']), { numeric: [2, 3, 4] }),
      h('p', { class: 'faint small' }, `Funding receipts recorded in the ledger in this period (allocated or not): capital ${fmt(ctx, lt.lines.capital_contribution.amount)}, founder loans ${fmt(ctx, lt.lines.founder_loan.amount)}, outside funding ${fmt(ctx, fromCents(['third_party_equity', 'third_party_grant', 'third_party_loan'].reduce((x, k) => x + toCents(lt.lines[k].amount), 0)))}.`)),
      () => download(ctx, 'funding-commitments', period, [{ key: 'requirement', label: 'Requirement' }, { key: 'funder_name', label: 'Funder' }, { key: 'status', label: 'Status' }, { key: 'committed_amount', label: 'Committed (pledge)', kind: 'money' },
        { key: 'received_amount', label: 'Received', kind: 'money' }, { key: 'outstanding_amount', label: 'Outstanding', kind: 'money' }, { key: 'currency', label: 'Currency' }, { key: 'expected_payment_date', label: 'Expected payment' }],
        fr.commitments.map(c => ({ ...c, requirement: fr.requirements.find(r => r.requirement_id === c.requirement_id)?.title, currency: cur })))),
    section('Capital position and allocations', 'Current · ownership percentages are a separate record', h('div', null,
      snap.capital.structures.filter(s => s.is_current).map(s => h('div', { class: 'fig-strip' }, figure(s.title, fmt(ctx, s.agreed_capital_target), { sub: 'Agreed capital' }),
        figure('Allocated to participants', fmt(ctx, s.allocated_amount), { sub: ALLOCATION_LABEL[s.allocation_status] }), figure('Targets total', fmt(ctx, s.total_target_amount)))),
      table(['Participant', 'Equity', 'Allocated', 'Contributed', 'Commitments outstanding', 'Loans outstanding', 'Reimbursements owed'], snap.capital.contributions.map(c => [c.full_name, c.agreed_equity_percentage != null ? `${c.agreed_equity_percentage}%` : '—',
        fmt(ctx, c.capital_allocated), fmt(ctx, c.capital_contributed), fmt(ctx, c.commitments_outstanding), fmt(ctx, c.loans_outstanding), fmt(ctx, c.reimbursements_owed)]), { numeric: [1, 2, 3, 4, 5, 6] })),
      () => download(ctx, 'capital-by-participant', period, ['full_name', 'agreed_equity_percentage', 'capital_allocated', 'capital_contributed', 'commitments_outstanding', 'loans_advanced', 'loans_outstanding', 'reimbursements_owed']
        .map(k => ({ key: k, label: k.replace(/_/g, ' '), kind: k === 'full_name' ? undefined : 'money' })).concat([{ key: 'currency', label: 'currency' }]), snap.capital.contributions.map(c => ({ ...c, currency: cur })))),
    section('Owed to participants', 'Current · vw_settlement_status', table(['Item', 'Participant', 'Original', 'Settled', 'Outstanding'],
      snap.owed.settlements.map(s => [s.description, pname(s.participant_id), fmt(ctx, s.amount), fmt(ctx, s.settled_amount), fmt(ctx, s.outstanding_amount)]), { numeric: [2, 3, 4] })),
    section('Burn and runway', 'Not calculated', stateBlock('unavailable', { title: 'No approved calculation',
      body: 'Meridian has no approved definition of burn or runway (no RPC or view; README F-3, R-2), so none is shown. The operational net above is not burn: it ignores timing, accruals and funding.' })),
  ];
}

// ---------- page ----------
async function renderReports(ctx, _params, query) {
  const view = query.view === 'finance' ? 'finance' : 'operations';
  const presets = periodPresets(ctx.today, ctx.business.financial_year_start_month);
  const period = resolvePeriod({ preset: query.period || 'month', from: query.from, to: query.to }, ctx.today, ctx.business.financial_year_start_month);
  const preset = select([...presets.map(p => [p.id, p.label]), ['custom', 'Custom…']], { value: period.id, class: 'input select input-sm', aria: { label: 'Reporting period' } });
  const from = dateInput({ value: period.from, max: ctx.today, class: 'input input-date input-sm', aria: { label: 'From' } });
  const to = dateInput({ value: period.to, max: ctx.today, class: 'input input-date input-sm', aria: { label: 'To' } });
  const custom = h('span', { class: 'rep-custom', hidden: period.id !== 'custom' }, from, h('span', { class: 'faint' }, 'to'), to);
  const go = (p = {}) => ctx.navigate(`/reports?${new URLSearchParams(Object.entries({ view, period: preset.value, ...(preset.value === 'custom' ? { from: from.value, to: to.value } : {}), ...p }).filter(([, v]) => v))}`);
  preset.addEventListener('change', () => { if (preset.value === 'custom') { custom.hidden = false; } else go(); });
  [from, to].forEach(el => el.addEventListener('change', () => from.value && to.value && go()));
  const body = h('div', { class: 'fin-body' }, stateBlock('loading'));
  const tabs = h('nav', { class: 'tabs', aria: { label: 'Report' } }, [['operations', 'Operations'], ['finance', 'Finance']].map(([id, label]) =>
    h('a', { class: ['tab', id === view && 'active'], href: `#/reports?${new URLSearchParams(Object.entries({ view: id, period: period.id, ...(period.id === 'custom' ? { from: period.from, to: period.to } : {}) }))}`, aria: { current: id === view ? 'page' : undefined } }, label)));
  const draw = async () => {
    try { mount(body, ...(view === 'finance' ? await finance(ctx, period) : await operations(ctx, period))); }
    catch (e) { console.error(e); mount(body, stateBlock('error', { title: 'This report could not load', body: friendlyError(e).message })); }
  };
  await draw();
  ctx.onLeave(ctx.bus.on('data:changed', () => draw()));
  return h('div', { class: 'page page-fin' },
    pageHeader({ title: 'Reports', subtitle: 'Read-only views of the modules. Every figure comes from the same calculations the modules use.' }),
    DEV(ctx) && h('div', { class: 'banner banner-dev', role: 'note' }, icon('beaker', { size: 14 }), h('span', null, h('strong', null, 'Development data. '), 'Every figure here is fictional and is not real financial information. Exports are labelled the same way.')),
    h('div', { class: 'filter-bar rep-period' }, h('span', { class: 'field-label' }, 'Period'), preset, custom,
      h('span', { class: 'rep-range' }, `${formatDate(period.from, ctx.profile.date_format)} – ${formatDate(period.to, ctx.profile.date_format)} · ${ctx.business.base_currency} · ${ctx.business.timezone}`)),
    tabs, body);
}

export const reportsModule = { routes: [{ pattern: '/reports', render: renderReports }] };
