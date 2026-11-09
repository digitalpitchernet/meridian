// Command Centre: the founder's operational view. It is a projection of module data (projections.js) and stores
// nothing of its own. Composition follows profiles.widget_layout (schema default:
// kpi, attention, projects, finance, funding, schedule, activity) and honours its 'hidden' list.
// FO-VIS-CC-001 interpretations are flagged in app/README.md.
import { h, mount } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { button, stateBlock } from '../ui/components.js';
import { TASK_STATUS, MILESTONE_STATUS, statusIcon, priorityIcon } from '../ui/status.js';
import { formatShortDate, relativeDay, formatTime, timeAgo, addDays, daysBetween, formatCount } from '../core/format.js';
import { kpis, attention, activeProjects, schedule, describeActivity } from './projections.js';
import { statusButton, dueLabel, openTaskPanel } from './tasks.js';
import { financeSnapshot } from './reporting.js';
import { fmt, bar } from './finance-ui.js';
import { toCents } from '../data/money.js';

const STALE_MS = 5 * 60 * 1000;
const SPAN = { kpi: 7, attention: 5, projects: 12, finance: 6, funding: 6, schedule: 8, activity: 4 };
// surface level per widget: one signature surface, matte for dense lists, glass for the contextual feed
const SURFACE = { kpi: 'card card-sig', attention: 'card card-matte', projects: 'cc-bare', finance: 'card card-matte', funding: 'card', schedule: 'card card-matte', activity: 'card card-glass' };
const TITLE = { attention: 'Needs attention', projects: 'Active projects', finance: 'Financial position', funding: 'Funding & commitments', schedule: 'Next 14 days', activity: 'Recent activity' };
const LINK = { attention: ['#/tasks', 'All tasks'], projects: ['#/projects', 'All projects'], finance: ['#/finances', 'Finances'], funding: ['#/finances', 'Finances'], schedule: ['#/calendar', 'Calendar'] };

async function loadAll(ctx) {
  const today = ctx.today;
  const [tasks, projects, milestones, events, activity, decisions] = await Promise.all([
    ctx.data.tasks.list(), ctx.data.projects.list(), ctx.data.milestones.list(),
    ctx.data.calendar.between(new Date(`${today}T00:00:00Z`).toISOString(), new Date(`${addDays(today, 16)}T00:00:00Z`).toISOString()),
    ctx.data.activity.recent(8), ctx.data.decisions.list()]);
  // finance failures must not take the other panels down: they render their own error state
  const finance = await financeSnapshot(ctx.data, today).catch(e => { console.error(e); return null; });
  return { today, tasks, projects, milestones, events, activity, decisions, finance };
}

function panel(id, body, { meta } = {}) {
  const link = LINK[id];
  return h('section', { class: ['cc-panel', `cc-${id}`, SURFACE[id] || 'card'], style: { '--span': String(SPAN[id] || 6) }, aria: { labelledby: `cc-h-${id}` } },
    id !== 'kpi' && h('header', { class: 'cc-head' },
      h('h2', { class: 'cc-title', id: `cc-h-${id}` }, TITLE[id]), meta && h('span', { class: 'cc-meta' }, meta),
      link && h('a', { class: 'cc-link', href: link[0] }, link[1], icon('arrowRight', { size: 12 }))),
    h('div', { class: 'cc-body' }, body));
}

// ---------- widgets ----------
function kpiStrip(ctx, d) {
  const k = kpis(d, d.today);
  const dev = ctx.dataSource.kind === 'development';
  const cell = (label, value, { tone, sub, href } = {}) => h(href ? 'a' : 'div', { class: ['kpi', tone && `kpi-${tone}`], href },
    h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-value num' }, value), h('span', { class: 'kpi-sub' }, sub || ''));
  return h('div', { class: 'pulse' },
    h('div', { class: 'pulse-head' }, h('h2', { class: 'pulse-title', id: 'cc-h-kpi' }, 'Business pulse'),
      dev && h('span', { class: 'pulse-dev' }, 'Development data · fictional')),
    d.finance ? cashHero(ctx, d.finance, dev)
      : h('div', { class: 'pulse-cash kpi-off' }, h('span', { class: 'pulse-label' }, 'Available cash'), h('span', { class: 'kpi-na' }, 'Unavailable')),
    h('div', { class: 'kpi-strip' },
      cell('Open tasks', formatCount(k.openTasks, ctx.profile.number_format), { href: '#/tasks' }),
      cell('Due today', String(k.dueToday), { tone: k.dueToday ? 'warn' : null, href: '#/tasks' }),
      cell('Overdue', String(k.overdue), { tone: k.overdue ? 'bad' : 'ok', sub: k.overdue ? 'needs a decision' : 'all clear', href: '#/tasks' }),
      cell('Active projects', String(k.activeProjects), { href: '#/projects?view=Active' }),
      cell('Milestones · 14 days', String(k.milestonesNext14), { tone: k.lateMilestones ? 'late' : null, sub: k.lateMilestones ? `${k.lateMilestones} late` : null })),
    h('p', { class: 'pulse-note' }, 'Burn and runway · not calculated — no approved calculation yet'));
}

// Available cash with its make-up by counted account. The shares are presentation only (founder-approved, Nov 2026):
// each positive counted balance over the sum of positive counted balances; the cash figure itself comes from financeSnapshot.
function cashHero(ctx, f, dev) {
  const counted = f.balances.filter(b => b.counts_as_available_cash);
  const parts = counted.filter(b => toCents(b.balance) > 0); // shortcut: a negative counted balance is left out of the bar, not netted
  const total = parts.reduce((sum, b) => sum + toCents(b.balance), 0);
  const share = b => total ? `${(toCents(b.balance) / total * 100).toFixed(1)}%` : '—';
  const notCounted = f.balances.filter(b => !b.counts_as_available_cash);
  return h('div', { class: 'pulse-cash' },
    h('span', { class: 'pulse-label' }, 'Available cash'),
    h('span', { class: 'pulse-cash-value num' }, fmt(ctx, f.cash)),
    h('span', { class: 'pulse-sub' }, `${dev ? 'fictional · today' : 'today'} · ${counted.length} bank and cash account${counted.length === 1 ? '' : 's'} counted`),
    parts.length > 0 && h('div', { class: 'meter pulse-meter', role: 'img', aria: { label: `Available cash by account: ${parts.map(b => `${b.name} ${share(b)}`).join(', ')}` } },
      parts.map((b, i) => h('span', { class: `pm-${i % 4}`, style: { '--grow': String(toCents(b.balance)) } }))),
    parts.length > 0 && h('ul', { class: 'pulse-legend' }, parts.map((b, i) => h('li', null,
      h('span', { class: 'pulse-legend-name' }, h('span', { class: `legend-dot pm-${i % 4}`, aria: { hidden: 'true' } }), h('span', { class: 'ellipsis' }, b.name)),
      h('span', { class: 'num pulse-legend-amt' }, fmt(ctx, b.balance)), h('span', { class: 'num pulse-legend-share' }, share(b))))),
    notCounted.length > 0 && h('p', { class: 'pulse-sub' }, `Not counted: ${notCounted.map(b => `${b.name} ${fmt(ctx, b.balance)}`).join(' · ')}`));
}

function attentionList(ctx, d) {
  const { items, total } = attention(d, d.today, 8);
  if (!items.length) return stateBlock('empty', { title: 'Nothing is overdue or due today', body: 'Late milestones, decisions due for review and critical work without a date would show here too.' });
  // severity drives only the row marker and the summary bar; titles stay neutral so a long list does not shout
  const sev = it => it.decision ? 'warn' : it.kind === 'today' ? 'info' : 'bad';
  const count = kind => items.filter(it => it.kind === kind).length;
  const summary = [[count('overdue'), 'overdue task', 'overdue tasks'], [count('critical'), 'critical without a date', 'critical without a date'],
    [count('milestone'), 'late milestone', 'late milestones'], [count('review'), 'review due', 'reviews due'], [count('today'), 'due today', 'due today']]
    .filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(' · ');
  const tally = { bad: items.filter(it => sev(it) === 'bad').length, warn: items.filter(it => sev(it) === 'warn').length, info: items.filter(it => sev(it) === 'info').length };
  const rows = items.map(it => {
    if (it.decision) {
      const d = it.decision;
      return h('div', { class: 'att-row sev-warn' }, h('span', { class: 'att-icon fg-warn' }, icon('decision', { size: 15 })),
        h('a', { class: 'att-main', href: `#/decisions/${d.id}` }, h('span', { class: 'att-title' }, d.title), h('span', { class: 'att-sub' }, ['Decision review', it.project].filter(Boolean).join(' · '))),
        h('span', { class: 'att-when fg-warn num' }, it.days ? `review ${it.days}d overdue` : 'review today'));
    }
    if (it.milestone) {
      const m = it.milestone;
      return h('div', { class: 'att-row sev-bad' }, h('span', { class: 'att-icon fg-bad' }, icon('flag', { size: 15 })),
        h('a', { class: 'att-main', href: `#/projects/${m.project_id}` }, h('span', { class: 'att-title' }, m.title), h('span', { class: 'att-sub' }, `Milestone · ${it.project ?? ''}`)),
        h('span', { class: 'att-when fg-bad num' }, it.days ? `${it.days}d late` : 'due today'), statusIcon(MILESTONE_STATUS, m.status, 14));
    }
    const t = it.task;
    return h('div', { class: ['att-row', `sev-${sev(it)}`] }, statusButton(ctx, t),
      h('button', { type: 'button', class: 'att-main', onclick: () => openTaskPanel(ctx, t.id) },
        h('span', { class: 'att-title' }, t.title), h('span', { class: 'att-sub' }, [it.kind === 'critical' ? 'Critical · no due date' : t.status, it.project].filter(Boolean).join(' · '))),
      it.kind === 'critical' ? h('span', { class: 'att-when fg-bad' }, 'set a date') : dueLabel(ctx, t.due_date), priorityIcon(t.priority, 14));
  });
  return [h('div', { class: 'att-summary' },
      h('div', { class: 'meter att-meter', role: 'img', aria: { label: summary } },
        ['bad', 'warn', 'info'].filter(t => tally[t]).map(t => h('span', { class: `seg-${t}`, style: { '--grow': String(tally[t]) } }))),
      h('p', { class: 'att-summary-text' }, summary)),
    h('div', { class: 'att-list' }, rows), total > items.length && h('a', { class: 'cc-more', href: '#/tasks' }, `${total - items.length} more`)];
}

function projectsList(ctx, d) {
  const rows = activeProjects(d, d.today);
  if (!rows.length) return stateBlock('empty', { title: 'No active projects', action: h('a', { class: 'link', href: '#/projects' }, 'Open projects') });
  const countdowns = ctx.profile.countdown_preferences?.show_milestone_countdowns !== false;
  const short = date => formatShortDate(date, d.today, ctx.profile.date_format);
  return h('div', { class: 'proj-cards' }, rows.map(r => {
    const { project: p, progress, next } = r;
    const n = next ? daysBetween(d.today, next.due_date) : null;
    // the date track places today between start and target; presentation only (founder-approved, Nov 2026)
    const span = p.start_date && p.target_date ? daysBetween(p.start_date, p.target_date) : 0;
    const at = span > 0 ? Math.min(100, Math.max(0, daysBetween(p.start_date, d.today) / span * 100)) : null;
    const left = p.target_date ? daysBetween(d.today, p.target_date) : null;
    return h('a', { class: 'proj-card card', href: `#/projects/${p.id}` },
      h('div', { class: 'proj-card-top' },
        h('div', { class: 'ring-wrap' }, h('span', { class: 'ring', style: { '--pct': String(progress.pct) }, role: 'img', aria: { label: `${progress.pct}% of tasks done` } }),
          h('span', { class: 'ring-label num', aria: { hidden: 'true' } }, `${progress.pct}%`)),
        h('div', { class: 'proj-card-id' },
          h('span', { class: 'proj-name' }, p.name, priorityIcon(p.priority, 14)),
          h('span', { class: 'proj-meta num' }, `${progress.done} of ${progress.total} tasks done · ${r.openTasks} open`, r.overdue ? h('span', { class: 'fg-bad' }, ` · ${r.overdue} overdue`) : null))),
      next ? h('div', { class: ['proj-next', r.nextLate && 'is-late'] }, icon('flag', { size: 13 }), h('span', { class: 'ellipsis' }, `${next.title} · ${short(next.due_date)}`),
        countdowns && h('span', { class: 'proj-next-when num' }, n < 0 ? `${-n}d late` : n === 0 ? 'today' : `in ${n}d`))
        : h('div', { class: 'proj-next' }, h('span', { class: 'faint' }, 'No open milestones')),
      at !== null && h('div', { class: 'proj-track' },
        h('div', { class: 'proj-track-bar', aria: { hidden: 'true' } }, h('span', { class: 'proj-track-today', style: { '--at': `${at}%` } })),
        h('div', { class: 'proj-track-labels num' }, h('span', null, short(p.start_date)), h('span', null, 'today'),
          h('span', null, `${short(p.target_date)} · ${left >= 0 ? `${left}d left` : `${-left}d past target`}`))));
  }));
}

// Finance panels: the same financeSnapshot() as Reports (as of business-local today), so both show identical figures.
function financePanel(ctx, d) {
  const s = d.finance;
  if (!s) return stateBlock('error', { title: 'Finances could not load' });
  const counted = s.balances.filter(b => b.counts_as_available_cash);
  return h('div', { class: 'ccf' },
    h('div', { class: 'ccf-hero' }, h('span', { class: 'fig-label' }, 'Available cash today'), h('span', { class: 'ccf-cash num' }, fmt(ctx, s.cash)),
      h('span', { class: 'fig-sub' }, `${counted.length} bank and cash account${counted.length === 1 ? '' : 's'}; credit and escrow not counted`)),
    h('ul', { class: 'ccf-list' }, s.balances.map(b => h('li', { class: !b.counts_as_available_cash && 'is-uncounted' }, h('span', { class: 'ellipsis' }, b.name),
      !b.counts_as_available_cash && h('span', { class: 'ccf-tag' }, 'not counted'), h('span', { class: 'num' }, fmt(ctx, b.balance))))),
    toCents(s.owed.total) > 0 && h('a', { class: 'ccf-owed', href: '#/finances' }, h('span', null, 'Owed to participants'), h('span', { class: 'num fg-warn' }, fmt(ctx, s.owed.total))),
    h('p', { class: 'faint small' }, 'Burn and runway: no approved calculation yet.'));
}

function fundingPanel(ctx, d) {
  const f = d.finance?.funding;
  if (!f) return stateBlock('error', { title: 'Funding could not load' });
  const reqs = f.requirements.filter(r => r.lifecycle === 'open' || r.lifecycle === 'draft');
  return h('div', { class: 'ccf' },
    h('div', { class: 'meter ccf-meter', role: 'img', aria: { label: `Committed ${fmt(ctx, f.committed)}: ${fmt(ctx, f.received)} received, ${fmt(ctx, f.outstanding)} outstanding` } },
      h('span', { class: 'seg-ok', style: { '--grow': String(toCents(f.received)) } }), h('span', { class: 'seg-hatch', style: { '--grow': String(toCents(f.outstanding)) } })),
    h('div', { class: 'ccf-trio' }, [['Committed', f.committed, 'pledges, not money'], ['Received', f.received, 'cash allocated'], ['Outstanding', f.outstanding, 'still pledged']].map(([l, v, sub]) =>
      h('div', null, h('span', { class: 'fig-label' }, l), h('span', { class: 'num ccf-mid' }, fmt(ctx, v)), h('span', { class: 'fig-sub' }, sub)))),
    reqs.length ? h('ul', { class: 'ccf-reqs' }, reqs.map(r => h('li', null, h('a', { class: 'ccf-req', href: `#/finances/funding/${r.requirement_id}` }, h('span', { class: 'ellipsis' }, r.title),
      h('span', { class: 'num faint small' }, `${fmt(ctx, r.received_amount)} of ${fmt(ctx, r.required_amount)}`)), bar(r.received_amount, r.required_amount, { tone: 'ok' }))))
      : stateBlock('empty', { title: 'No open funding requirements' }),
    h('p', { class: 'ccf-note' }, 'A pledge is not money. Only received amounts reach an account.'));
}

function scheduleList(ctx, d) {
  const days = schedule({ events: d.events, tasks: d.tasks, milestones: d.milestones, projects: d.projects, decisions: d.decisions }, d.today, ctx.business.timezone, 14);
  if (!days.length) return stateBlock('empty', { title: 'Nothing scheduled in the next 14 days' });
  const dayLabel = date => relativeDay(date, d.today) === 'Today' || relativeDay(date, d.today) === 'Tomorrow' ? relativeDay(date, d.today)
    : new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) + ' ' + formatShortDate(date, d.today, ctx.profile.date_format);
  const dow = date => new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const strip = h('div', { class: 'day-strip', aria: { hidden: 'true' } }, Array.from({ length: 14 }, (_, i) => {
    const date = addDays(d.today, i), items = days.find(x => x.date === date)?.items ?? [];
    return h('div', { class: ['day-cell', i === 0 && 'is-today'] }, h('span', { class: 'day-dow' }, dow(date)), h('span', { class: 'day-num num' }, String(Number(date.slice(8)))),
      h('span', { class: 'day-dots' }, items.slice(0, 4).map(it => h('i', { class: `dot-${it.kind}` }))));
  }));
  return [strip, h('div', { class: 'agenda' }, days.slice(0, 7).map(day => h('div', { class: 'agenda-day' },
    h('div', { class: ['agenda-date', day.date === d.today && 'is-today'] }, dayLabel(day.date)),
    h('ul', { class: 'agenda-items' }, day.items.map(it => {
      if (it.kind === 'event') {
        const e = it.event;
        return h('li', { class: 'agenda-item' }, h('span', { class: 'agenda-time num' }, e.is_all_day ? 'All day' : formatTime(e.starts_at, ctx.business.timezone, ctx.profile.time_format)),
          h('span', { class: 'agenda-dot dot-event' }), h('span', { class: 'agenda-title' }, e.title), e.location && h('span', { class: 'agenda-sub' }, e.location));
      }
      if (it.kind === 'review') return h('li', { class: 'agenda-item' }, h('span', { class: 'agenda-time faint' }, 'Review'), h('span', { class: 'agenda-dot dot-review' }),
        h('a', { class: 'agenda-title', href: `#/decisions/${it.decision.id}` }, it.decision.title), h('span', { class: 'agenda-sub' }, `Decision${it.project ? ` · ${it.project}` : ''}`));
      if (it.kind === 'milestone') return h('li', { class: 'agenda-item' }, h('span', { class: 'agenda-time faint' }, 'Due'), h('span', { class: 'agenda-dot dot-milestone' }),
        h('a', { class: 'agenda-title', href: `#/projects/${it.milestone.project_id}` }, it.milestone.title), h('span', { class: 'agenda-sub' }, `Milestone · ${it.project ?? ''}`));
      return h('li', { class: 'agenda-item' }, h('span', { class: 'agenda-time faint' }, 'Due'), statusIcon(TASK_STATUS, it.task.status, 13),
        h('button', { type: 'button', class: 'agenda-title as-link', onclick: () => openTaskPanel(ctx, it.task.id) }, it.task.title), it.project && h('span', { class: 'agenda-sub' }, it.project));
    })))))];
}

function activityList(ctx, d) {
  if (!d.activity.length) return stateBlock('empty', { title: 'No activity yet' });
  return h('ul', { class: 'cc-activity' }, d.activity.map(a => {
    const x = describeActivity(a);
    const href = { projects: `#/projects/${a.entity_id}`, tasks: `#/tasks/${a.entity_id}`, milestones: `#/milestones/${a.entity_id}`, decisions: `#/decisions/${a.entity_id}` }[a.entity_table] ?? null;
    return h('li', null, h('span', { class: 'act-text' }, `${x.verb} ${x.noun} `, href && x.verb !== 'Deleted' ? h('a', { href }, x.label) : h('strong', null, x.label), x.status ? h('span', { class: 'faint' }, ` → ${x.status}`) : null),
      h('span', { class: 'act-time faint' }, timeAgo(a.created_at)));
  }));
}

const RENDER = { kpi: kpiStrip, attention: attentionList, projects: projectsList, finance: financePanel, funding: fundingPanel, schedule: scheduleList, activity: activityList };

// ---------- page ----------
async function renderCommand(ctx, _params, query) {
  const layout = ctx.profile.widget_layout || { order: Object.keys(SPAN), hidden: [] };
  const order = layout.order.filter(id => RENDER[id] && !(layout.hidden || []).includes(id));
  // development aid only: ?state=loading|empty|error|stale renders every panel in that state for design review
  const forced = ctx.dataSource.kind === 'development' && ['loading', 'empty', 'error', 'stale'].includes(query.state) ? query.state : null;

  const hour = Number(formatTime(new Date().toISOString(), ctx.business.timezone, '24h').slice(0, 2));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const longDate = new Intl.DateTimeFormat(ctx.business.locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: ctx.business.timezone }).format(new Date());
  const freshness = h('span', { class: 'cc-fresh' });
  const grid = h('div', { class: 'cc-grid' });
  let loadedAt = 0;

  const setFresh = () => {
    const age = Date.now() - loadedAt;
    if (!loadedAt) mount(freshness, h('span', { class: 'faint' }, 'Loading…'));
    else if (forced === 'stale' || age > STALE_MS) mount(freshness, h('span', { class: 'chip tone-warn' }, icon('clock', { size: 12 }), `Updated ${timeAgo(new Date(loadedAt).toISOString())}`), button('Refresh', { kind: 'ghost', size: 'sm', iconName: 'refresh', onClick: draw }));
    else mount(freshness, h('span', { class: 'faint' }, 'Up to date'));
  };

  async function draw() {
    if (forced === 'loading') { mount(grid, order.map(id => panel(id, stateBlock('loading')))); setFresh(); return; }
    let d = null, error = null;
    try { d = await loadAll(ctx); } catch (e) { error = e; }
    loadedAt = Date.now();
    mount(grid, order.map(id => {
      if (forced === 'error' || error) return panel(id, stateBlock('error', { title: 'Couldn’t load this', body: error?.message || 'Simulated error (development state preview).', action: button('Retry', { kind: 'secondary', size: 'sm', onClick: draw }) }));
      if (forced === 'empty') return panel(id, stateBlock('empty', { title: 'Nothing here yet' }));
      try { return panel(id, RENDER[id](ctx, d)); }
      catch (e) { console.error(e); return panel(id, stateBlock('error', { title: 'This panel failed', body: e.message })); }
    }));
    setFresh();
  }

  mount(grid, order.map(id => panel(id, stateBlock('loading'))));
  await draw();
  let t = null;
  ctx.onLeave(ctx.bus.on('data:changed', () => { clearTimeout(t); t = setTimeout(draw, 40); }));
  const tick = setInterval(setFresh, 30000);
  ctx.onLeave(() => clearInterval(tick));

  return h('div', { class: 'page page-cc' },
    h('header', { class: 'cc-hero' },
      h('div', null, h('h1', { class: 'page-title' }, `${greeting}, ${ctx.profile.full_name.split(' ')[0]}`), h('p', { class: 'page-subtitle' }, longDate)),
      h('div', { class: 'cc-hero-meta' }, forced && h('span', { class: 'chip tone-info' }, `Previewing ${forced} state`), freshness)),
    grid);
}

export const commandModule = { routes: [{ pattern: '/command', render: renderCommand }] };
