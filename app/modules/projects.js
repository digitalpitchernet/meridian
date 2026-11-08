// Projects module: list with status views, project page (tasks, milestones, activity), create/edit/delete.
import { h, mount } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { button, pageHeader, stateBlock } from '../ui/components.js';
import { PROJECT_STATUS, MILESTONE_STATUS, statusIcon, statusChip, priorityIcon } from '../ui/status.js';
import { popMenu, openDialog, confirmDialog } from '../ui/overlay.js';
import { field, input, textarea, select, dateInput, setFieldError, nullIfEmpty } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { ENUMS } from '../data/schema.js';
import { formatShortDate, relativeDay, daysBetween, timeAgo } from '../core/format.js';
import { projectProgress, isOpen, milestoneOpen, milestoneLate, describeActivity, byPriority } from './projections.js';
import { taskRows, groupByStatus, quickAdd, sortTasks } from './tasks.js';
import { openMilestonePanel, milestoneDialog } from './milestones.js';
import { openContactPanel } from './contacts.js';
import { contactName } from './projections.js';

const VIEWS = ['Current', ...ENUMS.projectStatus, 'All'];
const CURRENT = ['Planning', 'Active', 'On Hold'];
const LIST_ORDER = ['Active', 'Planning', 'On Hold', 'Completed', 'Archived']; // what is moving first

// Interpretation (flagged): the schema grants clients projects.completed_at but has no trigger for it. The app sets it
// when a project moves to Completed and clears it when it leaves Completed, mirroring how tasks behave server-side.
const completionPatch = (from, to) => (to === 'Completed' && from !== 'Completed' ? { completed_at: new Date().toISOString() } : to !== 'Completed' && from === 'Completed' ? { completed_at: null } : {});

async function setStatus(ctx, p, status) {
  try { await ctx.data.projects.update(p.id, { status, ...completionPatch(p.status, status) }); }
  catch (e) { ctx.toast(friendlyError(e).message, { tone: 'bad' }); }
}
function statusMenuButton(ctx, p, { chipStyle = false } = {}) {
  const b = h('button', { type: 'button', class: chipStyle ? 'chip-btn' : 'icon-btn', aria: { label: `Status: ${p.status}. Change status`, haspopup: 'menu', expanded: 'false' },
    onclick: e => { e.stopPropagation(); popMenu(b, ENUMS.projectStatus.map(s => ({ label: s, value: s, icon: statusIcon(PROJECT_STATUS, s, 14) })), { current: p.status, label: 'Project status', onPick: v => v !== p.status && setStatus(ctx, p, v) }); } },
    chipStyle ? statusChip(PROJECT_STATUS, p.status) : statusIcon(PROJECT_STATUS, p.status));
  return b;
}
function priorityMenuButton(ctx, p, withLabel) {
  const b = h('button', { type: 'button', class: withLabel ? 'chip-btn' : 'icon-btn', aria: { label: `${p.priority} priority. Change priority`, haspopup: 'menu', expanded: 'false' },
    onclick: e => { e.stopPropagation(); popMenu(b, [...ENUMS.priority].reverse().map(x => ({ label: x, value: x, icon: priorityIcon(x, 14) })), { current: p.priority, label: 'Priority',
      onPick: v => v !== p.priority && ctx.data.projects.update(p.id, { priority: v }).catch(e2 => ctx.toast(friendlyError(e2).message, { tone: 'bad' })) }); } },
    priorityIcon(p.priority), withLabel && h('span', { class: 'chip-btn-label' }, p.priority));
  return b;
}

function progressBar({ done, total, pct }) {
  return h('div', { class: 'progress', title: `${done} of ${total} tasks done` },
    h('div', { class: 'progress-track', role: 'progressbar', aria: { valuenow: String(pct), valuemin: '0', valuemax: '100', label: 'Task progress' } }, h('span', { class: 'progress-fill', style: { width: `${pct}%` } })),
    h('span', { class: 'progress-text num' }, total ? `${done}/${total}` : '—'));
}

function dateRange(ctx, p) {
  const f = d => formatShortDate(d, ctx.today, ctx.profile.date_format);
  if (!p.start_date && !p.target_date) return null;
  const left = p.target_date && !['Completed', 'Archived'].includes(p.status) ? daysBetween(ctx.today, p.target_date) : null;
  return h('span', { class: ['date-range', left !== null && left < 0 && 'is-late'] },
    p.start_date ? f(p.start_date) : '…', ' → ', p.target_date ? f(p.target_date) : '…',
    left !== null && h('span', { class: 'faint' }, left < 0 ? ` · ${-left}d late` : left === 0 ? ' · due today' : ` · ${left}d left`));
}

// ---------- create / edit dialog ----------
export function projectDialog(ctx, existing = null) {
  const p = existing || {};
  const name = input({ value: p.name || '', maxlength: 200, autofocus: true, required: true });
  const description = textarea({ value: p.description || '', rows: 2, placeholder: 'One or two lines on the outcome' });
  const status = select(ENUMS.projectStatus, { value: p.status || 'Planning' });
  const priority = select(ENUMS.priority, { value: p.priority || 'Normal' });
  const start = dateInput({ value: p.start_date || '' });
  const target = dateInput({ value: p.target_date || '' });
  const notes = textarea({ value: p.notes || '', rows: 2 });
  const controls = { name, description, status, priority, start_date: start, target_date: target, notes };
  openDialog({
    title: existing ? 'Edit project' : 'New project',
    content: h('div', { class: 'form-grid' }, field('Name', name, { full: true }), field('Description', description, { full: true }),
      field('Status', status), field('Priority', priority), field('Start date', start), field('Target date', target), field('Notes', notes, { full: true })),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: existing ? 'Save' : 'Create project', kind: 'primary', submit: true, run: async () => {
      Object.values(controls).forEach(c => setFieldError(c, ''));
      const row = { name: name.value, description: nullIfEmpty(description.value.trim()), status: status.value, priority: priority.value,
        start_date: nullIfEmpty(start.value), target_date: nullIfEmpty(target.value), notes: nullIfEmpty(notes.value.trim()) };
      try {
        if (existing) {
          const patch = Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== existing[k]));
          if (Object.keys(patch).length) await ctx.data.projects.update(existing.id, { ...patch, ...completionPatch(existing.status, row.status) });
        } else {
          const created = await ctx.data.projects.create({ ...row, ...completionPatch(null, row.status) });
          ctx.navigate(`/projects/${created.id}`);
        }
      } catch (e) {
        const f = friendlyError(e); const c = controls[f.column];
        if (c) setFieldError(c, f.message); else ctx.toast(f.message, { tone: 'bad' });
        return false; // keep the dialog open
      }
    } }],
  });
}

async function deleteProject(ctx, p) {
  const [tasks, milestones] = await Promise.all([ctx.data.tasks.forProject(p.id), ctx.data.milestones.forProject(p.id)]);
  const ok = await confirmDialog({ title: `Delete “${p.name}”?`, danger: true, confirmLabel: 'Delete project',
    body: h('div', null,
      h('p', null, 'This can’t be undone.'),
      h('ul', { class: 'plain-list' },
        h('li', null, `${milestones.length} milestone(s) will be deleted with it.`),
        h('li', null, `${tasks.length} task(s) will be kept and moved out of any project.`)),
      h('p', { class: 'muted' }, 'To keep the history instead, set the status to Archived.')) });
  if (!ok) return;
  await ctx.data.projects.remove(p.id);
  ctx.toast('Project deleted'); ctx.navigate('/projects');
}

// ---------- list ----------
async function renderList(ctx, _params, query) {
  const view = VIEWS.includes(query.view) ? query.view : 'Current';
  const tabs = h('div', { class: 'tabs', role: 'tablist', aria: { label: 'Project views' } });
  const listEl = h('div', { class: 'list-wrap' });
  const draw = async () => {
    const [projects, tasks, milestones] = await Promise.all([ctx.data.projects.list(), ctx.data.tasks.list(), ctx.data.milestones.list()]);
    const inView = s => (view === 'All' ? true : view === 'Current' ? CURRENT.includes(s) : s === view);
    mount(tabs, VIEWS.map(v => h('a', { class: ['tab', v === view && 'active'], role: 'tab', aria: { selected: v === view ? 'true' : 'false' }, href: v === 'Current' ? '#/projects' : `#/projects?view=${encodeURIComponent(v)}` },
      v, h('span', { class: 'tab-count num' }, String(projects.filter(p => (v === 'All' ? true : v === 'Current' ? CURRENT.includes(p.status) : p.status === v)).length)))));
    const rows = projects.filter(p => inView(p.status))
      .sort((a, b) => LIST_ORDER.indexOf(a.status) - LIST_ORDER.indexOf(b.status) || byPriority(a, b) || String(a.target_date || '9').localeCompare(String(b.target_date || '9')));
    if (!rows.length) { mount(listEl, stateBlock('empty', { title: `No ${view === 'All' || view === 'Current' ? '' : view.toLowerCase() + ' '}projects`, body: view === 'Current' ? 'Create a project to group tasks and milestones.' : null, action: button('New project', { kind: 'primary', size: 'sm', iconName: 'plus', onClick: () => projectDialog(ctx) }) })); return; }
    mount(listEl, h('div', { class: 'table', role: 'table', aria: { label: 'Projects' } },
      h('div', { class: 'thead', role: 'row' }, ['', 'Project', 'Progress', 'Next milestone', 'Dates', ''].map((t, i) => h('span', { role: 'columnheader', class: `th th-${i}` }, t))),
      rows.map(p => {
        const ptasks = tasks.filter(t => t.project_id === p.id);
        const next = milestones.filter(m => m.project_id === p.id && milestoneOpen(m)).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
        return h('div', { class: ['tr', 'project-row'], role: 'row', dataset: { id: p.id } },
          h('span', { class: 'td td-0', role: 'cell' }, statusMenuButton(ctx, p)),
          h('a', { class: 'td td-1 cell-main', role: 'cell', href: `#/projects/${p.id}` }, h('span', { class: 'row-title' }, p.name), p.description && h('span', { class: 'row-sub' }, p.description)),
          h('span', { class: 'td td-2', role: 'cell' }, progressBar(projectProgress(ptasks))),
          h('span', { class: ['td td-3', next && milestoneLate(next, ctx.today) && 'is-late'], role: 'cell' }, next ? [statusIcon(MILESTONE_STATUS, next.status, 13), h('span', { class: 'ellipsis' }, next.title), h('span', { class: 'faint num' }, formatShortDate(next.due_date, ctx.today, ctx.profile.date_format))] : h('span', { class: 'faint' }, '—')),
          h('span', { class: 'td td-4', role: 'cell' }, dateRange(ctx, p) || h('span', { class: 'faint' }, '—')),
          h('span', { class: 'td td-5', role: 'cell' }, priorityMenuButton(ctx, p)));
      })));
  };
  await draw();
  ctx.onLeave(ctx.bus.on('data:changed', ch => ['projects', 'tasks', 'milestones', '*'].includes(ch.table) && draw()));
  return h('div', { class: 'page' },
    pageHeader({ title: 'Projects', subtitle: 'What you are building, and how far along each piece is.', actions: [button('New project', { kind: 'primary', iconName: 'plus', onClick: () => projectDialog(ctx) })] }),
    tabs, listEl);
}

// ---------- project page ----------
async function renderDetail(ctx, params, _q, _path, setCrumbs) {
  const root = h('div', { class: 'page' });
  const draw = async () => {
    const p = await ctx.data.projects.get(params.id);
    if (!p) { setCrumbs([{ label: 'Not found' }]); mount(root, stateBlock('empty', { title: 'This project doesn’t exist any more', action: h('a', { class: 'link', href: '#/projects' }, 'Back to projects') })); return; }
    setCrumbs([{ label: p.name }]);
    const [tasks, milestones, projects, subtasks, activity, links, contacts] = await Promise.all([ctx.data.tasks.forProject(p.id), ctx.data.milestones.forProject(p.id), ctx.data.projects.list(), ctx.data.tasks.allSubtasks(), ctx.data.activity.recent(200), ctx.data.contacts.links({ eq: { project_id: p.id } }), ctx.data.contacts.list()]);
    const ids = new Set([p.id, ...tasks.map(t => t.id), ...milestones.map(m => m.id)]);
    const related = activity.filter(a => ids.has(a.entity_id)).slice(0, 8);
    const open = sortTasks(tasks.filter(isOpen)), done = tasks.filter(t => !isOpen(t)).sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
    const lookups = { projects, milestones, subtasks };
    mount(root,
      h('header', { class: 'project-head' },
        h('div', { class: 'project-title-row' }, h('h1', { class: 'page-title' }, p.name),
          h('div', { class: 'page-actions' }, button('Edit', { kind: 'secondary', size: 'sm', iconName: 'edit', onClick: () => projectDialog(ctx, p) }), button('', { kind: 'ghost', size: 'sm', iconName: 'trash', title: 'Delete project', onClick: () => deleteProject(ctx, p) }))),
        h('div', { class: 'prop-row' }, statusMenuButton(ctx, p, { chipStyle: true }), priorityMenuButton(ctx, p, true), dateRange(ctx, p), progressBar(projectProgress(tasks))),
        p.description && h('p', { class: 'project-desc' }, p.description),
        p.notes && h('p', { class: 'project-notes muted' }, p.notes)),
      h('div', { class: 'detail-grid' },
        h('section', { class: 'detail-main' },
          h('h2', { class: 'section-title' }, `Tasks · ${open.length} open`),
          quickAdd(ctx, { project_id: p.id }, { placeholder: 'Add a task to this project' }),
          open.length ? groupByStatus(ctx, open, lookups, { showProject: false }) : stateBlock('empty', { title: 'No open tasks', body: tasks.length ? 'Everything here is done.' : 'Add the first task above.' }),
          done.length > 0 && h('details', { class: 'done-fold' }, h('summary', null, `${done.length} done`), h('div', { class: 'rows', role: 'list' }, taskRows(ctx, done, lookups, { showProject: false })))),
        h('aside', { class: 'detail-side' },
          h('section', { class: 'side-block' },
            h('h2', { class: 'section-title' }, 'Milestones'),
            milestones.length ? h('ul', { class: 'milestones' }, milestones.map(m => h('li', { class: ['milestone', 'is-clickable', milestoneLate(m, ctx.today) && 'is-late'], tabindex: '0', role: 'button', aria: { label: `Open milestone ${m.title}` }, onclick: () => openMilestonePanel(ctx, m.id), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMilestonePanel(ctx, m.id); } } },
              statusIcon(MILESTONE_STATUS, m.status, 14),
              h('div', { class: 'milestone-text' }, h('span', { class: 'milestone-title' }, m.title),
                h('span', { class: 'faint num' }, `${formatShortDate(m.due_date, ctx.today, ctx.profile.date_format)}${milestoneOpen(m) ? ` · ${relativeDay(m.due_date, ctx.today) || (m.due_date < ctx.today ? `${daysBetween(m.due_date, ctx.today)}d late` : `in ${daysBetween(ctx.today, m.due_date)}d`)}` : ` · ${m.status}`}`)))))
              : h('p', { class: 'faint small' }, 'No milestones yet.'),
            button('Add milestone', { kind: 'ghost', size: 'sm', iconName: 'plus', onClick: () => milestoneDialog(ctx, null, { project_id: p.id }) })),
          h('section', { class: 'side-block' },
            h('h2', { class: 'section-title' }, `People · ${links.length}`),
            links.length ? h('ul', { class: 'milestones' }, links.map(l => { const c = contacts.find(x => x.id === l.contact_id); return c && h('li', { class: ['milestone', 'is-clickable'], tabindex: '0', role: 'button', aria: { label: `Open contact ${contactName(c)}` }, onclick: () => openContactPanel(ctx, c.id), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openContactPanel(ctx, c.id); } } }, h('div', { class: 'milestone-text' }, h('span', { class: 'milestone-title' }, contactName(c)), h('span', { class: 'faint num' }, [l.relationship_role, c.organization].filter(Boolean).join(' · ') || c.category))); }))
              : h('p', { class: 'faint small' }, 'No contacts linked. Link them from a contact.')),
          h('section', { class: 'side-block' },
            h('h2', { class: 'section-title' }, 'Recent activity'),
            related.length ? h('ul', { class: 'activity' }, related.map(a => { const d = describeActivity(a); return h('li', null, h('span', null, `${d.verb} ${d.noun} `, h('strong', null, d.label), d.status ? ` → ${d.status}` : ''), h('span', { class: 'faint' }, timeAgo(a.created_at))); }))
              : h('p', { class: 'faint small' }, 'Nothing yet.')))));
  };
  await draw();
  let timer = null;
  ctx.onLeave(ctx.bus.on('data:changed', ch => {
    if (!['projects', 'tasks', 'milestones', 'subtasks', 'project_contacts', 'contacts', '*'].includes(ch.table)) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const a = document.activeElement;
      if (a && root.contains(a) && a.classList.contains('quick-input') && a.value) return; // mid-typing: redraw after submit
      const keepQuick = a && root.contains(a) && a.classList.contains('quick-input');
      await draw();
      if (keepQuick) root.querySelector('.quick-input')?.focus();
    }, 30);
  }));
  return root;
}

export const projectsModule = {
  routes: [
    { pattern: '/projects', render: renderList },
    { pattern: '/projects/:id', render: renderDetail },
  ],
};
