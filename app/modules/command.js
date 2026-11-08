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

const STALE_MS = 5 * 60 * 1000;
const SPAN = { kpi: 12, attention: 7, projects: 5, finance: 6, funding: 6, schedule: 7, activity: 5 };
const TITLE = { attention: 'Needs attention', projects: 'Active projects', finance: 'Financial position', funding: 'Funding & commitments', schedule: 'Next 14 days', activity: 'Recent activity' };
const LINK = { attention: ['#/tasks', 'All tasks'], projects: ['#/projects', 'All projects'], finance: ['#/finances', 'Finances'], funding: ['#/finances', 'Finances'], schedule: ['#/calendar', 'Calendar'] };

async function loadAll(ctx) {
  const today = ctx.today;
  const [tasks, projects, milestones, events, activity, decisions] = await Promise.all([
    ctx.data.tasks.list(), ctx.data.projects.list(), ctx.data.milestones.list(),
    ctx.data.calendar.between(new Date(`${today}T00:00:00Z`).toISOString(), new Date(`${addDays(today, 16)}T00:00:00Z`).toISOString()),
    ctx.data.activity.recent(8), ctx.data.decisions.list()]);
  return { today, tasks, projects, milestones, events, activity, decisions };
}

function panel(id, body, { meta } = {}) {
  const link = LINK[id];
  return h('section', { class: ['cc-panel', `cc-${id}`], style: { '--span': String(SPAN[id] || 6) }, aria: { labelledby: `cc-h-${id}` } },
    id !== 'kpi' && h('header', { class: 'cc-head' },
      h('h2', { class: 'cc-title', id: `cc-h-${id}` }, TITLE[id]), meta && h('span', { class: 'cc-meta' }, meta),
      link && h('a', { class: 'cc-link', href: link[0] }, link[1], icon('arrowRight', { size: 12 }))),
    h('div', { class: 'cc-body' }, body));
}

// ---------- widgets ----------
function kpiStrip(ctx, d) {
  const k = kpis(d, d.today);
  const cell = (label, value, { tone, sub, href } = {}) => h(href ? 'a' : 'div', { class: ['kpi', tone && `kpi-${tone}`], href },
    h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-value num' }, value), sub && h('span', { class: 'kpi-sub' }, sub));
  return h('div', { class: 'kpi-strip' },
    cell('Open tasks', formatCount(k.openTasks, ctx.profile.number_format), { href: '#/tasks' }),
    cell('Due today', String(k.dueToday), { tone: k.dueToday ? 'warn' : null, href: '#/tasks' }),
    cell('Overdue', String(k.overdue), { tone: k.overdue ? 'bad' : 'ok', sub: k.overdue ? 'needs a decision' : 'all clear', href: '#/tasks' }),
    cell('Active projects', String(k.activeProjects), { href: '#/projects?view=Active' }),
    cell('Milestones · 14 days', String(k.milestonesNext14), { tone: k.lateMilestones ? 'late' : null, sub: k.lateMilestones ? `${k.lateMilestones} late` : null }),
    h('div', { class: 'kpi kpi-off', title: 'Finances arrive in M3' }, h('span', { class: 'kpi-label' }, 'Available cash'), h('span', { class: 'kpi-value kpi-na' }, 'Not connected'), h('span', { class: 'kpi-sub' }, 'Finances · M3')));
}

function attentionList(ctx, d) {
  const { items, total } = attention(d, d.today, 8);
  if (!items.length) return stateBlock('empty', { title: 'Nothing is overdue or due today', body: 'Late milestones, decisions due for review and critical work without a date would show here too.' });
  const rows = items.map(it => {
    if (it.decision) {
      const d = it.decision;
      return h('div', { class: 'att-row' }, h('span', { class: 'att-icon fg-warn' }, icon('decision', { size: 15 })),
        h('a', { class: 'att-main', href: `#/decisions/${d.id}` }, h('span', { class: 'att-title' }, d.title), h('span', { class: 'att-sub' }, ['Decision review', it.project].filter(Boolean).join(' · '))),
        h('span', { class: 'att-when fg-warn num' }, it.days ? `review ${it.days}d overdue` : 'review today'));
    }
    if (it.milestone) {
      const m = it.milestone;
      return h('div', { class: 'att-row' }, h('span', { class: 'att-icon fg-bad' }, icon('flag', { size: 15 })),
        h('a', { class: 'att-main', href: `#/projects/${m.project_id}` }, h('span', { class: 'att-title' }, m.title), h('span', { class: 'att-sub' }, `Milestone · ${it.project ?? ''}`)),
        h('span', { class: 'att-when fg-bad num' }, it.days ? `${it.days}d late` : 'due today'), statusIcon(MILESTONE_STATUS, m.status, 14));
    }
    const t = it.task;
    return h('div', { class: 'att-row' }, statusButton(ctx, t),
      h('button', { type: 'button', class: 'att-main', onclick: () => openTaskPanel(ctx, t.id) },
        h('span', { class: 'att-title' }, t.title), h('span', { class: 'att-sub' }, [it.kind === 'critical' ? 'Critical · no due date' : t.status, it.project].filter(Boolean).join(' · '))),
      it.kind === 'critical' ? h('span', { class: 'att-when fg-bad' }, 'set a date') : dueLabel(ctx, t.due_date), priorityIcon(t.priority, 14));
  });
  return [h('div', { class: 'att-list' }, rows), total > items.length && h('a', { class: 'cc-more', href: '#/tasks' }, `${total - items.length} more`)];
}

function projectsList(ctx, d) {
  const rows = activeProjects(d, d.today);
  if (!rows.length) return stateBlock('empty', { title: 'No active projects', action: h('a', { class: 'link', href: '#/projects' }, 'Open projects') });
  const countdowns = ctx.profile.countdown_preferences?.show_milestone_countdowns !== false;
  return h('div', { class: 'proj-list' }, rows.map(r => {
    const { project: p, progress, next } = r;
    const n = next ? daysBetween(d.today, next.due_date) : null;
    return h('a', { class: 'proj-item', href: `#/projects/${p.id}` },
      h('div', { class: 'proj-top' }, h('span', { class: 'proj-name' }, p.name), priorityIcon(p.priority, 14), h('span', { class: 'proj-pct num' }, `${progress.pct}%`)),
      h('div', { class: 'progress-track' }, h('span', { class: 'progress-fill', style: { width: `${progress.pct}%` } })),
      h('div', { class: 'proj-bottom' },
        next ? h('span', { class: ['proj-next', r.nextLate && 'fg-bad'] }, icon('flag', { size: 12 }), h('span', { class: 'ellipsis' }, next.title),
          countdowns && h('span', { class: 'num' }, n < 0 ? `${-n}d late` : n === 0 ? 'today' : `${n}d`)) : h('span', { class: 'faint' }, 'No open milestones'),
        h('span', { class: 'proj-open num' }, `${r.openTasks} open`, r.overdue ? h('span', { class: 'fg-bad' }, ` · ${r.overdue} overdue`) : null)));
  }));
}

function financeUnavailable(kind) {
  return stateBlock('unavailable', kind === 'finance'
    ? { title: 'Not connected yet', body: 'Arrives with Finances (M3): available cash as of today from get_available_cash, account balances and runway. No figures are shown until real ledger data exists.' }
    : { title: 'Not connected yet', body: 'Arrives with Finances (M3): requirements, commitments and what has actually been received. A pledge is not cash, so nothing is estimated here.' });
}

function scheduleList(ctx, d) {
  const days = schedule({ events: d.events, tasks: d.tasks, milestones: d.milestones, projects: d.projects, decisions: d.decisions }, d.today, ctx.business.timezone, 14);
  if (!days.length) return stateBlock('empty', { title: 'Nothing scheduled in the next 14 days' });
  const dayLabel = date => relativeDay(date, d.today) === 'Today' || relativeDay(date, d.today) === 'Tomorrow' ? relativeDay(date, d.today)
    : new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) + ' ' + formatShortDate(date, d.today, ctx.profile.date_format);
  return h('div', { class: 'agenda' }, days.slice(0, 7).map(day => h('div', { class: 'agenda-day' },
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
    })))));
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

const RENDER = { kpi: kpiStrip, attention: attentionList, projects: projectsList, finance: () => financeUnavailable('finance'), funding: () => financeUnavailable('funding'), schedule: scheduleList, activity: activityList };

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
      if (forced === 'empty') return panel(id, id === 'finance' || id === 'funding' ? RENDER[id]() : stateBlock('empty', { title: 'Nothing here yet' }));
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
