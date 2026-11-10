// Decisions module: a register of decisions with context, options, outcome, rationale and supersession.
// Schema (Gate 1): decisions (title, context, problem, rationale, status, decision_date, review_date, project_id,
// contact_id, selected_option_id, superseded_by_id) and decision_options (title, description, pros, cons, sort_order).
// History rules (app-level, flagged): decided records are read-only; course changes are recorded by superseding.
import { h, mount } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { button, pageHeader, stateBlock, chip } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/overlay.js';
import { field, input, textarea, select, dateInput, setFieldError, nullIfEmpty } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { ENUMS } from '../data/schema.js';
import { formatShortDate, formatDate, daysBetween } from '../core/format.js';
import { decisionEditable, canSupersede, reviewState, decisionMatches, contactName } from './projections.js';

const TONE = { Proposed: 'info', Approved: 'ok', Superseded: 'idle', Rejected: 'bad' };
const statusChip = s => chip(s, { tone: TONE[s] });

function reviewLabel(ctx, d) {
  const st = reviewState(d, ctx.today); if (!st) return null;
  const n = daysBetween(ctx.today, d.review_date);
  return h('span', { class: ['review', `review-${st}`], title: `Review on ${d.review_date}` }, icon('clock', { size: 12 }),
    st === 'due' ? (n === 0 ? 'Review today' : `Review ${-n}d overdue`) : `Review ${formatShortDate(d.review_date, ctx.today, ctx.profile.date_format)}`);
}

// ---------- dialogs ----------
async function pickers(ctx, d) {
  const [projects, contacts] = await Promise.all([ctx.data.projects.list(), ctx.data.contacts.list()]);
  return {
    project: select(projects.filter(p => p.status !== 'Archived' || p.id === d.project_id).map(p => [p.id, p.name]), { value: d.project_id || '', placeholder: 'No project' }),
    contact: select(contacts.map(c => [c.id, contactName(c)]), { value: d.contact_id || '', placeholder: 'No contact' }),
  };
}

export async function decisionDialog(ctx, existing = null) {
  const d = existing || {};
  const { project, contact } = await pickers(ctx, d);
  const f = { title: input({ value: d.title || '', maxlength: 300, autofocus: true }), context: textarea({ value: d.context || '', rows: 3, placeholder: 'What is the situation?' }),
    problem: textarea({ value: d.problem || '', rows: 2, placeholder: 'What exactly needs deciding?' }), review_date: dateInput({ value: d.review_date || '' }), project_id: project, contact_id: contact };
  const optionsBox = textarea({ rows: 3, placeholder: 'One option per line (you can add pros and cons later)' });
  openDialog({ title: existing ? 'Edit proposed decision' : 'New decision',
    content: h('div', { class: 'form-grid' }, field('Title', f.title, { full: true }), field('Context', f.context, { full: true }), field('The question', f.problem, { full: true }),
      !existing && field('Options', optionsBox, { full: true }), field('Project', project), field('Contact', contact), field('Review date', f.review_date, { hint: 'Optional: when to revisit it.' })),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: existing ? 'Save' : 'Propose decision', kind: 'primary', submit: true, run: async () => {
      Object.values(f).forEach(x => setFieldError(x, ''));
      const row = { title: f.title.value, context: f.context.value.trim(), problem: f.problem.value.trim(), review_date: nullIfEmpty(f.review_date.value), project_id: nullIfEmpty(project.value), contact_id: nullIfEmpty(contact.value) };
      try {
        if (existing) await ctx.data.decisions.update(existing.id, Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== existing[k])));
        else {
          const created = await ctx.data.decisions.create({ ...row, status: 'Proposed' });
          for (const [i, t] of optionsBox.value.split('\n').map(s => s.trim()).filter(Boolean).entries()) await ctx.data.decisions.addOption({ decision_id: created.id, title: t, sort_order: i });
          ctx.navigate(`/decisions/${created.id}`);
        }
      } catch (e) { const fe = friendlyError(e); if (f[fe.column]) setFieldError(f[fe.column], fe.message); else ctx.toast(fe.message, { tone: 'bad' }); return false; }
    } }] });
}

async function outcomeDialog(ctx, d, options) {
  const choice = select([...options.map(o => [o.id, `Approve: ${o.title}`]), ['__reject', 'Reject this proposal']], { value: options[0]?.id || '__reject' });
  const rationale = textarea({ rows: 4, value: d.rationale || '', placeholder: 'Why this outcome? This is what future you will read.', autofocus: true });
  const date = dateInput({ value: ctx.today });
  openDialog({ title: 'Record the outcome', description: 'Once recorded, the decision is kept as it is. To change course later, supersede it with a new decision.',
    content: h('div', { class: 'form-grid' }, field('Outcome', choice, { full: true, hint: options.length ? null : 'No options were listed, so this proposal can only be rejected; add options first to approve one.' }),
      field('Rationale', rationale, { full: true }), field('Decided on', date)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Record outcome', kind: 'primary', submit: true, run: async () => {
      setFieldError(rationale, '');
      try { await ctx.data.decisions.decide(d.id, { status: choice.value === '__reject' ? 'Rejected' : 'Approved', selected_option_id: choice.value === '__reject' ? null : choice.value, rationale: rationale.value.trim(), decision_date: nullIfEmpty(date.value) }); }
      catch (e) { setFieldError(rationale, e.code === '23502' ? 'Write down why. A decision without a rationale is hard to revisit.' : friendlyError(e).message); return false; }
    } }] });
}

async function supersedeDialog(ctx, d) {
  const title = input({ value: d.title, maxlength: 300, autofocus: true });
  const context = textarea({ rows: 3, placeholder: 'What changed since the original decision?' });
  const outcome = input({ maxlength: 300, placeholder: 'The new choice' });
  const alts = textarea({ rows: 2, placeholder: 'Other options considered, one per line (optional)' });
  const rationale = textarea({ rows: 3, placeholder: 'Why the new choice?' });
  const review = dateInput();
  openDialog({ title: 'Supersede this decision', description: `“${d.title}” stays in the register unchanged, marked Superseded, with a link to the new decision.`,
    content: h('div', { class: 'form-grid' }, field('New decision title', title, { full: true }), field('What changed', context, { full: true }), field('New outcome', outcome, { full: true }),
      field('Other options considered', alts, { full: true }), field('Rationale', rationale, { full: true }), field('Review date', review)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Supersede', kind: 'primary', submit: true, run: async () => {
      [title, outcome, rationale].forEach(x => setFieldError(x, ''));
      if (!outcome.value.trim()) { setFieldError(outcome, 'State the new outcome.'); return false; }
      if (!rationale.value.trim()) { setFieldError(rationale, 'Write down why the decision changed.'); return false; }
      try {
        const { created } = await ctx.data.decisions.supersede(d.id, { title: title.value, context: context.value.trim(), problem: d.problem, rationale: rationale.value.trim(), review_date: nullIfEmpty(review.value) },
          { outcome: outcome.value.trim(), alternatives: alts.value.split('\n') });
        ctx.navigate(`/decisions/${created.id}`);
      } catch (e) { const fe = friendlyError(e); setFieldError(fe.column === 'title' ? title : outcome, fe.message); return false; }
    } }] });
}

// ---------- decision page ----------
async function renderDecision(ctx, params, _q, _path, setCrumbs) {
  const root = h('div', { class: 'page page-narrow decision-page' });
  const draw = async () => {
    const d = await ctx.data.decisions.get(params.id);
    if (!d) { setCrumbs([{ label: 'Not found' }]); mount(root, stateBlock('empty', { title: 'This decision doesn’t exist', action: h('a', { class: 'link', href: '#/decisions' }, 'Back to the register') })); return; }
    setCrumbs([{ label: d.title }]);
    const [options, all, project, contact, history] = await Promise.all([ctx.data.decisions.options(d.id), ctx.data.decisions.list(), d.project_id ? ctx.data.projects.get(d.project_id) : null, d.contact_id ? ctx.data.contacts.get(d.contact_id) : null, ctx.data.decisions.history(d.id)]);
    const newer = d.superseded_by_id ? all.find(x => x.id === d.superseded_by_id) : null;
    const editable = decisionEditable(d);
    const text = (label, value) => value ? h('section', { class: 'dec-section' }, h('h2', { class: 'section-title' }, label), h('p', { class: 'dec-text' }, value)) : null;
    mount(root,
      newer && h('div', { class: 'banner banner-superseded', role: 'note' }, icon('arrowRight', { size: 14 }), h('span', null, 'Superseded by ', h('a', { class: 'link', href: `#/decisions/${newer.id}` }, newer.title),
        ` (${formatDate(newer.decision_date, ctx.profile.date_format)}). This record is kept as it was decided.`)),
      h('header', { class: 'project-head' },
        h('div', { class: 'project-title-row' }, h('h1', { class: 'page-title' }, d.title), h('div', { class: 'page-actions' },
          editable && button('Edit', { kind: 'secondary', size: 'sm', iconName: 'edit', onClick: () => decisionDialog(ctx, d) }),
          editable && button('Record outcome', { kind: 'primary', size: 'sm', iconName: 'check', onClick: () => outcomeDialog(ctx, d, options) }),
          canSupersede(d) && button('Supersede', { kind: 'secondary', size: 'sm', iconName: 'refresh', onClick: () => supersedeDialog(ctx, d) }),
          editable && button('', { kind: 'ghost', size: 'sm', iconName: 'trash', title: 'Delete proposal', onClick: async () => {
            if (await confirmDialog({ title: 'Delete this proposal?', body: 'Only undecided proposals can be deleted. Its options are deleted with it.', confirmLabel: 'Delete', danger: true })) { await ctx.data.decisions.remove(d.id); ctx.navigate('/decisions'); }
          } }))),
        h('div', { class: 'prop-row' }, statusChip(d.status), h('span', { class: 'faint small' }, `${d.status === 'Proposed' ? 'Proposed' : 'Decided'} ${formatDate(d.decision_date, ctx.profile.date_format)}`),
          project && h('a', { class: 'proj-tag', href: `#/projects/${project.id}` }, project.name), contact && h('a', { class: 'proj-tag', href: `#/contacts/${contact.id}` }, contactName(contact)), reviewLabel(ctx, d))),
      text('Context', d.context), text('The question', d.problem),
      h('section', { class: 'dec-section' }, h('h2', { class: 'section-title' }, `Options · ${options.length}`),
        options.length ? h('div', { class: 'options' }, options.map(o => optionCard(ctx, d, o, editable))) : h('p', { class: 'faint small' }, 'No options listed.'),
        editable && addOptionForm(ctx, d, options.length)),
      text('Rationale', d.rationale) || (d.status !== 'Proposed' && h('p', { class: 'faint small' }, 'No rationale was recorded.')),
      (history.length || newer) && h('section', { class: 'dec-section' }, h('h2', { class: 'section-title' }, 'Decision history'),
        h('ol', { class: 'chain' },
          newer && h('li', null, h('a', { class: 'link', href: `#/decisions/${newer.id}` }, newer.title), h('span', { class: 'faint small' }, ` · ${newer.status} · newer`)),
          h('li', { class: 'chain-current' }, h('strong', null, d.title), h('span', { class: 'faint small' }, ` · ${d.status} · this record`)),
          history.map(x => h('li', null, h('a', { class: 'link', href: `#/decisions/${x.id}` }, x.title), h('span', { class: 'faint small' }, ` · ${x.status} · ${formatDate(x.decision_date, ctx.profile.date_format)}`))))));
  };
  await draw();
  ctx.onLeave(ctx.bus.on('data:changed', ch => {
    const a = document.activeElement;
    if (['decisions', 'decision_options', 'projects', 'contacts', '*'].includes(ch.table) && !(a && root.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.value)) draw();
  }));
  return root;
}

function optionCard(ctx, d, o, editable) {
  const chosen = d.selected_option_id === o.id;
  const set = patch => ctx.data.decisions.updateOption(o.id, patch).catch(e => ctx.toast(friendlyError(e).message, { tone: 'bad' }));
  const area = (key, label) => editable ? textarea({ value: o[key] || '', rows: 2, placeholder: label, class: 'input textarea opt-text', aria: { label: `${label} for ${o.title}` }, onchange: e => set({ [key]: nullIfEmpty(e.target.value.trim()) }) })
    : o[key] ? h('p', { class: 'opt-text-ro' }, o[key]) : null;
  return h('article', { class: ['option', chosen && 'is-chosen'] },
    h('header', { class: 'option-head' }, chosen && chip('Chosen', { tone: 'ok' }), h('strong', null, o.title),
      editable && button('', { kind: 'ghost', size: 'sm', iconName: 'x', title: `Remove option ${o.title}`, onClick: () => ctx.data.decisions.removeOption(o.id) })),
    h('div', { class: 'option-grid' }, h('div', null, h('span', { class: 'opt-label fg-ok' }, 'Pros'), area('pros', 'Pros')), h('div', null, h('span', { class: 'opt-label fg-bad' }, 'Cons'), area('cons', 'Cons'))));
}

function addOptionForm(ctx, d, count) {
  const t = input({ placeholder: 'Add an option', maxlength: 300, class: 'input quick-input', aria: { label: 'New option' } });
  return h('form', { class: 'quick-add', onsubmit: async e => { e.preventDefault(); if (!t.value.trim()) return;
    try { await ctx.data.decisions.addOption({ decision_id: d.id, title: t.value.trim(), sort_order: count }); t.value = ''; } catch (err) { ctx.toast(friendlyError(err).message, { tone: 'bad' }); } } },
    icon('plus', { size: 14, cls: 'icon quick-icon' }), t);
}

// ---------- register ----------
async function renderRegister(ctx, _params, query) {
  const views = ['All', ...ENUMS.decisionStatus];
  const view = views.includes(query.status) ? query.status : 'All';
  const search = input({ type: 'search', value: query.q || '', placeholder: 'Search titles, context, questions and rationale', class: 'input search-input', aria: { label: 'Search decisions' } });
  const tabs = h('div', { class: 'tabs', role: 'tablist', aria: { label: 'Decision status' } });
  const listEl = h('div', { class: 'list-wrap', aria: { live: 'polite' } });
  const draw = async () => {
    const [all, projects] = await Promise.all([ctx.data.decisions.list(), ctx.data.projects.list()]);
    const q = search.value.trim(); const matched = all.filter(d => !q || decisionMatches(d, q));
    mount(tabs, views.map(v => h('a', { class: ['tab', v === view && 'active'], role: 'tab', aria: { selected: v === view ? 'true' : 'false' },
      href: `#/decisions?${new URLSearchParams(Object.entries({ status: v === 'All' ? '' : v, q }).filter(([, x]) => x))}` }, v, h('span', { class: 'tab-count num' }, String(matched.filter(d => v === 'All' || d.status === v).length)))));
    const rows = matched.filter(d => view === 'All' || d.status === view);
    if (!rows.length) { mount(listEl, stateBlock('empty', { title: q ? `No decisions match “${q}”` : 'No decisions here yet', action: !q && button('New decision', { kind: 'primary', size: 'sm', iconName: 'plus', onClick: () => decisionDialog(ctx) }) })); return; }
    const byId = new Map(all.map(d => [d.id, d])), pmap = new Map(projects.map(p => [p.id, p]));
    mount(listEl, h('div', { class: 'rows', role: 'list' }, rows.map(d => {
      const supersedes = all.find(x => x.superseded_by_id === d.id);
      return h('div', { class: ['row', 'dec-row', d.status === 'Superseded' && 'is-superseded'], role: 'listitem' },
        statusChip(d.status),
        h('a', { class: 'row-main dec-main', href: `#/decisions/${d.id}` }, h('span', { class: 'row-title' }, d.title),
          h('span', { class: 'row-sub' }, d.superseded_by_id ? `Superseded by: ${byId.get(d.superseded_by_id)?.title ?? '—'}` : supersedes ? `Supersedes: ${supersedes.title}` : d.problem)),
        h('div', { class: 'row-meta' }, pmap.get(d.project_id) && h('span', { class: 'proj-tag' }, pmap.get(d.project_id).name), reviewLabel(ctx, d),
          h('span', { class: 'num' }, formatShortDate(d.decision_date, ctx.today, ctx.profile.date_format))));
    })));
  };
  let t = null;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 120); });
  await draw();
  ctx.onLeave(ctx.bus.on('data:changed', ch => ['decisions', 'projects', '*'].includes(ch.table) && draw()));
  return h('div', { class: 'page' },
    pageHeader({ title: 'Decisions', subtitle: 'What was decided, why, and what replaced it.', actions: [button('New decision', { kind: 'primary', iconName: 'plus', onClick: () => decisionDialog(ctx) })] }),
    search, tabs, listEl);
}

export const decisionsModule = { routes: [{ pattern: '/decisions', render: renderRegister }, { pattern: '/decisions/:id', render: renderDecision }] };
