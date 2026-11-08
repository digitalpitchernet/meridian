// Transactions: append-only. Create, annotate (category, description, reference, notes) or reverse with a reason.
// Amount, date, accounts, type and participant never change after insert (guard_transaction_update); a correction is a
// reversal plus a new transaction.
import { h, mount } from '../core/dom.js';
import { button, pageHeader, stateBlock, chip } from '../ui/components.js';
import { openDialog } from '../ui/overlay.js';
import { field, input, textarea, select, dateInput, setFieldError, nullIfEmpty } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { formatDate, formatDateTime } from '../core/format.js';
import { TX_KINDS, THIRD_PARTY, kindOf, transactionRow, CONTRIBUTION_LABEL, signedCents, eligibleReceipts, COMMITMENT_LABEL } from './finance-model.js';
import { toCents, fromCents } from '../data/money.js';
import { fmt, amountCell, financeNav, reasonDialog, onFinanceChange, participantName } from './finance-ui.js';

const kindSelect = (value) => {
  const groups = [...new Set(TX_KINDS.map(k => k.group))];
  return h('select', { class: 'input select' }, groups.map(g => h('optgroup', { label: g },
    TX_KINDS.filter(k => k.group === g).map(k => h('option', { value: k.id, selected: k.id === value }, k.label)))));
};

// ---------- new transaction ----------
export async function transactionDialog(ctx, preset = {}) {
  const [accounts, categories, participants, settlements] = await Promise.all([ctx.data.accounts.list(), ctx.data.accounts.categories(), ctx.data.workspace.participants(), ctx.data.transactions.settlements()]);
  const live = accounts.filter(a => a.is_active);
  const main = live.filter(a => ['bank', 'cash'].includes(a.account_type)); // default to accounts that hold available cash
  const kind = kindSelect(preset.kind || 'expense');
  const f = {
    transaction_date: dateInput({ value: ctx.today }),
    amount: input({ inputmode: 'decimal', placeholder: '0.00', autofocus: true }),
    description: input({ maxlength: 500, value: preset.description || '' }),
    account_id: select(live.map(a => [a.id, a.name]), { value: preset.account_id || main[0]?.id || live[0]?.id }),
    transfer_to_account_id: select(live.map(a => [a.id, a.name]), { value: main[1]?.id || live[1]?.id }),
    participant_id: select(participants.map(p => [p.id, p.full_name]), { value: preset.participant_id || participants[0]?.id }),
    settles_transaction_id: h('select', { class: 'input select' }),
    category_id: h('select', { class: 'input select' }),
    funding: select(THIRD_PARTY, { value: 'third_party_equity' }),
    reference: input({ maxlength: 200 }),
    notes: textarea({ rows: 2 }),
  };
  const wrap = {};
  const fieldFor = (key, label, opts) => (wrap[key] = field(label, f[key], opts));
  const grid = h('div', { class: 'form-grid' },
    field('Type', kind, { full: true }), fieldFor('amount', 'Amount'), fieldFor('transaction_date', 'Date'), fieldFor('description', 'Description', { full: true }),
    fieldFor('account_id', 'Account'), fieldFor('transfer_to_account_id', 'To account'), fieldFor('participant_id', 'Participant'),
    fieldFor('settles_transaction_id', 'Settles', { full: true, hint: 'Only what is still owed to this participant.' }), fieldFor('funding', 'Funding type'),
    fieldFor('category_id', 'Category'), fieldFor('reference', 'Reference'), fieldFor('notes', 'Notes', { full: true }));
  const note = h('p', { class: 'field-hint fin-kind-note' });
  const refresh = () => {
    const k = TX_KINDS.find(x => x.id === kind.value);
    const show = new Set(k.fields.map(x => ({ account: 'account_id', to: 'transfer_to_account_id', participant: 'participant_id', settles: 'settles_transaction_id', category: 'category_id', funding: 'funding' }[x])));
    for (const key of ['account_id', 'transfer_to_account_id', 'participant_id', 'settles_transaction_id', 'funding', 'category_id']) wrap[key].hidden = !show.has(key);
    wrap.account_id.querySelector('.field-label').textContent = k.type === 'transfer' ? 'From account' : 'Account';
    mount(f.category_id, h('option', { value: '' }, 'No category'), categories.filter(c => c.is_active && c.kind === (k.type === 'income' ? 'income' : 'expense')).map(c => h('option', { value: c.id }, c.name)));
    if (k.settles) {
      const open = settlements.filter(s => s.contribution_type === k.settles && s.participant_id === f.participant_id.value && Number(s.outstanding_amount) > 0);
      mount(f.settles_transaction_id, open.length ? open.map(s => h('option', { value: s.transaction_id, selected: s.transaction_id === preset.settles_transaction_id }, `${s.description} · ${fmt(ctx, s.outstanding_amount)} outstanding`))
        : h('option', { value: '' }, `Nothing is owed to this participant as a ${k.settles === 'founder_loan' ? 'loan' : 'reimbursable expense'}`));
    }
    note.textContent = k.personal ? 'Paid from a personal account: no business account moves, so available cash is unchanged.'
      : k.id === 'transfer' ? 'Moves money between business accounts. Available cash changes only if money moves into escrow or out of a credit line.'
      : k.contribution_type === 'capital_contribution' ? 'Counts as capital contributed by this participant. It never changes agreed ownership percentages.'
      : k.id === 'third_party' ? 'Allocate it to a funding commitment afterwards so the commitment shows as paid.' : '';
  };
  kind.addEventListener('change', refresh); f.participant_id.addEventListener('change', refresh);
  refresh();
  openDialog({ title: 'New transaction', content: h('div', null, grid, note), size: 'lg',
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Record transaction', kind: 'primary', submit: true, run: async () => {
      Object.values(f).forEach(x => setFieldError(x, ''));
      const k = TX_KINDS.find(x => x.id === kind.value);
      const v = Object.fromEntries(Object.entries(f).map(([key, el]) => [key, el.value.trim ? el.value.trim() : el.value]));
      if (!v.amount) { setFieldError(f.amount, 'Enter the amount.'); return false; }
      if (k.settles && !v.settles_transaction_id) { setFieldError(f.settles_transaction_id, 'There is nothing to settle.'); return false; }
      try {
        const t = await ctx.data.transactions.create(transactionRow(k, { ...v, reference: nullIfEmpty(v.reference), notes: nullIfEmpty(v.notes) }));
        ctx.toast('Transaction recorded', { tone: 'ok', action: { label: 'Open', run: () => ctx.navigate(`/finances/transactions/${t.id}`) } });
      } catch (e) { const fe = friendlyError(e); const el = f[e.details?.column]; if (el) setFieldError(el, fe.message); else setFieldError(f.description, fe.message); return false; }
    } }] });
}

// ---------- allocate a receipt to a commitment ----------
export async function allocateDialog(ctx, { transaction = null, commitment = null }) {
  const [commitments, txs, allocations] = await Promise.all([ctx.data.funding.commitments(), ctx.data.transactions.list(), ctx.data.funding.allocations()]);
  const open = commitments.filter(c => c.status !== 'revoked');
  let pairs; // [{ c, t, remaining }]
  if (transaction) pairs = open.flatMap(c => eligibleReceipts(c, [transaction], allocations).map(x => ({ c, ...x })));
  else pairs = eligibleReceipts(commitment, txs, allocations).map(x => ({ c: commitment, ...x }));
  if (!pairs.length) {
    ctx.toast(transaction ? 'No open commitment can take this payment (participant and type must match).' : 'No unallocated funding receipt from this funder. Record the payment as a transaction first.', { tone: 'warn' });
    return;
  }
  const pick = select(pairs.map((p, i) => [String(i), transaction ? `${p.c.funder_name} · ${COMMITMENT_LABEL[p.c.status]} · ${fmt(ctx, p.c.outstanding_amount)} outstanding`
    : `${formatDate(p.t.transaction_date, ctx.profile.date_format)} · ${p.t.description} · ${fmt(ctx, fromCents(p.remaining))} unallocated`]), { value: '0', autofocus: true });
  const amount = input({ inputmode: 'decimal' });
  const fill = () => { const p = pairs[Number(pick.value)]; const out = Math.min(p.remaining, toCents(p.c.outstanding_amount)) || p.remaining; amount.value = fromCents(out); };
  pick.addEventListener('change', fill); fill();
  openDialog({ title: transaction ? 'Allocate to a commitment' : `Record a payment from ${commitment.funder_name}`,
    description: 'A pledge is not money: a commitment counts as paid only through allocations of money actually received.',
    content: h('div', { class: 'form-grid' }, field(transaction ? 'Commitment' : 'Payment received', pick, { full: true }), field('Amount to allocate', amount)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Allocate', kind: 'primary', submit: true, run: async () => {
      setFieldError(amount, '');
      const p = pairs[Number(pick.value)];
      try { await ctx.data.funding.allocate({ commitment_id: p.c.commitment_id, transaction_id: p.t.id, amount: amount.value.trim() }); }
      catch (e) { setFieldError(amount, friendlyError(e).message); return false; }
    } }] });
}

// ---------- detail panel ----------
export async function openTransactionPanel(ctx, id) {
  const body = h('div', { class: 'panel-body' }, stateBlock('loading'));
  ctx.openPanel(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('span', { class: 'panel-kicker' }, 'Transaction'),
    button('', { kind: 'ghost', size: 'sm', iconName: 'x', title: 'Close panel', onClick: () => ctx.closePanel() })), body),
    { label: 'Transaction details', onClose: () => { if (/^#\/finances\/transactions\/[^/?]+/.test(location.hash)) history.replaceState(null, '', '#/finances/transactions'); } });
  const draw = async () => {
    const t = await ctx.data.transactions.get(id);
    if (!t) { mount(body, stateBlock('empty', { title: 'This transaction doesn’t exist' })); return; }
    const [accounts, categories, participants, settlements, all, allocations, commitments] = await Promise.all([ctx.data.accounts.list(), ctx.data.accounts.categories(),
      ctx.data.workspace.participants(), ctx.data.transactions.settlements(), ctx.data.transactions.list(), ctx.data.funding.allocations({ eq: { transaction_id: id } }), ctx.data.funding.commitments()]);
    const k = kindOf(t);
    const acct = aid => accounts.find(a => a.id === aid)?.name ?? '—';
    const settlement = settlements.find(s => s.transaction_id === t.id);
    const settledBy = all.filter(x => x.settles_transaction_id === t.id);
    const settles = t.settles_transaction_id ? all.find(x => x.id === t.settles_transaction_id) : null;
    const replaces = t.replaces_transaction_id ? all.find(x => x.id === t.replaces_transaction_id) : null;
    const replacedBy = all.find(x => x.replaces_transaction_id === t.id);
    const annotate = patch => ctx.data.transactions.annotate(t.id, patch).catch(e => ctx.toast(friendlyError(e).message, { tone: 'bad' }));
    const cats = categories.filter(c => c.kind === (t.type === 'income' ? 'income' : 'expense') && (c.is_active || c.id === t.category_id));
    const isReceipt = !t.is_reversed && eligibleReceipts({ participant_id: null }, [t], []).length > 0;
    mount(body,
      t.is_reversed && h('div', { class: 'banner banner-reversed', role: 'note' }, h('strong', null, 'Reversed'),
        ` ${formatDateTime(t.reversed_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format)}: ${t.reversal_reason}`,
        replacedBy && h('span', null, ' · replaced by ', h('a', { class: 'link', href: `#/finances/transactions/${replacedBy.id}` }, replacedBy.description))),
      h('div', { class: 'tx-head' }, h('span', { class: ['tx-amount', t.is_reversed && 'is-reversed'] }, amountCell(ctx, t, signedCents(t))), chip(CONTRIBUTION_LABEL[t.contribution_type], { tone: t.contribution_type === 'operational' ? 'idle' : 'info' })),
      textarea({ class: 'input title-input', rows: 1, value: t.description, maxlength: 500, aria: { label: 'Description' }, onchange: e => e.target.value.trim() && annotate({ description: e.target.value.trim() }) }),
      h('dl', { class: 'meta-list' },
        h('dt', null, 'Date'), h('dd', null, formatDate(t.transaction_date, ctx.profile.date_format)),
        h('dt', null, 'Kind'), h('dd', null, k?.label ?? t.type),
        t.type === 'transfer' ? [h('dt', null, 'From'), h('dd', null, acct(t.account_id)), h('dt', null, 'To'), h('dd', null, acct(t.transfer_to_account_id))]
          : [h('dt', null, 'Account'), h('dd', null, t.account_id ? acct(t.account_id) : 'None: paid personally')],
        t.participant_id && [h('dt', null, 'Participant'), h('dd', null, participantName(participants, t.participant_id))],
        settles && [h('dt', null, 'Settles'), h('dd', null, h('a', { class: 'link', href: `#/finances/transactions/${settles.id}` }, settles.description))],
        replaces && [h('dt', null, 'Replaces'), h('dd', null, h('a', { class: 'link', href: `#/finances/transactions/${replaces.id}` }, replaces.description))],
        t.import_batch_id && [h('dt', null, 'Source'), h('dd', null, h('a', { class: 'link', href: `#/finances/import/${t.import_batch_id}` }, 'CSV import'))],
        h('dt', null, 'Recorded'), h('dd', null, formatDateTime(t.created_at, ctx.business.timezone, ctx.profile.date_format, ctx.profile.time_format))),
      h('div', { class: 'prop-grid' },
        t.type !== 'transfer' && field('Category', select(cats.map(c => [c.id, c.name]), { value: t.category_id || '', placeholder: 'No category', onchange: e => annotate({ category_id: nullIfEmpty(e.target.value) }) })),
        field('Reference', input({ value: t.reference || '', maxlength: 200, onchange: e => annotate({ reference: nullIfEmpty(e.target.value.trim()) }) }))),
      field('Notes', textarea({ value: t.notes || '', rows: 2, onchange: e => annotate({ notes: nullIfEmpty(e.target.value.trim()) }) }), { full: true }),
      settlement && h('section', { class: 'panel-section' }, h('h3', { class: 'section-title' }, t.contribution_type === 'founder_loan' ? 'Repayment' : 'Reimbursement'),
        h('p', { class: 'small' }, `${fmt(ctx, settlement.settled_amount)} settled · `, h('strong', null, `${fmt(ctx, settlement.outstanding_amount)} outstanding`)),
        settledBy.length ? h('ul', { class: 'plain-list' }, settledBy.map(s => h('li', { class: s.is_reversed && 'is-reversed' }, h('a', { class: 'link', href: `#/finances/transactions/${s.id}` }, s.description), ` · ${fmt(ctx, s.amount)} · ${formatDate(s.transaction_date, ctx.profile.date_format)}`, s.is_reversed && ' (reversed)'))) : null,
        Number(settlement.outstanding_amount) > 0 && button(t.contribution_type === 'founder_loan' ? 'Record a repayment' : 'Record a reimbursement', { kind: 'secondary', size: 'sm', iconName: 'plus',
          onClick: () => transactionDialog(ctx, { kind: t.contribution_type === 'founder_loan' ? 'loan_repayment' : 'reimbursement', participant_id: t.participant_id, settles_transaction_id: t.id, description: `${t.contribution_type === 'founder_loan' ? 'Repayment' : 'Reimbursement'}: ${t.description}` }) })),
      (isReceipt || allocations.length > 0) && h('section', { class: 'panel-section' }, h('h3', { class: 'section-title' }, `Allocated to commitments · ${allocations.length}`),
        allocations.length ? h('ul', { class: 'plain-list' }, allocations.map(a => {
          const c = commitments.find(x => x.commitment_id === a.commitment_id);
          return h('li', { class: a.is_reversed && 'is-reversed' }, h('a', { class: 'link', href: `#/finances/funding/${c?.requirement_id}` }, c?.funder_name ?? 'Commitment'), ` · ${fmt(ctx, a.amount)}`,
            a.is_reversed ? h('span', { class: 'faint small' }, ` · reversed: ${a.reversal_reason}`)
              : button('Reverse', { kind: 'ghost', size: 'sm', onClick: () => reasonDialog(ctx, { title: 'Reverse this allocation?', description: 'The payment stays recorded; it simply stops counting towards this commitment.', confirmLabel: 'Reverse allocation', run: r => ctx.data.funding.reverseAllocation(a.id, r) }) }));
        })) : h('p', { class: 'faint small' }, 'Not allocated. Funding receipts count towards a commitment only once allocated.'),
        isReceipt && button('Allocate to a commitment', { kind: 'secondary', size: 'sm', iconName: 'link', onClick: () => allocateDialog(ctx, { transaction: t }) })),
      h('div', { class: 'panel-foot' },
        t.is_reversed ? h('p', { class: 'faint small' }, 'Reversed transactions stay in the ledger and never count towards any balance.')
          : [h('p', { class: 'faint small' }, 'The amount, date, accounts and type are fixed. To correct them, reverse this transaction and record a new one.'),
            button('Reverse…', { kind: 'danger', size: 'sm', iconName: 'refresh', onClick: () => reasonDialog(ctx, { title: 'Reverse this transaction?',
              description: `${fmt(ctx, t.amount)} · ${t.description}. It stays in the ledger, marked reversed, and stops counting.${allocations.some(a => !a.is_reversed) ? ' Its allocations to commitments are reversed with it.' : ''}`,
              confirmLabel: 'Reverse transaction', run: r => ctx.data.transactions.reverse(t.id, r) }) })]));
  };
  await draw();
  const off = ctx.bus.on('data:changed', ch => ['transactions', 'payment_allocations', 'financial_categories', '*'].includes(ch.table) && !body.contains(document.activeElement) && draw());
  ctx.onLeave(off);
}

// ---------- list ----------
export async function renderTransactions(ctx, params, query) {
  const [accounts] = await Promise.all([ctx.data.accounts.list()]);
  const acct = select(accounts.map(a => [a.id, a.name]), { value: query.account || '', placeholder: 'All accounts', class: 'input select input-sm', aria: { label: 'Account' } });
  const kinds = select(Object.entries(CONTRIBUTION_LABEL), { value: query.kind || '', placeholder: 'Every kind', class: 'input select input-sm', aria: { label: 'Kind' } });
  const state = select([['active', 'Active'], ['reversed', 'Reversed'], ['all', 'Active and reversed']], { value: query.state || 'active', class: 'input select input-sm', aria: { label: 'Status' } });
  const search = input({ type: 'search', value: query.q || '', placeholder: 'Search descriptions and references', class: 'input search-input', aria: { label: 'Search transactions' } });
  const listEl = h('div', { class: 'list-wrap', aria: { live: 'polite' } }, stateBlock('loading'));
  const root = h('div', { class: 'page page-fin' },
    pageHeader({ title: 'Transactions', subtitle: 'Append-only. Corrections are reversals with a reason, so the history always adds up.',
      actions: [button('New transaction', { kind: 'primary', iconName: 'plus', onClick: () => transactionDialog(ctx, { account_id: acct.value || undefined }) })] }),
    financeNav('transactions'), h('div', { class: 'filter-bar' }, search, acct, kinds, state), listEl);
  const draw = async () => {
    const [txs, categories, participants] = await Promise.all([ctx.data.transactions.list(), ctx.data.accounts.categories(), ctx.data.workspace.participants()]);
    const q = search.value.trim().toLowerCase();
    const rows = txs.filter(t => (!acct.value || t.account_id === acct.value || t.transfer_to_account_id === acct.value) && (!kinds.value || t.contribution_type === kinds.value)
      && (state.value === 'all' || (state.value === 'reversed') === t.is_reversed) && (!q || `${t.description} ${t.reference || ''}`.toLowerCase().includes(q)));
    if (!rows.length) { mount(listEl, stateBlock('empty', { title: q || acct.value || kinds.value || state.value !== 'active' ? 'No transactions match' : 'No transactions yet' })); return; }
    const cname = new Map(categories.map(c => [c.id, c.name])), aname = new Map(accounts.map(a => [a.id, a.name]));
    mount(listEl, h('div', { class: 'rows', role: 'list' }, rows.map(t => h('div', { class: ['row', 'tx-row', t.is_reversed && 'is-reversed'], role: 'listitem' },
      h('span', { class: 'tx-date num' }, formatDate(t.transaction_date, ctx.profile.date_format)),
      h('button', { type: 'button', class: 'row-main tx-main', onclick: () => { history.replaceState(null, '', `#/finances/transactions/${t.id}`); openTransactionPanel(ctx, t.id); } },
        h('span', { class: 'row-title' }, t.description),
        h('span', { class: 'row-sub' }, [t.type === 'transfer' ? `${aname.get(t.account_id)} → ${aname.get(t.transfer_to_account_id)}` : t.account_id ? aname.get(t.account_id) : `Paid personally by ${participantName(participants, t.participant_id)}`,
          t.contribution_type !== 'operational' && CONTRIBUTION_LABEL[t.contribution_type], t.is_reversed && 'Reversed'].filter(Boolean).join(' · '))),
      h('div', { class: 'row-meta' }, t.category_id && h('span', { class: 'proj-tag tx-cat' }, cname.get(t.category_id)), amountCell(ctx, t, signedCents(t, acct.value || null)))))));
  };
  const sync = () => { history.replaceState(null, '', `#/finances/transactions${params.id ? `/${params.id}` : ''}?${new URLSearchParams(Object.entries({ account: acct.value, kind: kinds.value, state: state.value === 'active' ? '' : state.value, q: search.value.trim() }).filter(([, v]) => v))}`); draw(); };
  [acct, kinds, state].forEach(el => el.addEventListener('change', sync));
  let timer = null; search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(sync, 150); });
  await draw();
  onFinanceChange(ctx, draw, root);
  if (params.id) queueMicrotask(() => openTransactionPanel(ctx, params.id));
  return root;
}
