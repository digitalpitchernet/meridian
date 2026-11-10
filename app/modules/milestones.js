// Milestones module: timeline across projects, create/edit/delete, editor panel with linked tasks.
// Schema (Gate 1): project_id (required), title, description, due_date (required), status, achieved_at.
// There is no start date column; none is shown or invented (flagged in app/README.md).
import { h, mount } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { button, pageHeader, stateBlock } from '../ui/components.js';
import { MILESTONE_STATUS, statusIcon } from '../ui/status.js';
import { popMenu, openDialog, confirmDialog } from '../ui/overlay.js';
import { field, input, textarea, select, dateInput, setFieldError, nullIfEmpty } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { ENUMS } from '../data/schema.js';
import { formatShortDate, daysBetween, formatDateTime } from '../core/format.js';
import { milestoneProgress, milestoneState } from './projections.js';
import { taskRows, quickAdd, sortTasks } from './tasks.js';

const VIEWS = ['Open', 'Achieved', 'Cancelled', 'All'];
const OPEN = ['Upcoming', 'In Progress', 'Delayed'];

// Interpretation (flagged, same rule as projects.completed_at): achieved_at is client-writable with no trigger,
// so the app sets it when a milestone becomes Achieved and clears it when it stops being Achieved.
export const achievedPatch = (from, to) => (to === 'Achieved' && from !== 'Achieved' ? { achieved_at: new Date().toISOString() } : to !== 'Achieved' && from === 'Achieved' ? { achieved_at: null } : {});

export function whenLabel(ctx, m) {
  const st = milestoneState(m, ctx.today), n = daysBetween(ctx.today, m.due_date);
  const date = formatShortDate(m.due_date, ctx.today, ctx.profile.date_format);
  const text = st === 'achieved' ? `${date} · achieved` : st === 'cancelled' ? `${date} · cancelled` : st === 'late' ? `${date} · ${n < 0 ? `${-n}d late` : 'delayed'}` : n === 0 ? `${date} · today` : `${date} · in ${n}d`;
  return h('span', { class: ['when', `when-${st}`] }, text);
}

export function milestoneStatusButton(ctx, m) {
  const b = h('button', { type: 'button', class: 'icon-btn', aria: { label: `Status: ${m.status}. Change status`, haspopup: 'menu', expanded: 'false' },
    onclick: e => { e.stopPropagation(); popMenu(b, ENUMS.milestoneStatus.map(s => ({ label: s, value: s, icon: statusIcon(MILESTONE_STATUS, s, 14) })), { current: m.status, label: 'Milestone status',
      onPick: v => v !== m.status && ctx.data.milestones.update(m.id, { status: v, ...achievedPatch(m.status, v) }).catch(err => ctx.toast(friendlyError(err).message, { tone: 'bad' })) }); } },
    statusIcon(MILESTONE_STATUS, m.status));
  return b;
}

function progress({ done, total, pct }) {
  return h('span', { class: 'progress', title: `${done} of ${total} linked tasks done` },
    h('span', { class: 'progress-track', role: 'progressbar', aria: { valuenow: String(pct), valuemin: '0', valuemax: '100', label: 'Linked task progress' } }, h('span', { class: 'progress-fill', style: { width: `${pct}%` } })),
    h('span', { class: 'progress-text num' }, total ? `${done}/${total}` : 'no tasks'));
}

export async function milestoneDialog(ctx, existing = null, defaults = {}) {
  const m = existing || defaults;
  const projects = (await ctx.data.projects.list()).filter(p => p.status !== 'Archived' || p.id === m.project_id);
  const title = input({ value: m.title || '', maxlength: 200, autofocus: true });
  const project = select(projects.map(p => [p.id, p.name]), { value: m.project_id || '', placeholder: 'Choose a project' });
  const due = dateInput({ value: m.due_date || '' });
  const status = select(ENUMS.milestoneStatus, { value: m.status || 'Upcoming' });
  const description = textarea({ value: m.description || '', rows: 2 });
  const controls = { title, project_id: project, due_date: due, status, description };
  openDialog({ title: existing ? 'Edit milestone' : 'New milestone',
    content: h('div', { class: 'form-grid' }, field('Title', title, { full: true }), field('Project', project, { hint: 'Every milestone belongs to one project.' }), field('Due date', due),
      field('Status', status), field('Description', description, { full: true })),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: existing ? 'Save' : 'Create milestone', kind: 'primary', submit: true, run: async () => {
      Object.values(controls).forEach(c => setFieldError(c, ''));
      const row = { title: title.value, project_id: nullIfEmpty(project.value), due_date: nullIfEmpty(due.value), status: status.value, description: nullIfEmpty(description.value.trim()) };
      try {
        if (existing) {
          const patch = Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== existing[k]));
          if (Object.keys(patch).length) await ctx.data.milestones.update(existing.id, { ...patch, ...achievedPatch(existing.status, row.status) });
        } else {
          const created = await ctx.data.milestones.create({ ...row, ...achievedPatch(null, row.status) });
          ctx.toast('Milestone created', { action: { label: 'Open', run: () => ctx.navigate(`/milestones/${created.id}`) } });
        }
      } catch (e) { const f = friendlyError(e); const c = controls[f.column]; if (c) setFieldError(c, f.message); else ctx.toast(f.message, { tone: 'bad' }); return false; }
    } }] });
}

export async function deleteMilestone(ctx, m) {
  const [tasks, events] = await Promise.all([ctx.data.tasks.list({ eq: { milestone_id: m.id } }), ctx.data.calendar.list({ eq: { milestone_id: m.id } })]);
  const ok = await confirmDialog({ title: `Delete “${m.title}”?`, danger: true, confirmLabel: 'Delete milestone',
    body: h('div', null, h('p', null, 'This can’t be undone.'), h('ul', { class: 'plain-list' },
      h('li', null, `${tasks.length} linked task(s) are kept; their milestone link is cleared.`),
      h('li', null, `${events.length} calendar event(s) are kept; their milestone link is cleared.`)),
      h('p', { class: 'muted' }, 'To keep the record, set the status to Cancelled instead.')) });
  if (!ok) return false;
  await ctx.data.milestones.remove(m.id); ctx.toast('Milestone deleted');
  return true;
}

// ---------- editor panel ----------
export async function openMilestonePanel(ctx, id) {
  const body = h('div', { class: 'panel-body' }, stateBlock('loading'));
  ctx.openPanel(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('span', { class: 'panel-kicker' }, 'Milestone'),
    button('', { kind: 'ghost', size: 'sm', iconName: 'x', title: 'Close panel', onClick: () => ctx.closePanel() })), body),
    { label: 'Milestone details', onClose: () => { if (/^#\/milestones\/[^/?]+/.test(location.hash)) history.replaceState(null, '', '#/milestones'); } });
  const draw = async () => {
    const m = await ctx.data.milestones.get(id);
    if (!m) { mount(body, stateBlock('empty', { title: 'This milestone no longer exists' })); return; }
    const [project, tasks, projects, subtasks] = await Promise.all([ctx.data.projects.get(m.project_id), ctx.data.tasks.list({ eq: { milestone_id: id } }), ctx.data.projects.list(), ctx.data.tasks.allSubtasks()]);
    mount(body,
      h('div', { class: 'ms-head' }, milestoneStatusButton(ctx, m), h('h2', { class: 'ms-title' }, m.title)),
      h('div', { class: 'prop-row' }, whenLabel(ctx, m), project && h('a', { class: 'proj-tag', href: `#/projects/${project.id}` }, project.name), progress(milestoneProgress(id, tasks))),
      m.description && h('p', { class: 'muted' }, m.description),
      h('section', { class: 'panel-section' }, h('h3', { class: 'section-title' }, `Linked tasks · ${tasks.length}`),
        quickAdd(ctx, { project_id: m.project_id, milestone_id: id }, { placeholder: 'Add a task to this milestone' }),
        tasks.length ? h('div', { class: 'rows', role: 'list' }, taskRows(ctx, sortTasks(tasks), { projects, milestones: [m], subtasks }, { showProject: false }))
          : h('p', { class: 'faint small' }, 'No tasks are linked yet.')),
      h('dl', { class: 'meta-list' }, h('dt', null, 'Created'), h('dd', null, formatDateTime(m.created_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format)),
        m.achieved_at && [h('dt', null, 'Achieved'), h('dd', null, formatDateTime(m.achieved_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format))]),
      h('div', { class: 'panel-foot row-actions' }, button('Edit', { kind: 'secondary', size: 'sm', iconName: 'edit', onClick: () => milestoneDialog(ctx, m) }),
        button('Delete', { kind: 'danger', size: 'sm', iconName: 'trash', onClick: async () => { if (await deleteMilestone(ctx, m)) ctx.closePanel(); } })));
  };
  await draw();
  const off = ctx.bus.on('data:changed', ch => {
    if (!document.body.contains(body)) { off(); return; }
    const a = document.activeElement;
    if (['milestones', 'tasks', 'projects', 'subtasks', '*'].includes(ch.table) && !(a && body.contains(a) && a.value)) {
      const keep = a && body.contains(a) && a.classList.contains('quick-input');
      draw().then(() => keep && body.querySelector('.quick-input')?.focus());
    }
  });
}

// ---------- page ----------
async function renderMilestones(ctx, params, query) {
  const view = VIEWS.includes(query.view) ? query.view : 'Open';
  const projectFilter = query.project || '';
  const tabs = h('div', { class: 'tabs', role: 'tablist', aria: { label: 'Milestone views' } });
  const listEl = h('div', { class: 'list-wrap' });
  const projects = await ctx.data.projects.list();
  const projSel = select(projects.filter(p => p.status !== 'Archived').map(p => [p.id, p.name]), { value: projectFilter, placeholder: 'All projects', class: 'input select select-sm', aria: { label: 'Filter by project' },
    onchange: e => ctx.navigate('/milestones', Object.fromEntries(Object.entries({ view: view === 'Open' ? '' : view, project: e.target.value }).filter(([, v]) => v))) });
  const inView = (m, v) => (v === 'All' ? true : v === 'Open' ? OPEN.includes(m.status) : m.status === v);
  const draw = async () => {
    const [milestones, tasks, allProjects] = await Promise.all([ctx.data.milestones.list(), ctx.data.tasks.list(), ctx.data.projects.list()]);
    const filtered = milestones.filter(m => !projectFilter || m.project_id === projectFilter);
    mount(tabs, VIEWS.map(v => h('a', { class: ['tab', v === view && 'active'], role: 'tab', aria: { selected: v === view ? 'true' : 'false' },
      href: `#/milestones?${new URLSearchParams(Object.entries({ view: v === 'Open' ? '' : v, project: projectFilter }).filter(([, x]) => x))}` }, v, h('span', { class: 'tab-count num' }, String(filtered.filter(m => inView(m, v)).length)))));
    const rows = filtered.filter(m => inView(m, view)).sort((a, b) => view === 'Achieved' ? b.due_date.localeCompare(a.due_date) : a.due_date.localeCompare(b.due_date));
    if (!rows.length) { mount(listEl, stateBlock('empty', { title: `No ${view === 'All' ? '' : view.toLowerCase() + ' '}milestones`, action: button('New milestone', { kind: 'primary', size: 'sm', iconName: 'plus', onClick: () => milestoneDialog(ctx, null, { project_id: projectFilter || undefined }) }) })); return; }
    const pmap = new Map(allProjects.map(p => [p.id, p]));
    mount(listEl, h('div', { class: 'rows ms-rows', role: 'list' }, rows.map(m => h('div', { class: ['row', 'ms-row', `ms-${milestoneState(m, ctx.today)}`], role: 'listitem' },
      milestoneStatusButton(ctx, m),
      h('button', { type: 'button', class: 'row-main', onclick: () => openMilestonePanel(ctx, m.id) }, h('span', { class: 'row-title' }, m.title)),
      h('div', { class: 'row-meta' }, pmap.get(m.project_id) && h('a', { class: 'proj-tag', href: `#/projects/${m.project_id}`, onclick: e => e.stopPropagation() }, pmap.get(m.project_id).name),
        progress(milestoneProgress(m.id, tasks)), whenLabel(ctx, m))))));
  };
  await draw();
  ctx.onLeave(ctx.bus.on('data:changed', ch => ['milestones', 'tasks', 'projects', '*'].includes(ch.table) && draw()));
  if (params.id) queueMicrotask(() => openMilestonePanel(ctx, params.id));
  return h('div', { class: 'page' },
    pageHeader({ title: 'Milestones', subtitle: 'The dates each project is working towards, and how close they are.', actions: [projSel, button('New milestone', { kind: 'primary', iconName: 'plus', onClick: () => milestoneDialog(ctx, null, { project_id: projectFilter || undefined }) })] }),
    tabs, listEl);
}

export const milestonesModule = { routes: [{ pattern: '/milestones', render: renderMilestones }, { pattern: '/milestones/:id', render: renderMilestones }] };
