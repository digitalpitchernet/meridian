// Company Vault (M4.2). Gate 1 migration 6: documents (archive-only, versioned through previous_version_id) and
// document_links (one supported record per link). This build stores NO file bytes: no Supabase Storage, no Google Drive,
// no external provider. Every document here is metadata only, and the screens never offer a download.
import { h, mount } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { button, pageHeader, stateBlock, chip } from '../ui/components.js';
import { openDialog } from '../ui/overlay.js';
import { field, input, select, setFieldError } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { formatDate, formatShortDate, formatDateTime } from '../core/format.js';
import { sha256Bytes } from '../data/sha256.js';
import { VAULT_ENUMS, LINK_TARGETS } from '../data/schema-vault.js';
import { LINK_KINDS, linkTarget, vaultRows, docMatches, fmtSize, SORTS } from './vault-model.js';
import { contactName } from './projections.js';

const MAX_BYTES = 52428800; // documents.size_bytes CHECK and the company-vault bucket limit (50 MB)
const TABLES = ['documents', 'document_links', 'projects', 'milestones', 'tasks', 'decisions', 'contacts', 'transactions', 'funding_commitments', 'funding_requirements', '*'];

// names of every record a document can link to, keyed by link column
async function targets(ctx) {
  const [projects, milestones, tasks, decisions, contacts, transactions, commitments, requirements] = await Promise.all([ctx.data.projects.list(), ctx.data.milestones.list(),
    ctx.data.tasks.list(), ctx.data.decisions.list(), ctx.data.contacts.list(), ctx.data.transactions.list(), ctx.data.funding.commitments(), ctx.data.funding.requirements()]);
  const opt = (list, name, idKey = 'id') => list.map(x => [x[idKey], name(x)]);
  return {
    project_id: opt(projects, p => p.name), milestone_id: opt(milestones, m => m.title), task_id: opt(tasks, t => t.title), decision_id: opt(decisions, d => d.title),
    contact_id: opt(contacts, contactName), transaction_id: opt(transactions.filter(t => !t.is_reversed), t => `${t.description} (${t.transaction_date})`),
    commitment_id: opt(commitments, c => `${c.funder_name}${c.status === 'revoked' ? ' (revoked)' : ''}`, 'commitment_id'), requirement_id: opt(requirements, r => r.title),
  };
}
const nameOf = (names, l) => { const { column, id } = linkTarget(l); return names[column]?.find(([v]) => v === id)?.[1] ?? 'Unknown record'; };

const metadataOnly = ctx => !ctx.data.documents.filesStored && h('div', { class: 'banner banner-dev', role: 'note' }, icon('beaker', { size: 14 }),
  h('span', null, h('strong', null, 'Metadata only. '), 'This development build stores no files: these are fictional document records, and nothing here can be opened or downloaded.'));

// Read a local file IN THIS BROWSER ONLY, for its name, type, size and SHA-256. The bytes are not uploaded or kept.
function fileMetaField() {
  const el = h('input', { type: 'file', class: 'input' });
  let meta = null;
  const facts = h('p', { class: 'field-hint' }, 'The file is read here only to record its name, type, size and SHA-256. It is not uploaded or stored anywhere.');
  el.addEventListener('change', async () => {
    meta = null; setFieldError(el, '');
    const f = el.files?.[0]; if (!f) return;
    if (f.size > MAX_BYTES) { setFieldError(el, 'Files are limited to 50 MB.'); return; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    meta = { original_filename: f.name.slice(0, 255), mime_type: f.type || 'application/octet-stream', size_bytes: f.size, sha256: sha256Bytes(bytes) };
    facts.textContent = `${fmtSize(f.size)} · ${meta.mime_type} · SHA-256 ${meta.sha256.slice(0, 16)}… Not uploaded.`;
  });
  return { el, facts, get meta() { return meta; } };
}

function recordDialog(ctx) {
  const title = input({ maxlength: 300, autofocus: true });
  const category = select(VAULT_ENUMS.category, { value: 'Legal' });
  const file = fileMetaField();
  openDialog({ title: 'Record a document', description: 'Adds a document record to the Vault. In this development build only its metadata is kept.',
    content: h('div', { class: 'form-grid' }, field('Title', title, { full: true }), field('Category', category), h('div', { class: 'field field-full' }, h('label', { class: 'field-label' }, 'File'), file.el, file.facts, h('p', { class: 'field-error', hidden: true }))),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Record document', kind: 'primary', submit: true, run: async () => {
      setFieldError(title, ''); setFieldError(file.el, '');
      if (!file.meta) { setFieldError(file.el, 'Choose the file so its size and checksum can be recorded.'); return false; }
      try { const d = await ctx.data.documents.record({ title: title.value, category: category.value, ...file.meta }); ctx.navigate(`/vault/${d.id}`); }
      catch (e) { const fe = friendlyError(e); setFieldError(e.details?.column === 'title' ? title : file.el, fe.message); return false; }
    } }] });
}

function versionDialog(ctx, doc) {
  const file = fileMetaField();
  openDialog({ title: 'Add a new version', description: `Version ${doc.version_number + 1} of “${doc.title}”. Earlier versions stay in the history, unchanged.`,
    content: h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'File'), file.el, file.facts, h('p', { class: 'field-error', hidden: true })),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Add version', kind: 'primary', submit: true, run: async () => {
      if (!file.meta) { setFieldError(file.el, 'Choose the file for the new version.'); return false; }
      try { const d = await ctx.data.documents.newVersion(doc.id, file.meta); ctx.navigate(`/vault/${d.id}`); }
      catch (e) { setFieldError(file.el, /latest version/.test(e.message) ? 'Only the latest version can get a new version.' : friendlyError(e).message); return false; }
    } }] });
}

function editDialog(ctx, doc) {
  const title = input({ value: doc.title, maxlength: 300, autofocus: true });
  const category = select(VAULT_ENUMS.category, { value: doc.category });
  openDialog({ title: 'Edit document', description: 'Title and category only. The file’s name, size and checksum are fixed once recorded.',
    content: h('div', { class: 'form-grid' }, field('Title', title, { full: true }), field('Category', category)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', submit: true, run: async () => {
      setFieldError(title, '');
      const patch = Object.fromEntries(Object.entries({ title: title.value, category: category.value }).filter(([k, v]) => v !== doc[k]));
      try { if (Object.keys(patch).length) await ctx.data.documents.update(doc.id, patch); } catch (e) { setFieldError(title, friendlyError(e).message); return false; }
    } }] });
}

// archive / restore the whole chain (every version row), so the document's status is unambiguous
async function setArchived(ctx, chain, archived) {
  try { for (const d of chain) if (d.is_archived !== archived) await ctx.data.documents[archived ? 'archive' : 'restore'](d.id); ctx.toast(archived ? 'Archived. It stays in the Vault and can be restored.' : 'Restored'); }
  catch (e) { ctx.toast(friendlyError(e).message, { tone: 'bad' }); }
}

// ---------- document page ----------
async function renderDocument(ctx, params, _q, _path, setCrumbs) {
  const root = h('div', { class: 'page page-narrow vault-page' });
  const draw = async () => {
    const doc = await ctx.data.documents.get(params.id);
    if (!doc) { setCrumbs([{ label: 'Not found' }]); mount(root, stateBlock('empty', { title: 'This document doesn’t exist', action: h('a', { class: 'link', href: '#/vault' }, 'Back to the Vault') })); return; }
    setCrumbs([{ label: doc.title }]);
    const [chain, names, links] = await Promise.all([ctx.data.documents.versions(doc.id), targets(ctx), ctx.data.documentLinks.list()]);
    const latest = chain[0];
    const isLatest = latest.id === doc.id;
    const chainIds = new Set(chain.map(d => d.id));
    const mine = links.filter(l => chainIds.has(l.document_id));
    const kind = select(LINK_TARGETS.map(c => [c, LINK_KINDS[c].label]), { value: 'project_id', class: 'input select input-sm', aria: { label: 'Link type' } });
    const target = h('select', { class: 'input select input-sm', aria: { label: 'Record to link' } });
    const fillTargets = () => {
      const taken = new Set(mine.filter(l => l.document_id === latest.id && l[kind.value] != null).map(l => l[kind.value]));
      const opts = (names[kind.value] || []).filter(([v]) => !taken.has(v));
      mount(target, opts.length ? opts.map(([v, l]) => h('option', { value: v }, l)) : h('option', { value: '' }, 'Nothing left to link'));
    };
    kind.addEventListener('change', fillTargets); fillTargets();
    mount(root,
      metadataOnly(ctx),
      doc.is_archived && h('div', { class: 'banner banner-archived', role: 'note' }, icon('archive', { size: 14 }), h('span', null, 'Archived. Kept in the Vault with its history and links; restore it to use it again.')),
      !isLatest && h('div', { class: 'banner banner-superseded', role: 'note' }, icon('arrowRight', { size: 14 }),
        h('span', null, `This is version ${doc.version_number}. The latest is `, h('a', { class: 'link', href: `#/vault/${latest.id}` }, `version ${latest.version_number}`), '.')),
      h('header', { class: 'project-head' },
        h('div', { class: 'project-title-row' }, h('h1', { class: 'page-title' }, doc.title), h('div', { class: 'page-actions' },
          button('Edit', { kind: 'secondary', size: 'sm', iconName: 'edit', onClick: () => editDialog(ctx, doc) }),
          isLatest && !doc.is_archived && button('New version', { kind: 'secondary', size: 'sm', iconName: 'plus', onClick: () => versionDialog(ctx, doc) }),
          doc.is_archived ? button('Restore', { kind: 'primary', size: 'sm', iconName: 'refresh', onClick: () => setArchived(ctx, chain, false) })
            : button('Archive', { kind: 'ghost', size: 'sm', iconName: 'archive', onClick: () => setArchived(ctx, chain, true) }))),
        h('div', { class: 'prop-row' }, chip(doc.category, { tone: 'info' }), chip(doc.is_archived ? 'Archived' : 'Active', { tone: doc.is_archived ? 'idle' : 'ok' }),
          h('span', { class: 'faint small' }, `Version ${doc.version_number} of ${chain.length}`))),
      h('section', { class: 'dec-section' }, h('h2', { class: 'section-title' }, 'File'),
        h('div', { class: 'file-card' }, icon('file', { size: 22, cls: 'icon file-icon' }),
          h('div', { class: 'file-main' }, h('strong', null, doc.original_filename), h('span', { class: 'faint small' }, `${fmtSize(doc.size_bytes)} · ${doc.mime_type}`)),
          chip(ctx.data.documents.filesStored ? 'Stored' : 'No file stored', { tone: ctx.data.documents.filesStored ? 'ok' : 'warn', title: 'The development build keeps metadata only' })),
        h('dl', { class: 'meta-list' },
          h('dt', null, 'SHA-256'), h('dd', { class: 'mono', title: doc.sha256 }, `${doc.sha256.slice(0, 24)}…`),
          h('dt', null, 'Storage'), h('dd', null, ctx.data.documents.filesStored ? doc.storage_provider : `${doc.storage_provider}, not connected in this build`),
          h('dt', null, 'Recorded'), h('dd', null, formatDateTime(doc.created_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format)),
          h('dt', null, 'Changed'), h('dd', null, formatDateTime(doc.updated_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format)))),
      h('section', { class: 'dec-section' }, h('h2', { class: 'section-title' }, `Linked records · ${mine.length}`),
        mine.length ? h('ul', { class: 'link-list' }, mine.map(l => {
          const { column, id } = linkTarget(l);
          return h('li', null, h('span', { class: 'link-kind' }, LINK_KINDS[column].label), h('a', { class: 'link-main', href: LINK_KINDS[column].href(id) }, nameOf(names, l)),
            l.document_id !== doc.id && h('span', { class: 'faint small' }, `on v${chain.find(d => d.id === l.document_id)?.version_number}`),
            button('', { kind: 'ghost', size: 'sm', iconName: 'x', title: `Unlink ${nameOf(names, l)}`, onClick: () => ctx.data.documentLinks.unlink(l.id).catch(e => ctx.toast(friendlyError(e).message, { tone: 'bad' })) }));
        })) : h('p', { class: 'faint small' }, 'Not linked to anything yet.'),
        isLatest && h('form', { class: 'link-add vault-link-add', onsubmit: async e => {
          e.preventDefault(); if (!target.value) return;
          try { await ctx.data.documentLinks.link(doc.id, kind.value, target.value); } catch (err) { ctx.toast(err.code === '23505' ? 'Already linked to that record.' : friendlyError(err).message, { tone: 'bad' }); }
        } }, kind, target, button('Link', { kind: 'secondary', size: 'sm', type: 'submit', iconName: 'link' }))),
      h('section', { class: 'dec-section' }, h('h2', { class: 'section-title' }, `Version history · ${chain.length}`),
        h('ol', { class: 'versions' }, chain.map(v => h('li', { class: ['version', v.id === doc.id && 'is-current'] },
          h('span', { class: 'version-no num' }, `v${v.version_number}`),
          v.id === doc.id ? h('strong', null, v.original_filename) : h('a', { class: 'link', href: `#/vault/${v.id}` }, v.original_filename),
          h('span', { class: 'faint small' }, `${fmtSize(v.size_bytes)} · ${formatDate(v.created_at.slice(0, 10), ctx.profile.date_format)}`),
          v.id === latest.id && chip('Latest', { tone: 'ok' }))))));
  };
  await draw();
  ctx.onLeave(ctx.bus.on('data:changed', ch => TABLES.includes(ch.table) && draw()));
  return root;
}

// ---------- directory ----------
async function renderDirectory(ctx, _params, query) {
  const cats = ['All', ...VAULT_ENUMS.category];
  const cat = cats.includes(query.category) ? query.category : 'All';
  const search = input({ type: 'search', value: query.q || '', placeholder: 'Search titles, file names and categories', class: 'input search-input', aria: { label: 'Search documents' } });
  const status = select([['active', 'Active'], ['archived', 'Archived'], ['all', 'Active and archived']], { value: query.status || 'active', class: 'input select input-sm', aria: { label: 'Status' } });
  const linked = select([['', 'Any links'], ['none', 'Not linked'], ...LINK_TARGETS.map(c => [c, `Linked to a ${LINK_KINDS[c].label.toLowerCase()}`])], { value: query.linked || '', class: 'input select input-sm', aria: { label: 'Linked records' } });
  const sort = select(Object.entries(SORTS).map(([k, s]) => [k, s.label]), { value: SORTS[query.sort] ? query.sort : 'updated', class: 'input select input-sm', aria: { label: 'Sort' } });
  const tabs = h('div', { class: 'tabs', role: 'tablist', aria: { label: 'Category' } });
  const listEl = h('div', { class: 'list-wrap', aria: { live: 'polite' } }, stateBlock('loading'));
  const params = () => new URLSearchParams(Object.entries({ category: cat === 'All' ? '' : cat, q: search.value.trim(), status: status.value === 'active' ? '' : status.value, linked: linked.value, sort: sort.value === 'updated' ? '' : sort.value }).filter(([, v]) => v));
  const draw = async () => {
    const [docs, links, names] = await Promise.all([ctx.data.documents.list(), ctx.data.documentLinks.list(), targets(ctx)]);
    const rows = vaultRows(docs, links).filter(r => (status.value === 'all' || (status.value === 'archived') === r.doc.is_archived) && docMatches(r.doc, search.value)
      && (!linked.value || (linked.value === 'none' ? !r.links.length : r.links.some(l => l[linked.value] != null))));
    mount(tabs, cats.map(c => h('a', { class: ['tab', c === cat && 'active'], role: 'tab', aria: { selected: c === cat ? 'true' : 'false' },
      href: `#/vault?${new URLSearchParams([...params()].filter(([k]) => k !== 'category').concat(c === 'All' ? [] : [['category', c]]))}` }, c, h('span', { class: 'tab-count num' }, String(rows.filter(r => c === 'All' || r.doc.category === c).length)))));
    const shown = rows.filter(r => cat === 'All' || r.doc.category === cat).sort(SORTS[sort.value].cmp);
    if (!shown.length) { mount(listEl, stateBlock('empty', { title: docs.length ? 'No documents match' : 'The Vault is empty', body: docs.length ? 'Try another category, status or search.' : null })); return; }
    mount(listEl, h('div', { class: 'rows', role: 'list' }, shown.map(r => h('div', { class: ['row', 'doc-row', r.doc.is_archived && 'is-muted'], role: 'listitem' },
      icon('file', { size: 16, cls: 'icon doc-icon' }),
      h('a', { class: 'row-main', href: `#/vault/${r.doc.id}` }, h('span', { class: 'row-title' }, r.doc.title),
        h('span', { class: 'row-sub' }, [r.doc.original_filename, fmtSize(r.doc.size_bytes), r.chain.length > 1 && `v${r.doc.version_number} · ${r.chain.length} versions`].filter(Boolean).join(' · '))),
      h('div', { class: 'row-meta doc-meta' },
        r.links.slice(0, 2).map(l => h('span', { class: 'proj-tag', title: LINK_KINDS[linkTarget(l).column].label }, nameOf(names, l))),
        r.links.length > 2 && h('span', { class: 'faint' }, `+${r.links.length - 2}`),
        r.doc.is_archived && chip('Archived', { tone: 'idle' }), chip(r.doc.category, { tone: 'info' }),
        h('span', { class: 'num doc-date' }, formatShortDate(r.doc.updated_at.slice(0, 10), ctx.today, ctx.profile.date_format)))))));
  };
  const sync = () => { history.replaceState(null, '', `#/vault?${params()}`); draw(); };
  [status, linked, sort].forEach(el => el.addEventListener('change', sync));
  let t = null; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(sync, 150); });
  await draw();
  ctx.onLeave(ctx.bus.on('data:changed', ch => TABLES.includes(ch.table) && draw()));
  return h('div', { class: 'page' },
    pageHeader({ title: 'Company Vault', subtitle: 'Company documents with their versions and the records they belong to. Archive-only: nothing is deleted.',
      actions: [button('Record document', { kind: 'primary', iconName: 'plus', onClick: () => recordDialog(ctx) })] }),
    metadataOnly(ctx), h('div', { class: 'filter-bar' }, search, status, linked, sort), tabs, listEl);
}

export const vaultModule = { routes: [{ pattern: '/vault', render: renderDirectory }, { pattern: '/vault/:id', render: renderDocument }] };
