// Contacts module: a directory, not a CRM. Search, category filter, create/edit/delete, project links with a role.
// Schema (Gate 1): first_name, last_name, organization, role, email, phone, category, notes; project_contacts.
// There is no archive flag on contacts, so "archive" is not offered (flagged in app/README.md); delete is.
import { h, mount } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { button, pageHeader, stateBlock, avatar, chip } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/overlay.js';
import { field, input, textarea, select, setFieldError, nullIfEmpty } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { ENUMS } from '../data/schema.js';
import { formatDateTime } from '../core/format.js';
import { contactName, contactMatches } from './projections.js';

const CATEGORY_TONE = { Investor: 'accent', Client: 'ok', Partner: 'info', Vendor: 'idle', Advisor: 'warn', Collaborator: 'info', Other: 'idle' };

export async function contactDialog(ctx, existing = null) {
  const c = existing || {};
  const f = {
    first_name: input({ value: c.first_name || '', maxlength: 120, autofocus: true }), last_name: input({ value: c.last_name || '' }),
    organization: input({ value: c.organization || '' }), role: input({ value: c.role || '' }),
    email: input({ value: c.email || '', type: 'email', inputmode: 'email' }), phone: input({ value: c.phone || '', type: 'tel' }),
    category: select(ENUMS.contactCategory, { value: c.category || 'Other' }), notes: textarea({ value: c.notes || '', rows: 3 }),
  };
  openDialog({ title: existing ? 'Edit contact' : 'New contact',
    content: h('div', { class: 'form-grid' }, field('First name', f.first_name), field('Last name', f.last_name), field('Organisation', f.organization), field('Role', f.role),
      field('Email', f.email), field('Phone', f.phone), field('Category', f.category), field('Notes', f.notes, { full: true })),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: existing ? 'Save' : 'Add contact', kind: 'primary', submit: true, run: async () => {
      Object.values(f).forEach(x => setFieldError(x, ''));
      const row = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, k === 'first_name' || k === 'category' ? el.value : nullIfEmpty(el.value.trim())]));
      try {
        if (existing) { const patch = Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== existing[k])); if (Object.keys(patch).length) await ctx.data.contacts.update(existing.id, patch); }
        else { const created = await ctx.data.contacts.create(row); ctx.navigate(`/contacts/${created.id}`); }
      } catch (e) { const fe = friendlyError(e); if (f[fe.column]) setFieldError(f[fe.column], fe.message); else ctx.toast(fe.message, { tone: 'bad' }); return false; }
    } }] });
}

async function deleteContact(ctx, c) {
  const [links, decisions, events] = await Promise.all([ctx.data.contacts.links({ eq: { contact_id: c.id } }), ctx.data.decisions.list({ eq: { contact_id: c.id } }), ctx.data.calendar.list({ eq: { contact_id: c.id } })]);
  const ok = await confirmDialog({ title: `Delete ${contactName(c)}?`, danger: true, confirmLabel: 'Delete contact',
    body: h('div', null, h('p', null, 'This can’t be undone. Contacts have no archive state in V1.'), h('ul', { class: 'plain-list' },
      h('li', null, `${links.length} project link(s) are removed.`),
      h('li', null, `${decisions.length} decision(s) and ${events.length} calendar event(s) are kept; their contact is cleared.`))) });
  if (!ok) return false;
  await ctx.data.contacts.remove(c.id); ctx.toast('Contact deleted');
  return true;
}

export async function openContactPanel(ctx, id) {
  const body = h('div', { class: 'panel-body' }, stateBlock('loading'));
  ctx.openPanel(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('span', { class: 'panel-kicker' }, 'Contact'),
    button('', { kind: 'ghost', size: 'sm', iconName: 'x', title: 'Close panel', onClick: () => ctx.closePanel() })), body),
    { label: 'Contact details', onClose: () => { if (/^#\/contacts\/[^/?]+/.test(location.hash)) history.replaceState(null, '', '#/contacts'); } });
  const draw = async () => {
    const c = await ctx.data.contacts.get(id);
    if (!c) { mount(body, stateBlock('empty', { title: 'This contact no longer exists' })); return; }
    const [links, projects, decisions] = await Promise.all([ctx.data.contacts.links({ eq: { contact_id: id } }), ctx.data.projects.list(), ctx.data.decisions.list({ eq: { contact_id: id } })]);
    const pmap = new Map(projects.map(p => [p.id, p]));
    const linkable = projects.filter(p => !links.some(l => l.project_id === p.id) && p.status !== 'Archived');
    const projSel = select(linkable.map(p => [p.id, p.name]), { value: '', placeholder: linkable.length ? 'Link to a project…' : 'Linked to every project', disabled: !linkable.length, class: 'input select select-sm', aria: { label: 'Project to link' } });
    const roleIn = input({ placeholder: 'Role (optional)', class: 'input', maxlength: 120, aria: { label: 'Role on the project' } });
    const detail = (label, value, href) => value ? [h('dt', null, label), h('dd', null, href ? h('a', { class: 'link', href }, value) : value)] : null;
    mount(body,
      h('div', { class: 'contact-head' }, avatar(contactName(c), { size: 40 }), h('div', null, h('h2', { class: 'ms-title' }, contactName(c)),
        h('p', { class: 'muted small' }, [c.role, c.organization].filter(Boolean).join(' · ') || '—')), chip(c.category, { tone: CATEGORY_TONE[c.category] })),
      h('dl', { class: 'meta-list detail-list' }, detail('Email', c.email, c.email && `mailto:${c.email}`), detail('Phone', c.phone, c.phone && `tel:${c.phone.replace(/\s/g, '')}`),
        detail('Organisation', c.organization), detail('Role', c.role), detail('Added', formatDateTime(c.created_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format))),
      c.notes && h('p', { class: 'contact-notes' }, c.notes),
      h('section', { class: 'panel-section' }, h('h3', { class: 'section-title' }, `Projects · ${links.length}`),
        links.length ? h('ul', { class: 'link-list' }, links.map(l => h('li', null,
          h('a', { class: 'link-main', href: `#/projects/${l.project_id}` }, pmap.get(l.project_id)?.name ?? 'Unknown project'),
          input({ value: l.relationship_role || '', placeholder: 'Role', class: 'input input-bare role-input', maxlength: 120, aria: { label: `Role on ${pmap.get(l.project_id)?.name}` },
            onchange: e => ctx.data.contacts.setRole(l.project_id, id, nullIfEmpty(e.target.value.trim())).catch(err => ctx.toast(friendlyError(err).message, { tone: 'bad' })) }),
          button('', { kind: 'ghost', size: 'sm', iconName: 'x', title: `Unlink from ${pmap.get(l.project_id)?.name}`, onClick: () => ctx.data.contacts.unlink(l.project_id, id) }))))
          : h('p', { class: 'faint small' }, 'Not linked to any project.'),
        h('form', { class: 'link-add', onsubmit: async e => { e.preventDefault(); if (!projSel.value) return;
          try { await ctx.data.contacts.link(projSel.value, id, nullIfEmpty(roleIn.value.trim())); } catch (err) { ctx.toast(friendlyError(err).message, { tone: 'bad' }); } } },
          projSel, roleIn, button('Link', { kind: 'secondary', size: 'sm', type: 'submit', disabled: !linkable.length }))),
      decisions.length > 0 && h('section', { class: 'panel-section' }, h('h3', { class: 'section-title' }, `Decisions · ${decisions.length}`),
        h('ul', { class: 'link-list' }, decisions.map(d => h('li', null, h('a', { class: 'link-main', href: `#/decisions/${d.id}` }, d.title), h('span', { class: 'faint small' }, d.status))))),
      h('div', { class: 'panel-foot row-actions' }, button('Edit', { kind: 'secondary', size: 'sm', iconName: 'edit', onClick: () => contactDialog(ctx, c) }),
        button('Delete', { kind: 'danger', size: 'sm', iconName: 'trash', onClick: async () => { if (await deleteContact(ctx, c)) ctx.closePanel(); } })));
  };
  await draw();
  const off = ctx.bus.on('data:changed', ch => {
    if (!document.body.contains(body)) { off(); return; }
    const a = document.activeElement;
    if (['contacts', 'project_contacts', 'projects', 'decisions', '*'].includes(ch.table) && !(a && body.contains(a) && a.tagName === 'INPUT' && a.value)) draw();
  });
}

async function renderContacts(ctx, params, query) {
  const cat = ENUMS.contactCategory.includes(query.category) ? query.category : '';
  const search = input({ type: 'search', value: query.q || '', placeholder: 'Search name, organisation, role or email', class: 'input search-input', aria: { label: 'Search contacts' } });
  const tabs = h('div', { class: 'tabs', role: 'tablist', aria: { label: 'Contact categories' } });
  const listEl = h('div', { class: 'list-wrap', aria: { live: 'polite' } });
  const draw = async () => {
    const [contacts, links] = await Promise.all([ctx.data.contacts.list(), ctx.data.contacts.links()]);
    const q = search.value.trim();
    const matched = contacts.filter(c => !q || contactMatches(c, q));
    mount(tabs, ['', ...ENUMS.contactCategory].map(v => h('a', { class: ['tab', v === cat && 'active'], role: 'tab', aria: { selected: v === cat ? 'true' : 'false' },
      href: `#/contacts?${new URLSearchParams(Object.entries({ category: v, q }).filter(([, x]) => x))}` }, v || 'All', h('span', { class: 'tab-count num' }, String(matched.filter(c => !v || c.category === v).length)))));
    const rows = matched.filter(c => !cat || c.category === cat);
    if (!rows.length) { mount(listEl, stateBlock('empty', { title: q ? `No contacts match “${q}”` : 'No contacts here yet', action: !q && button('Add contact', { kind: 'primary', size: 'sm', iconName: 'plus', onClick: () => contactDialog(ctx) }) })); return; }
    mount(listEl, h('div', { class: 'rows', role: 'list' }, rows.map(c => {
      const n = links.filter(l => l.contact_id === c.id).length;
      return h('div', { class: 'row contact-row', role: 'listitem' }, avatar(contactName(c), { size: 26 }),
        h('button', { type: 'button', class: 'row-main contact-main', onclick: () => openContactPanel(ctx, c.id) },
          h('span', { class: 'row-title' }, contactName(c)), h('span', { class: 'row-sub' }, [c.role, c.organization].filter(Boolean).join(' · '))),
        h('div', { class: 'row-meta' }, c.email && h('a', { class: 'contact-email', href: `mailto:${c.email}` }, c.email),
          n > 0 && h('span', { class: 'subcount', title: 'Linked projects' }, icon('folder', { size: 12 }), String(n)), chip(c.category, { tone: CATEGORY_TONE[c.category] })));
    })));
  };
  let t = null;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { draw(); history.replaceState(null, '', `#/contacts?${new URLSearchParams(Object.entries({ category: cat, q: search.value.trim() }).filter(([, v]) => v))}`); }, 120); });
  await draw();
  ctx.onLeave(ctx.bus.on('data:changed', ch => ['contacts', 'project_contacts', '*'].includes(ch.table) && draw()));
  if (params.id) queueMicrotask(() => openContactPanel(ctx, params.id));
  return h('div', { class: 'page' },
    pageHeader({ title: 'Contacts', subtitle: 'The people and organisations around the business.', actions: [button('Add contact', { kind: 'primary', iconName: 'plus', onClick: () => contactDialog(ctx) })] }),
    search, tabs, listEl);
}

export const contactsModule = { routes: [{ pattern: '/contacts', render: renderContacts }, { pattern: '/contacts/:id', render: renderContacts }] };
