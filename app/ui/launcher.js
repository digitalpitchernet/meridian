// Ctrl/Cmd+K launcher and global quick-create. Searches modules, actions, projects and tasks through the repositories.
import { h, mount } from '../core/dom.js';
import { icon } from './icons.js';
import { TASK_STATUS, PROJECT_STATUS, statusIcon } from './status.js';
import { MODULES } from '../modules/registry.js';
import { openDialog } from './overlay.js';
import { field, input, select, dateInput, setFieldError, nullIfEmpty } from './forms.js';
import { friendlyError } from './errors.js';
import { ENUMS } from '../data/schema.js';
import { projectDialog } from '../modules/projects.js';

import { score } from '../core/search.js';

export function newTaskDialog(ctx, defaults = {}) {
  return (async () => {
    const [allProjects, participants] = await Promise.all([ctx.data.projects.list(), ctx.data.workspace.participants()]);
    const projects = allProjects.filter(p => !['Completed', 'Archived'].includes(p.status));
    const activeParticipants = participants.filter(p => p.is_active);
    const title = input({ maxlength: 300, autofocus: true, placeholder: 'What needs doing?' });
    const project = select(projects.map(p => [p.id, p.name]), { value: defaults.project_id || '', placeholder: 'No project' });
    const milestone = select([], { value: defaults.milestone_id || '', placeholder: project.value ? 'No milestone' : 'Pick a project first', disabled: !project.value });
    const assignee = select(activeParticipants.map(p => [p.id, p.full_name]), { value: defaults.assigned_to_participant_id || '', placeholder: 'Unassigned' });
    const status = select(ENUMS.taskStatus.filter(s => s !== 'Done'), { value: defaults.status && defaults.status !== 'Done' ? defaults.status : 'Inbox' });
    const priority = select(ENUMS.priority, { value: defaults.priority || 'Normal' });
    const due = dateInput({ value: defaults.due_date || '' });

    const refreshMilestones = async (pid, keepVal = '') => {
      if (!pid) {
        mount(milestone, h('option', { value: '' }, 'Pick a project first'));
        milestone.value = '';
        milestone.disabled = true;
        return;
      }
      const ms = await ctx.data.milestones.forProject(pid);
      mount(milestone, [h('option', { value: '' }, 'No milestone'), ...ms.map(m => h('option', { value: m.id }, m.title))]);
      milestone.disabled = false;
      milestone.value = ms.some(m => m.id === keepVal) ? keepVal : '';
    };
    project.addEventListener('change', () => refreshMilestones(project.value));
    if (project.value) await refreshMilestones(project.value, defaults.milestone_id || '');

    const controls = { title, project_id: project, milestone_id: milestone, assigned_to_participant_id: assignee, status, priority, due_date: due };
    openDialog({
      title: 'New task',
      content: h('div', { class: 'form-grid' },
        field('Title', title, { full: true }),
        field('Project', project),
        field('Milestone', milestone),
        field('Assignee', assignee),
        field('Status', status),
        field('Priority', priority),
        field('Due date', due)),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Create task', kind: 'primary', submit: true, run: async () => {
        Object.values(controls).forEach(c => setFieldError(c, ''));
        try {
          const t = await ctx.data.tasks.create({
            title: title.value,
            project_id: nullIfEmpty(project.value),
            milestone_id: nullIfEmpty(milestone.value),
            assigned_to_participant_id: nullIfEmpty(assignee.value),
            status: status.value,
            priority: priority.value,
            due_date: nullIfEmpty(due.value),
          });
          ctx.toast('Task created', { action: { label: 'Open', run: () => ctx.navigate(`/tasks/${t.id}`) } });
        } catch (e) {
          const f = friendlyError(e);
          const ctrl = controls[f.column] || title;
          setFieldError(ctrl, f.message);
          return false;
        }
      } }],
    });
  })();
}

export function installLauncher(ctx) {
  let open = null;
  const actions = [
    { label: 'New task', hint: 'Create', icon: 'plus', run: () => newTaskDialog(ctx) },
    { label: 'New project', hint: 'Create', icon: 'folder', run: () => projectDialog(ctx) },
    { label: 'Theme: dark', hint: 'Appearance', icon: 'moon', run: () => ctx.setTheme('dark') },
    { label: 'Theme: light', hint: 'Appearance', icon: 'sun', run: () => ctx.setTheme('light') },
    { label: 'Theme: system', hint: 'Appearance', icon: 'monitor', run: () => ctx.setTheme('system') },
    // development adapter only: restore the fictional fixtures (there is no equivalent against a real backend)
    ...(ctx.adapter.dev ? [{ label: 'Reset development data', hint: 'Development', icon: 'beaker', run: () => import('./overlay.js').then(async ({ confirmDialog }) => {
      if (await confirmDialog({ title: 'Reset development data?', body: 'Every change made in this browser is discarded and the fictional fixtures are restored. Nothing else is affected.', confirmLabel: 'Reset', danger: true })) {
        ctx.adapter.dev.reset(); location.reload();
      } }) }] : []),
  ];

  async function show() {
    if (open) return;
    const [projects, tasks] = await Promise.all([ctx.data.projects.list(), ctx.data.tasks.list()]);
    const q = input({ class: 'input launcher-input', placeholder: 'Search projects and tasks, or type a command', aria: { label: 'Search', controls: 'launcher-results', autocomplete: 'list' }, role: 'combobox', 'aria-expanded': 'true' });
    const list = h('div', { class: 'launcher-results', id: 'launcher-results', role: 'listbox' });
    let items = [], sel = 0;

    const build = () => {
      const s = q.value;
      const nav = MODULES.map(m => ({ group: 'Go to', label: m.label, hint: m.milestone === 'M1' || m.built ? m.group : `${m.group} · ${m.milestone}`, icon: icon(m.icon, { size: 15 }), run: () => ctx.navigate(m.path), s: score(m.label, s) }));
      const act = actions.map(a => ({ group: 'Actions', label: a.label, hint: a.hint, icon: icon(a.icon, { size: 15 }), run: a.run, s: score(a.label, s) }));
      const proj = projects.map(p => ({ group: 'Projects', label: p.name, hint: p.status, icon: statusIcon(PROJECT_STATUS, p.status, 14), run: () => ctx.navigate(`/projects/${p.id}`), s: s ? score(p.name, s) : -1 }));
      const task = tasks.map(t => ({ group: 'Tasks', label: t.title, hint: t.status, icon: statusIcon(TASK_STATUS, t.status, 14), run: () => ctx.navigate(`/tasks/${t.id}`), s: s ? score(t.title, s) + (t.status === 'Done' ? -0.5 : 0) : -1 }));
      const pick = (arr, n) => arr.filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, n);
      items = s ? [...pick(act, 3), ...pick(proj, 5), ...pick(task, 8), ...pick(nav, 4)] : [...act.slice(0, 2), ...nav];
      sel = 0;
      render();
    };
    const render = () => {
      if (!items.length) { mount(list, h('p', { class: 'launcher-empty' }, 'No matches')); return; }
      let last = null;
      mount(list, items.map((it, i) => [
        it.group !== last && (last = it.group) && h('div', { class: 'launcher-group', role: 'presentation' }, it.group),
        h('div', { class: ['launcher-item', i === sel && 'sel'], role: 'option', id: `lo-${i}`, aria: { selected: i === sel ? 'true' : 'false' },
          onmousemove: () => { if (sel !== i) { sel = i; render(); } }, onclick: () => choose(i) },
          it.icon, h('span', { class: 'launcher-label' }, it.label), it.hint && h('span', { class: 'launcher-hint' }, it.hint))]));
      q.setAttribute('aria-activedescendant', `lo-${sel}`);
      list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    };
    const choose = i => { const it = items[i]; if (!it) return; open.close(); it.run(); };
    q.addEventListener('input', build);
    q.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    });
    open = openDialog({ title: 'Search and commands', content: h('div', { class: 'launcher' }, q, list), size: 'launcher', onClose: () => { open = null; } });
    open.form.classList.add('launcher-dialog');
    build();
  }

  ctx.bus.on('launcher:open', show);
  ctx.bus.on('quick-create', () => {
    // quick-create offers the two creatable M1 records
    const btn = document.querySelector('.topbar .btn-primary');
    import('./overlay.js').then(({ popMenu }) => popMenu(btn, [
      { label: 'New task', value: 'task', icon: icon('checkSquare', { size: 14 }) },
      { label: 'New project', value: 'project', icon: icon('folder', { size: 14 }) }],
      { label: 'Create', onPick: v => (v === 'task' ? newTaskDialog(ctx) : projectDialog(ctx)) }));
  });
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); show(); }
  });
}
