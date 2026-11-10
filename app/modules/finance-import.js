// CSV import (migration 5): the client stages the cells exactly as read; prepare_import_row() parses, validates and
// fingerprints each row and flags transactions already on the account; the founder decides import / skip / replace;
// commit_import_batch() writes everything in one transaction or nothing. A committed batch is permanent provenance.
import { h, mount } from '../core/dom.js';
import { button, pageHeader, stateBlock, chip } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/overlay.js';
import { field, select } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { formatDate, formatDateTime } from '../core/format.js';
import { sha256Bytes } from '../data/sha256.js';
import { parseCsv, guessMapping, payloads, inFileDuplicateOf } from './finance-model.js';
import { fmt, financeNav, figure, onFinanceChange } from './finance-ui.js';

const MAX_ROWS = 2000; // shortcut: a single staged batch is capped for the in-browser development adapter; revisit with the Supabase adapter

async function newImportDialog(ctx) {
  const accounts = (await ctx.data.accounts.list()).filter(a => a.is_active);
  if (!accounts.length) { ctx.toast('Add an active account first.', { tone: 'warn' }); return; }
  const account = select(accounts.map(a => [a.id, a.name]), { value: (accounts.find(a => a.account_type === 'bank') ?? accounts[0]).id });
  const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'input' });
  const mapping = h('div', { class: 'form-grid' });
  const preview = h('div', { class: 'csv-preview' });
  let parsed = null, maps = null, checksum = null, filename = null;
  const drawMapping = () => {
    if (!parsed) { mount(mapping); mount(preview); return; }
    const [head, ...rows] = parsed;
    const opts = head.map((x, i) => [String(i), x || `Column ${i + 1}`]);
    const sel = key => { const s = select(opts, { value: String(maps[key]), placeholder: 'Not in this file' }); s.addEventListener('change', () => { maps[key] = s.value === '' ? -1 : Number(s.value); drawPreview(rows); }); return s; };
    mount(mapping, field('Date column', sel('date')), field('Amount column', sel('amount')), field('Type column (income or expense)', sel('type')), field('Description column', sel('description')));
    drawPreview(rows);
  };
  const drawPreview = rows => {
    const sample = payloads(rows.slice(0, 5), maps);
    mount(preview, h('p', { class: 'faint small' }, `${rows.length} row${rows.length === 1 ? '' : 's'} after the header. First rows as they will be staged (the server parses and validates them):`),
      h('div', { class: 'table-scroll' }, h('table', { class: 'fin-table' }, h('thead', null, h('tr', null, ['Date', 'Amount', 'Type', 'Description'].map(x => h('th', { scope: 'col' }, x)))),
        h('tbody', null, sample.map(p => h('tr', null, h('td', null, p.date), h('td', null, p.amount), h('td', null, p.type), h('td', null, p.description)))))));
  };
  file.addEventListener('change', async () => {
    parsed = null; const fl = file.files?.[0]; if (!fl) return drawMapping();
    const bytes = new Uint8Array(await fl.arrayBuffer());
    checksum = sha256Bytes(bytes); filename = fl.name;
    parsed = parseCsv(new TextDecoder().decode(bytes));
    if (parsed.length < 2) { parsed = null; ctx.toast('That file has no rows under a header.', { tone: 'warn' }); return drawMapping(); }
    maps = guessMapping(parsed[0]);
    drawMapping();
  });
  openDialog({ title: 'Import a CSV statement', size: 'lg',
    description: 'Columns needed: date (YYYY-MM-DD), a positive amount, a type of income or expense, and a description. Values are staged exactly as they are in the file; rows that don’t fit are flagged, not changed.',
    content: h('div', { class: 'form-grid' }, field('Into account', account), field('CSV file', file), h('div', { class: 'field-full' }, mapping), h('div', { class: 'field-full' }, preview)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Stage for review', kind: 'primary', submit: true, run: async () => {
      if (!parsed) { ctx.toast('Choose a CSV file first.', { tone: 'warn' }); return false; }
      if (Object.values(maps).some(i => i < 0)) { ctx.toast('Choose a column for date, amount, type and description.', { tone: 'warn' }); return false; }
      const rows = parsed.slice(1);
      if (rows.length > MAX_ROWS) { ctx.toast(`Split the file: at most ${MAX_ROWS} rows per import.`, { tone: 'warn' }); return false; }
      try { const b = await ctx.data.imports.stage({ account_id: account.value, filename, file_checksum_sha256: checksum }, payloads(rows, maps)); ctx.navigate(`/finances/import/${b.id}`); }
      catch (e) { ctx.toast(friendlyError(e).message, { tone: 'bad' }); return false; }
    } }] });
}

// ---------- one batch ----------
export async function renderBatch(ctx, params, _q, _path, setCrumbs) {
  const root = h('div', { class: 'page page-fin' });
  const draw = async () => {
    const b = await ctx.data.imports.get(params.id);
    if (!b) { setCrumbs([{ label: 'Not found' }]); mount(root, stateBlock('empty', { title: 'This import doesn’t exist', action: h('a', { class: 'link', href: '#/finances/import' }, 'Back to imports') })); return; }
    setCrumbs([{ label: 'CSV import', href: '#/finances/import' }, { label: b.filename }]);
    const [rows, account, txs] = await Promise.all([ctx.data.imports.rows(b.id), ctx.data.accounts.get(b.account_id), ctx.data.transactions.list()]);
    const tx = new Map(txs.map(t => [t.id, t]));
    const sameAs = inFileDuplicateOf(rows);
    const staged = b.status === 'staged';
    const invalid = rows.filter(r => r.validation_error), dups = rows.filter(r => r.duplicate_of_transaction_id || sameAs.has(r.id) || r.duplicate_in_batch);
    const undecided = rows.filter(r => r.resolution === 'pending' && (r.validation_error || r.duplicate_of_transaction_id || sameAs.has(r.id)));
    const resolve = (r, value) => {
      const [resolution, target] = value.split(':');
      ctx.data.imports.resolve(r.id, resolution, target || null).catch(e => ctx.toast(friendlyError(e).message, { tone: 'bad' }));
    };
    mount(root,
      h('header', { class: 'project-head' },
        h('div', { class: 'project-title-row' }, h('h1', { class: 'page-title' }, b.filename), h('div', { class: 'page-actions' },
          staged && button('Discard', { kind: 'ghost', size: 'sm', iconName: 'trash', onClick: async () => {
            if (await confirmDialog({ title: 'Discard this staged import?', body: 'Nothing has been written to the ledger yet. The staged rows are deleted.', confirmLabel: 'Discard', danger: true })) { await ctx.data.imports.discard(b.id); ctx.navigate('/finances/import'); }
          } }),
          staged && button(`Commit ${rows.filter(r => r.resolution !== 'skip' && !r.validation_error).length} rows`, { kind: 'primary', size: 'sm', iconName: 'check', disabled: undecided.length > 0, onClick: async () => {
            try { const res = await ctx.data.imports.commit(b.id); ctx.toast(`Imported ${res.imported}, replaced ${res.replaced}, skipped ${res.skipped}`, { tone: 'ok' }); }
            catch (e) { ctx.toast(friendlyError(e).message, { tone: 'bad' }); }
          } }))),
        h('div', { class: 'prop-row' }, chip(staged ? 'Staged, not yet in the ledger' : 'Committed', { tone: staged ? 'warn' : 'ok' }), h('span', { class: 'faint small' }, `${account?.name ?? ''} · uploaded ${formatDateTime(b.created_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format)}`),
          !staged && h('span', { class: 'faint small' }, `committed ${formatDateTime(b.committed_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format)}`))),
      h('div', { class: 'fig-strip' }, figure('Rows', String(rows.length)), figure('Invalid', String(invalid.length), { tone: invalid.length ? 'bad' : undefined }),
        figure('Possible duplicates', String(dups.length), { tone: dups.length ? 'warn' : undefined }),
        staged ? figure('Need a decision', String(undecided.length), { tone: undecided.length ? 'warn' : 'ok' }) : figure('Imported · replaced · skipped', `${b.imported_rows} · ${b.replaced_rows} · ${b.skipped_rows}`)),
      staged && h('p', { class: 'faint small' }, 'Invalid rows must be skipped. A row that matches a transaction already on this account, or an earlier row in this file, needs a decision. Nothing is written until you commit, and then everything is written at once or nothing is.'),
      h('div', { class: 'table-scroll' }, h('table', { class: 'fin-table csv-table' },
        h('thead', null, h('tr', null, ['#', 'Date', 'Description', 'Amount', 'Check', staged ? 'Decision' : 'Result'].map(x => h('th', { scope: 'col', class: x === 'Amount' ? 'num' : null }, x)))),
        h('tbody', null, rows.map(r => {
          const dupTx = r.duplicate_of_transaction_id && tx.get(r.duplicate_of_transaction_id);
          const issue = r.validation_error ? h('span', { class: 'fg-bad' }, r.validation_error)
            : dupTx ? h('span', { class: 'fg-warn' }, 'Already on this account: ', h('a', { class: 'link', href: `#/finances/transactions/${dupTx.id}` }, dupTx.description))
            : sameAs.has(r.id) ? h('span', { class: 'fg-warn' }, `Same as row ${sameAs.get(r.id)} in this file`) : h('span', { class: 'fg-ok' }, 'OK');
          const opts = r.validation_error ? [['skip', 'Skip']] : [['import', 'Import'], ['skip', 'Skip'], ...(dupTx && !dupTx.is_reversed ? [[`replace:${dupTx.id}`, 'Replace the existing one']] : [])];
          const needs = !!(r.validation_error || dupTx || sameAs.has(r.id));
          const value = r.resolution === 'replace' ? `replace:${r.replace_transaction_id}` : r.resolution === 'pending' && !needs ? 'import' : r.resolution;
          const decision = staged ? select(opts, { value, placeholder: r.resolution === 'pending' && needs ? 'Decide…' : undefined, class: 'input select input-sm', aria: { label: `Decision for row ${r.row_index}` }, onchange: e => e.target.value && resolve(r, e.target.value) })
            : r.transaction_id ? h('a', { class: 'link', href: `#/finances/transactions/${r.transaction_id}` }, r.row_status) : h('span', { class: 'faint' }, r.row_status);
          return h('tr', { class: r.resolution === 'skip' && 'is-muted' }, h('td', { class: 'num faint' }, String(r.row_index)),
            h('td', null, r.parsed_date ? formatDate(r.parsed_date, ctx.profile.date_format) : r.payload.date), h('td', null, r.parsed_description ?? r.payload.description),
            h('td', { class: 'num' }, r.parsed_amount ? `${r.parsed_type === 'income' ? '+' : '−'}${fmt(ctx, r.parsed_amount)}` : r.payload.amount), h('td', null, issue), h('td', null, decision));
        })))));
  };
  await draw();
  onFinanceChange(ctx, draw, root);
  return root;
}

// ---------- list ----------
export async function renderImports(ctx) {
  const listEl = h('div', { class: 'list-wrap' }, stateBlock('loading'));
  const root = h('div', { class: 'page page-fin' },
    pageHeader({ title: 'CSV import', subtitle: 'Bring in a bank statement: review every row, decide duplicates, then commit it in one step.',
      actions: [button('Import a CSV', { kind: 'primary', iconName: 'plus', onClick: () => newImportDialog(ctx) })] }),
    financeNav('import'), listEl);
  const draw = async () => {
    const [batches, accounts] = await Promise.all([ctx.data.imports.batches(), ctx.data.accounts.list()]);
    if (!batches.length) { mount(listEl, stateBlock('empty', { title: 'No imports yet', body: 'A file can be imported into the same account only once; the file’s checksum is kept as provenance.', action: button('Import a CSV', { kind: 'primary', size: 'sm', iconName: 'plus', onClick: () => newImportDialog(ctx) }) })); return; }
    mount(listEl, h('div', { class: 'rows', role: 'list' }, batches.map(b => h('div', { class: 'row', role: 'listitem' },
      h('a', { class: 'row-main', href: `#/finances/import/${b.id}` }, h('span', { class: 'row-title' }, b.filename), h('span', { class: 'row-sub' }, `${accounts.find(a => a.id === b.account_id)?.name ?? ''} · ${formatDateTime(b.created_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format)}`)),
      h('div', { class: 'row-meta' }, b.status === 'committed' ? h('span', null, `${b.imported_rows} imported · ${b.replaced_rows} replaced · ${b.skipped_rows} skipped`) : null,
        chip(b.status === 'committed' ? 'Committed' : 'Staged', { tone: b.status === 'committed' ? 'ok' : 'warn' }))))));
  };
  await draw();
  onFinanceChange(ctx, draw, root);
  return root;
}
