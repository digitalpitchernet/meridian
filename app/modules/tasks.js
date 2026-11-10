// Tasks module: list (grouped by the canonical statuses), quick add, inline status/priority, editor panel with
// subtasks. All reads and writes go through ctx.data (repositories); the adapter enforces the schema.
import { h, mount, clear } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { button, pageHeader, stateBlock, chip } from '../ui/components.js';
import { TASK_STATUS, PRIORITY, statusIcon, priorityIcon } from '../ui/status.js';
import { popMenu, confirmDialog } from '../ui/overlay.js';
import { field, input, textarea, select, dateInput, setFieldError, nullIfEmpty } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { ENUMS } from '../data/schema.js';
import { formatShortDate, relativeDay, formatDateTime } from '../core/format.js';
import { dueState, isOpen, byPriority } from './projections.js';

const VIEWS = ['Open', ...ENUMS.taskStatus];

// ---------- shared pieces (used by Projects and the Command Centre too) ----------
export function dueLabel(ctx, date) {
  if (!date) return null;
  const st = dueState(date, ctx.today);
  const rel = relativeDay(date, ctx.today);
  const text = st === 'overdue' ? `${formatShortDate(date, ctx.today, ctx.profile.date_format)} · overdue` : rel || formatShortDate(date, ctx.today, ctx.profile.date_format);
  return h('span', { class: ['due', st && `due-${st}`], title: `Due ${date}` }, icon(st === 'overdue' ? 'alert' : 'calendar', { size: 12 }), text);
}

async function save(ctx, id, patch) {
  try { return await ctx.data.tasks.update(id, patch); }
  catch (e) { ctx.toast(friendlyError(e).message, { tone: 'bad' }); throw e; }
}

export function statusButton(ctx, task) {
  const b = h('button', { type: 'button', class: 'icon-btn', aria: { label: `Status: ${task.status}. Change status`, haspopup: 'menu', expanded: 'false' },
    onclick: e => { e.stopPropagation(); popMenu(b, ENUMS.taskStatus.map(s => ({ label: s, value: s, icon: statusIcon(TASK_STATUS, s, 14) })), { current: task.status, label: 'Task status', onPick: v => v !== task.status && save(ctx, task.id, { status: v }).then(() => v === 'Done' && ctx.toast(`Completed “${task.title}”`, { action: { label: 'Undo', run: () => save(ctx, task.id, { status: task.status }) } })) }); } },
    statusIcon(TASK_STATUS, task.status));
  return b;
}
export function priorityButton(ctx, task) {
  const b = h('button', { type: 'button', class: 'icon-btn', aria: { label: `${task.priority} priority. Change priority`, haspopup: 'menu', expanded: 'false' },
    onclick: e => { e.stopPropagation(); popMenu(b, [...ENUMS.priority].reverse().map(p => ({ label: p, value: p, icon: priorityIcon(p, 14) })), { current: task.priority, label: 'Priority', onPick: v => v !== task.priority && save(ctx, task.id, { priority: v }) }); } },
    priorityIcon(task.priority));
  return b;
}

// rows: tasks already filtered; lookups: { projects, milestones, subtasks }
export function taskRows(ctx, tasks, lookups, { showProject = true } = {}) {
  const pmap = new Map(lookups.projects.map(p => [p.id, p]));
  const subs = lookups.subtasks || [];
  return tasks.map(t => {
    const st = subs.filter(s => s.task_id === t.id);
    const project = pmap.get(t.project_id);
    return h('div', { class: ['row', 'task-row', t.status === 'Done' && 'is-done'], role: 'listitem', dataset: { id: t.id } },
      statusButton(ctx, t),
      h('button', { type: 'button', class: 'row-main', onclick: () => openTaskPanel(ctx, t.id) },
        h('span', { class: 'row-title' }, t.title),
        t.recurrence_rule && h('span', { class: 'row-meta-icon', title: `Repeats ${t.recurrence_rule}` }, icon('refresh', { size: 12 }))),
      h('div', { class: 'row-meta' },
        st.length > 0 && h('span', { class: 'subcount num', title: 'Subtasks done' }, icon('checkSquare', { size: 12 }), `${st.filter(s => s.is_completed).length}/${st.length}`),
        showProject && project && h('a', { class: 'proj-tag', href: `#/projects/${project.id}`, onclick: e => e.stopPropagation() }, project.name),
        t.status !== 'Done' && dueLabel(ctx, t.due_date)),
      priorityButton(ctx, t));
  });
}

export function quickAdd(ctx, defaults = {}, { placeholder = 'Add a task to Inbox and press Enter' } = {}) {
  const field_ = input({ placeholder, class: 'input quick-input', aria: { label: placeholder }, maxlength: 300 });
  const form = h('form', { class: 'quick-add', onsubmit: async e => {
    e.preventDefault();
    const title = field_.value.trim(); if (!title) return;
    try { await ctx.data.tasks.create({ title, status: 'Inbox', ...defaults }); field_.value = ''; }
    catch (err) { ctx.toast(friendlyError(err).message, { tone: 'bad' }); }
  } }, icon('plus', { size: 14, cls: 'icon quick-icon' }), field_);
  return form;
}

export function groupByStatus(ctx, tasks, lookups, opts) {
  return ENUMS.taskStatus.map(s => {
    const list = tasks.filter(t => t.status === s);
    if (!list.length) return null;
    return h('section', { class: 'group' },
      h('h3', { class: 'group-head' }, statusIcon(TASK_STATUS, s, 14), h('span', null, s), h('span', { class: 'group-count num' }, String(list.length))),
      h('div', { class: 'rows', role: 'list' }, taskRows(ctx, list, lookups, opts)));
  });
}

export const sortTasks = list => list.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || byPriority(a, b) || a.created_at.localeCompare(b.created_at));

// ---------- editor panel ----------
export async function openTaskPanel(ctx, taskId) {
  const body = h('div', { class: 'panel-body' }, stateBlock('loading'));
  ctx.openPanel(h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('span', { class: 'panel-kicker' }, 'Task'), button('', { kind: 'ghost', size: 'sm', iconName: 'x', title: 'Close panel', onClick: () => ctx.closePanel() })), body),
    { label: 'Task details', onClose: () => {
      // a deep link (#/tasks/<id>) should not reopen the panel after it was closed; replaceState fires no hashchange
      if (/^#\/tasks\/[^/?]+/.test(location.hash)) history.replaceState(null, '', '#/tasks');
    } });

  let off = null;
  const draw = async () => {
    const task = await ctx.data.tasks.get(taskId);
    if (!task) { mount(body, stateBlock('empty', { title: 'This task no longer exists' })); return; }
    const [projects, subtasks, milestones] = await Promise.all([ctx.data.projects.list(), ctx.data.tasks.subtasks(taskId), task.project_id ? ctx.data.milestones.forProject(task.project_id) : []]);
    const set = async (patch, control) => {
      try { await ctx.data.tasks.update(taskId, patch); if (control) setFieldError(control, ''); }
      catch (e) { const f = friendlyError(e); if (control) setFieldError(control, f.message); else ctx.toast(f.message, { tone: 'bad' }); }
    };
    const title = textarea({ class: 'input textarea title-input', rows: 1, value: task.title, maxlength: 300, aria: { label: 'Title' } });
    title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
    title.addEventListener('change', () => title.value.trim() !== task.title && set({ title: title.value }, title));
    const statusSel = select(ENUMS.taskStatus, { value: task.status, onchange: e => set({ status: e.target.value }) });
    const prioSel = select(ENUMS.priority, { value: task.priority, onchange: e => set({ priority: e.target.value }) });
    const due = dateInput({ value: task.due_date || '', onchange: e => set({ due_date: nullIfEmpty(e.target.value) }, e.target) });
    const projSel = select(projects.filter(p => p.status !== 'Archived' || p.id === task.project_id).map(p => [p.id, p.name]), { value: task.project_id || '', placeholder: 'No project',
      onchange: e => set({ project_id: nullIfEmpty(e.target.value), milestone_id: null }) }); // a milestone belongs to one project
    const msSel = select(milestones.map(m => [m.id, `${m.title} · ${formatShortDate(m.due_date, ctx.today, ctx.profile.date_format)}`]), { value: task.milestone_id || '', placeholder: task.project_id ? 'No milestone' : 'Pick a project first', disabled: !task.project_id,
      onchange: e => set({ milestone_id: nullIfEmpty(e.target.value) }) });
    const ruleSel = select(ENUMS.recurrence.map(r => [r, r[0].toUpperCase() + r.slice(1)]), { value: task.recurrence_rule || '', placeholder: 'Does not repeat',
      onchange: e => { const rule = nullIfEmpty(e.target.value); set({ recurrence_rule: rule, recurrence_interval: rule ? (task.recurrence_interval || 1) : null }); } });
    const desc = textarea({ value: task.description || '', rows: 3, placeholder: 'Add a description', onchange: e => set({ description: nullIfEmpty(e.target.value.trim()) }) });
    const notes = textarea({ value: task.notes || '', rows: 3, placeholder: 'Notes', onchange: e => set({ notes: nullIfEmpty(e.target.value.trim()) }) });

    const subInput = input({ placeholder: 'Add a subtask', maxlength: 300, aria: { label: 'New subtask' } });
    const subList = h('ul', { class: 'subtasks' }, subtasks.map(s => {
      const cb = h('input', { type: 'checkbox', checked: s.is_completed, aria: { label: `Done: ${s.title}` }, onchange: e => ctx.data.tasks.updateSubtask(s.id, { is_completed: e.target.checked }) });
      const t = input({ value: s.title, class: 'input input-bare', maxlength: 300, aria: { label: 'Subtask title' },
        onchange: e => e.target.value.trim() ? ctx.data.tasks.updateSubtask(s.id, { title: e.target.value }).catch(err => ctx.toast(friendlyError(err).message, { tone: 'bad' })) : null });
      return h('li', { class: ['subtask', s.is_completed && 'is-done'] }, cb, t, button('', { kind: 'ghost', size: 'sm', iconName: 'x', title: 'Remove subtask', onClick: () => ctx.data.tasks.removeSubtask(s.id) }));
    }));
    const addSub = h('form', { class: 'subtask-add', onsubmit: async e => {
      e.preventDefault(); const v = subInput.value.trim(); if (!v) return;
      try { await ctx.data.tasks.addSubtask({ task_id: taskId, title: v, sort_order: subtasks.length }); subInput.value = ''; subInput.blur(); await draw(); body.querySelector('[data-key="sub"]')?.focus(); }
      catch (err) { ctx.toast(friendlyError(err).message, { tone: 'bad' }); }
    } }, icon('plus', { size: 14, cls: 'icon quick-icon' }), subInput);

    // stable keys so focus survives a redraw (field ids are regenerated each time)
    for (const [k, el] of Object.entries({ title, status: statusSel, priority: prioSel, due, project: projSel, milestone: msSel, repeats: ruleSel, desc, notes, sub: subInput })) el.dataset.key = k;
    const focusKey = body.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    mount(body,
      title,
      h('div', { class: 'prop-grid' },
        field('Status', statusSel), field('Priority', prioSel), field('Due date', due),
        field('Project', projSel), field('Milestone', msSel), field('Repeats', ruleSel, { hint: task.recurrence_rule ? `Every ${task.recurrence_interval} ${{ daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', annually: 'year' }[task.recurrence_rule]}${task.recurrence_interval > 1 ? 's' : ''}. Creating the next occurrence is a later server feature.` : null })),
      field('Description', desc, { full: true }),
      h('section', { class: 'panel-section' }, h('h3', { class: 'section-title' }, `Subtasks${subtasks.length ? ` · ${subtasks.filter(s => s.is_completed).length}/${subtasks.length}` : ''}`), subList, addSub),
      field('Notes', notes, { full: true }),
      h('dl', { class: 'meta-list' },
        h('dt', null, 'Created'), h('dd', null, formatDateTime(task.created_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format)),
        h('dt', null, 'Updated'), h('dd', null, formatDateTime(task.updated_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format)),
        task.completed_at && [h('dt', null, 'Completed'), h('dd', null, formatDateTime(task.completed_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format))]),
      h('div', { class: 'panel-foot' }, button('Delete task', { kind: 'danger', size: 'sm', iconName: 'trash', onClick: async () => {
        if (await confirmDialog({ title: 'Delete this task?', body: `“${task.title}” and its ${subtasks.length} subtask(s) will be removed. This can’t be undone.`, confirmLabel: 'Delete', danger: true })) {
          await ctx.data.tasks.remove(taskId); ctx.closePanel(); ctx.toast('Task deleted');
        } } })));
    if (focusKey) body.querySelector(`[data-key="${focusKey}"]`)?.focus();
    title.style.setProperty('height', 'auto'); title.style.setProperty('height', `${title.scrollHeight}px`);
  };
  await draw();
  // Keep the panel in sync with changes made anywhere (list rows, menus, other controls). Never redraw under the
  // founder's cursor while they type; redraw when focus leaves the field instead.
  const typing = () => { const a = document.activeElement; return !!a && body.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type === 'text')); };
  let dirty = false, timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { if (typing()) { dirty = true; return; } dirty = false; draw(); }, 20); };
  off = ctx.bus.on('data:changed', ch => {
    if (!document.body.contains(body)) { off(); return; }
    if (['tasks', 'subtasks', 'milestones', 'projects', '*'].includes(ch.table)) later();
  });
  body.addEventListener('focusout', () => { if (dirty) setTimeout(() => { if (dirty && !typing()) { dirty = false; draw(); } }, 0); });
}

// ---------- page ----------
async function renderTasksPage(ctx, params, query) {
  const view = VIEWS.includes(query.view) ? query.view : 'Open';
  const projectFilter = query.project || '';
  const prioFilter = ENUMS.priority.includes(query.priority) ? query.priority : '';
  const go = q => ctx.navigate('/tasks', Object.fromEntries(Object.entries({ view, project: projectFilter, priority: prioFilter, ...q }).filter(([k, v]) => v && !(k === 'view' && v === 'Open'))));

  const listEl = h('div', { class: 'list-wrap', aria: { live: 'polite' } });
  const tabs = h('div', { class: 'tabs', role: 'tablist', aria: { label: 'Task views' } });
  const projects = await ctx.data.projects.list();
  const projSel = select(projects.filter(p => p.status !== 'Archived').map(p => [p.id, p.name]), { value: projectFilter, placeholder: 'All projects', class: 'input select select-sm', aria: { label: 'Filter by project' }, onchange: e => go({ project: e.target.value }) });
  const prioSel = select(ENUMS.priority, { value: prioFilter, placeholder: 'Any priority', class: 'input select select-sm', aria: { label: 'Filter by priority' }, onchange: e => go({ priority: e.target.value }) });

  const draw = async () => {
    const [tasks, allProjects, milestones, subtasks] = await Promise.all([ctx.data.tasks.list(), ctx.data.projects.list(), ctx.data.milestones.list(), ctx.data.tasks.allSubtasks()]);
    const filtered = tasks.filter(t => (!projectFilter || t.project_id === projectFilter) && (!prioFilter || t.priority === prioFilter));
    const counts = Object.fromEntries(VIEWS.map(v => [v, filtered.filter(t => v === 'Open' ? isOpen(t) : t.status === v).length]));
    mount(tabs, VIEWS.map(v => h('a', { class: ['tab', v === view && 'active'], role: 'tab', aria: { selected: v === view ? 'true' : 'false' },
      href: `#/tasks?${new URLSearchParams(Object.entries({ view: v === 'Open' ? '' : v, project: projectFilter, priority: prioFilter }).filter(([, x]) => x))}` },
      v, h('span', { class: 'tab-count num' }, String(counts[v])))));
    const lookups = { projects: allProjects, milestones, subtasks };
    const visible = sortTasks(filtered.filter(t => view === 'Open' ? isOpen(t) : t.status === view));
    if (view === 'Done') visible.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
    if (!visible.length) {
      mount(listEl, stateBlock('empty', { title: view === 'Open' ? 'Nothing open' : `No tasks in ${view}`,
        body: projectFilter || prioFilter ? 'No tasks match these filters.' : view === 'Inbox' ? 'Capture anything here; sort it later.' : null }));
      return;
    }
    mount(listEl, view === 'Open' ? groupByStatus(ctx, visible, lookups) : h('div', { class: 'rows', role: 'list' }, taskRows(ctx, visible, lookups)));
  };
  await draw();
  let pending = null;
  const off = ctx.bus.on('data:changed', ch => { if (['tasks', 'subtasks', 'projects', 'milestones', '*'].includes(ch.table)) { clearTimeout(pending); pending = setTimeout(draw, 30); } });
  ctx.onLeave(off);

  const page = h('div', { class: 'page' },
    pageHeader({ title: 'Tasks', subtitle: 'Everything you have committed to, by state.', actions: [projSel, prioSel] }),
    quickAdd(ctx, projectFilter ? { project_id: projectFilter } : {}, { placeholder: projectFilter ? 'Add a task to this project’s Inbox' : 'Add a task to Inbox and press Enter' }),
    tabs, listEl);
  if (params.id) queueMicrotask(() => openTaskPanel(ctx, params.id));
  return page;
}

export const tasksModule = {
  routes: [
    { pattern: '/tasks', render: renderTasksPage },
    { pattern: '/tasks/:id', render: renderTasksPage },
  ],
};
