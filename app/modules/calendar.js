// Calendar module: month, week and agenda views in the business time zone. Shows calendar_events plus task and
// milestone due dates; each entry opens its originating record. Events are created and edited here.
import { h, mount } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { button, pageHeader, stateBlock } from '../ui/components.js';
import { TASK_STATUS, MILESTONE_STATUS, statusIcon } from '../ui/status.js';
import { openDialog, confirmDialog } from '../ui/overlay.js';
import { field, input, textarea, select, dateInput, setFieldError, nullIfEmpty } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { addDays, monthGrid, monthLabel, addMonths, startOfWeek, formatTime, zonedToUtc, utcToZoned, formatShortDate, relativeDay } from '../core/format.js';
import { calendarEntries } from './projections.js';
import { openTaskPanel } from './tasks.js';
import { openMilestonePanel } from './milestones.js';

const VIEWS = ['month', 'week', 'agenda'];
const AGENDA_DAYS = 30;
const DOW = d => new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

export async function eventDialog(ctx, existing = null, defaults = {}) {
  const tz = ctx.business.timezone;
  const e = existing || {};
  const start = e.starts_at ? utcToZoned(e.starts_at, tz) : { date: defaults.date || ctx.today, time: '10:00' };
  const end = e.ends_at ? utcToZoned(e.ends_at, tz) : { date: start.date, time: '11:00' };
  const projects = (await ctx.data.projects.list()).filter(p => p.status !== 'Archived' || p.id === e.project_id);
  const title = input({ value: e.title || '', maxlength: 300, autofocus: true });
  const allDay = h('input', { type: 'checkbox', checked: !!e.is_all_day, class: 'checkbox' });
  const date = dateInput({ value: start.date });
  const startT = input({ type: 'time', value: start.time, class: 'input' });
  const endT = input({ type: 'time', value: end.time, class: 'input' });
  const endD = dateInput({ value: end.date });
  const location = input({ value: e.location || '', maxlength: 300 });
  const project = select(projects.map(p => [p.id, p.name]), { value: e.project_id || '', placeholder: 'No project' });
  const description = textarea({ value: e.description || '', rows: 2 });
  const sync = () => { for (const c of [startT, endT]) c.closest('.field').hidden = allDay.checked; };
  allDay.addEventListener('change', sync);
  const actions = [{ label: 'Cancel', kind: 'ghost' }];
  if (existing) actions.unshift({ label: 'Delete', kind: 'danger', run: async () => {
    if (!(await confirmDialog({ title: `Delete “${existing.title}”?`, body: 'The event is removed from the calendar. This can’t be undone.', confirmLabel: 'Delete', danger: true }))) return false;
    await ctx.data.calendar.remove(existing.id); ctx.toast('Event deleted');
  } });
  actions.push({ label: existing ? 'Save' : 'Add event', kind: 'primary', submit: true, run: async () => {
    [title, date, endD, endT].forEach(c => setFieldError(c, ''));
    // times are entered in the business time zone and stored as UTC instants (timestamptz)
    const row = {
      title: title.value, is_all_day: allDay.checked, location: nullIfEmpty(location.value.trim()), project_id: nullIfEmpty(project.value), description: nullIfEmpty(description.value.trim()),
      starts_at: zonedToUtc(date.value || ctx.today, allDay.checked ? '00:00' : startT.value, tz),
      ends_at: zonedToUtc(endD.value || date.value || ctx.today, allDay.checked ? '23:59' : endT.value, tz),
    };
    try {
      if (existing) await ctx.data.calendar.update(existing.id, row); else await ctx.data.calendar.create(row);
    } catch (err) {
      const f = friendlyError(err);
      setFieldError(f.message.includes('end') ? endT : title, f.message); return false;
    }
  } });
  openDialog({ title: existing ? 'Edit event' : 'New event', actions,
    content: h('div', { class: 'form-grid' }, field('Title', title, { full: true }),
      h('label', { class: 'check-row field-full' }, allDay, 'All day'),
      field('Date', date), field('Ends on', endD), field('Starts', startT), field('Ends', endT),
      field('Location', location), field('Project', project), field('Description', description, { full: true }),
      h('p', { class: 'faint small field-full' }, `Times are in the business time zone (${tz}).`)) });
  sync();
}

function entryNode(ctx, e, { compact = false } = {}) {
  const open = () => (e.kind === 'task' ? openTaskPanel(ctx, e.id) : e.kind === 'milestone' ? openMilestonePanel(ctx, e.id) : eventDialog(ctx, e.event));
  const lead = e.kind === 'event'
    ? h('span', { class: 'ce-time num' }, e.allDay ? 'All day' : formatTime(e.event.starts_at, ctx.business.timezone, ctx.profile.time_format))
    : e.kind === 'task' ? statusIcon(TASK_STATUS, e.task.status, 12) : statusIcon(MILESTONE_STATUS, e.milestone.status, 12);
  const kindLabel = { task: 'Task due', milestone: 'Milestone due', event: 'Event' }[e.kind];
  const stateLabel = { overdue: 'overdue', today: 'due today', done: 'completed', muted: 'cancelled', upcoming: '' }[e.state];
  return h('button', { type: 'button', class: ['cal-entry', `ce-${e.kind}`, `ce-${e.state}`, compact && 'ce-compact'], onclick: ev => { ev.stopPropagation(); open(); },
    title: `${kindLabel}: ${e.title}${e.project ? ` · ${e.project}` : ''}${stateLabel ? ` (${stateLabel})` : ''}`,
    aria: { label: `${kindLabel}: ${e.title}${stateLabel ? `, ${stateLabel}` : ''}` } },
    lead, h('span', { class: 'ce-title' }, e.title));
}

function dayList(ctx, date, entries) {
  return h('section', { class: 'cal-day-list', aria: { label: `Entries on ${date}` } },
    h('h2', { class: 'section-title' }, `${relativeDay(date, ctx.today) === 'Today' ? 'Today · ' : ''}${DOW(date)} ${formatShortDate(date, ctx.today, ctx.profile.date_format)}`),
    entries.length ? h('div', { class: 'cal-day-entries' }, entries.map(e => h('div', { class: 'cal-day-row' }, entryNode(ctx, e), e.project && h('span', { class: 'faint small' }, e.project))))
      : h('p', { class: 'faint small' }, 'Nothing on this day.'),
    button('Add event on this day', { kind: 'ghost', size: 'sm', iconName: 'plus', onClick: () => eventDialog(ctx, null, { date }) }));
}

async function renderCalendar(ctx, _params, query) {
  const view = VIEWS.includes(query.view) ? query.view : 'month';
  const focus = /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') ? query.date : ctx.today;
  const ws = ctx.profile.week_start_day;
  const go = (v, d) => ctx.navigate('/calendar', { view: v, date: d });
  const step = dir => go(view, view === 'month' ? addMonths(focus, dir) : addDays(focus, dir * (view === 'week' ? 7 : AGENDA_DAYS)));
  let range;
  if (view === 'month') { const g = monthGrid(focus, ws); range = [g[0][0], g[g.length - 1][6]]; }
  else if (view === 'week') { const s = startOfWeek(focus, ws); range = [s, addDays(s, 6)]; }
  else range = [focus, addDays(focus, AGENDA_DAYS - 1)];
  const title = view === 'month' ? monthLabel(focus, ctx.business.locale)
    : view === 'week' ? `${formatShortDate(range[0], ctx.today, ctx.profile.date_format)} – ${formatShortDate(range[1], ctx.today, ctx.profile.date_format)}`
    : `From ${formatShortDate(focus, ctx.today, ctx.profile.date_format)}`;

  const body = h('div', { class: 'cal-body' }, stateBlock('loading'));
  let selected = focus;
  const draw = async () => {
    const [events, tasks, milestones, projects] = await Promise.all([
      ctx.data.calendar.between(zonedToUtc(range[0], '00:00', ctx.business.timezone), zonedToUtc(addDays(range[1], 1), '00:00', ctx.business.timezone)),
      ctx.data.tasks.list(), ctx.data.milestones.list(), ctx.data.projects.list()]);
    const map = calendarEntries({ events, tasks, milestones, projects }, range[0], range[1], ctx.business.timezone, ctx.today);
    const at = d => map.get(d) || [];
    if (view === 'month') {
      const weeks = monthGrid(focus, ws);
      const cells = [];
      const grid = h('div', { class: 'cal-month', role: 'grid', aria: { label: title } },
        h('div', { class: 'cal-dow', role: 'row' }, weeks[0].map(d => h('span', { role: 'columnheader' }, DOW(d)))),
        weeks.map(week => h('div', { class: 'cal-week', role: 'row' }, week.map(d => {
          const list = at(d), more = list.length - 3;
          const cell = h('div', { class: ['cal-cell', d.slice(0, 7) !== focus.slice(0, 7) && 'is-other', d === ctx.today && 'is-today', d === selected && 'is-selected'],
            role: 'gridcell', tabindex: d === selected ? '0' : '-1', dataset: { date: d }, aria: { selected: d === selected ? 'true' : 'false', label: `${DOW(d)} ${d}, ${list.length} item(s)` },
            onclick: () => select_(d) },
            h('span', { class: 'cal-num num' }, String(Number(d.slice(8)))),
            h('div', { class: 'cal-cell-entries' }, list.slice(0, 3).map(e => entryNode(ctx, e, { compact: true }))),
            more > 0 && h('span', { class: 'cal-more' }, `+${more} more`),
            list.length > 0 && h('span', { class: 'cal-dots', aria: { hidden: true } }, list.slice(0, 4).map(e => h('i', { class: `dot-${e.kind} dot-${e.state}` }))));
          cells.push(cell);
          return cell;
        }))));
      // arrow keys move between days (WAI-ARIA grid pattern); Enter shows the day
      grid.addEventListener('keydown', ev => {
        const i = cells.findIndex(c => c === document.activeElement); if (i < 0) return;
        const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
        if (delta && cells[i + delta]) { ev.preventDefault(); select_(cells[i + delta].dataset.date, true); }
        else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select_(cells[i].dataset.date, true); }
      });
      const select_ = (d, keepFocus) => {
        selected = d;
        for (const c of cells) { const on = c.dataset.date === d; c.classList.toggle('is-selected', on); c.tabIndex = on ? 0 : -1; c.setAttribute('aria-selected', on ? 'true' : 'false'); if (on && keepFocus) c.focus(); }
        mount(dayPanel, dayList(ctx, d, at(d)));
      };
      const dayPanel = h('div', { class: 'cal-day-panel' }, dayList(ctx, selected, at(selected)));
      mount(body, grid, dayPanel);
    } else if (view === 'week') {
      const days = Array.from({ length: 7 }, (_, i) => addDays(range[0], i));
      mount(body, h('div', { class: 'cal-weekview' }, days.map(d => h('section', { class: ['cal-wcol', d === ctx.today && 'is-today'], aria: { label: `${DOW(d)} ${d}` } },
        h('header', { class: 'cal-whead' }, h('span', null, DOW(d)), h('span', { class: 'cal-num num' }, String(Number(d.slice(8))))),
        h('div', { class: 'cal-wentries' }, at(d).length ? at(d).map(e => entryNode(ctx, e)) : h('span', { class: 'faint small' }, '—'))))));
    } else {
      const days = [...map.keys()].sort();
      mount(body, days.length ? h('div', { class: 'agenda cal-agenda' }, days.map(d => h('div', { class: 'agenda-day' },
        h('div', { class: ['agenda-date', d === ctx.today && 'is-today'] }, `${relativeDay(d, ctx.today) === 'Today' ? 'Today' : DOW(d)} ${formatShortDate(d, ctx.today, ctx.profile.date_format)}`),
        h('div', { class: 'cal-day-entries' }, at(d).map(e => h('div', { class: 'cal-day-row' }, entryNode(ctx, e), e.project && h('span', { class: 'faint small' }, e.project)))))))
        : stateBlock('empty', { title: `Nothing in the ${AGENDA_DAYS} days from this date` }));
    }
  };
  await draw();
  let t = null;
  ctx.onLeave(ctx.bus.on('data:changed', ch => { if (['calendar_events', 'tasks', 'milestones', 'projects', '*'].includes(ch.table)) { clearTimeout(t); t = setTimeout(draw, 30); } }));

  const seg = h('div', { class: 'seg seg-text', role: 'tablist', aria: { label: 'Calendar view' } }, VIEWS.map(v => h('a', { class: 'seg-btn', role: 'tab', href: `#/calendar?view=${v}&date=${focus}`, aria: { selected: v === view ? 'true' : 'false', checked: v === view ? 'true' : 'false' } }, v[0].toUpperCase() + v.slice(1))));
  return h('div', { class: 'page page-cal' },
    pageHeader({ title, subtitle: 'Events, task due dates and milestones, in the business time zone.', actions: [
      h('div', { class: 'cal-nav' }, button('', { kind: 'ghost', size: 'sm', iconName: 'chevronRight', title: 'Previous', cls: 'flip', onClick: () => step(-1) }),
        button('Today', { kind: 'secondary', size: 'sm', onClick: () => go(view, ctx.today) }),
        button('', { kind: 'ghost', size: 'sm', iconName: 'chevronRight', title: 'Next', onClick: () => step(1) })),
      seg, button('New event', { kind: 'primary', iconName: 'plus', onClick: () => eventDialog(ctx, null, { date: selected }) })] }),
    h('div', { class: 'cal-legend', aria: { hidden: true } }, h('span', null, h('i', { class: 'dot-event' }), 'Event'), h('span', null, h('i', { class: 'dot-milestone' }), 'Milestone'), h('span', null, h('i', { class: 'dot-task' }), 'Task due'),
      h('span', null, h('i', { class: 'dot-task dot-overdue' }), 'Overdue'), h('span', null, h('i', { class: 'dot-task dot-done' }), 'Completed')),
    body);
}

export const calendarModule = { routes: [{ pattern: '/calendar', render: renderCalendar }] };
