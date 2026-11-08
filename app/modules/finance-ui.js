// Shared pieces of the Finances screens.
import { h } from '../core/dom.js';
import { formatMoney } from '../core/format.js';
import { openDialog } from '../ui/overlay.js';
import { field, textarea, setFieldError } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { fromCents, toCents } from '../data/money.js';

export const FIN_TABLES = ['financial_accounts', 'financial_categories', 'transactions', 'payment_allocations', 'funding_requirements', 'funding_commitments',
  'capital_structures', 'capital_targets', 'participant_capital_allocations', 'import_batches', 'import_batch_rows', 'participants', 'recurring_transactions', '*'];

export const fmt = (ctx, amount) => formatMoney(amount, ctx.business.base_currency, ctx.profile.number_format);
export const fmtCents = (ctx, c) => fmt(ctx, fromCents(c));

// a signed amount: + green inflow, − outflow, ⇄ neutral transfer, "personal" when no business account moved
export function amountCell(ctx, t, cents) {
  if (cents === null) return h('span', { class: 'amt amt-personal num', title: 'Paid personally: no business account moved' }, fmt(ctx, t.amount));
  if (t.type === 'transfer' && cents === 0) return h('span', { class: 'amt amt-transfer num', title: 'Transfer between business accounts' }, '⇄ ', fmt(ctx, t.amount));
  return h('span', { class: ['amt', 'num', cents > 0 ? 'amt-in' : 'amt-out'] }, cents > 0 ? '+' : '−', fmtCents(ctx, Math.abs(cents)));
}

export function financeNav(active) {
  const tabs = [['overview', 'Overview', '#/finances'], ['transactions', 'Transactions', '#/finances/transactions'], ['funding', 'Funding', '#/finances/funding'],
    ['capital', 'Capital', '#/finances/capital'], ['import', 'CSV import', '#/finances/import']];
  return h('nav', { class: 'tabs fin-tabs', aria: { label: 'Finances' } },
    tabs.map(([id, label, href]) => h('a', { class: ['tab', id === active && 'active'], href, aria: { current: id === active ? 'page' : undefined } }, label)));
}

// big figure + label, for summary strips
export const figure = (label, value, { sub, tone } = {}) => h('div', { class: 'fig' }, h('span', { class: 'fig-label' }, label),
  h('span', { class: ['fig-value', 'num', tone && `fg-${tone}`] }, value), sub && h('span', { class: 'fig-sub' }, sub));

export function bar(part, whole, { tone } = {}) {
  const pct = toCents(whole) > 0 ? Math.min(100, Math.round((toCents(part) / toCents(whole)) * 100)) : 0;
  return h('div', { class: 'progress-track', role: 'img', aria: { label: `${pct}%` } }, h('span', { class: ['progress-fill', tone && `fill-${tone}`], style: { width: `${pct}%` } }));
}

// Reversal and revocation need a reason (the RPCs refuse a blank one); the reason is kept on the record for good.
export function reasonDialog(ctx, { title, description, label = 'Reason', confirmLabel, run }) {
  const reason = textarea({ rows: 3, autofocus: true, placeholder: 'Kept on the record permanently' });
  openDialog({ title, description, size: 'sm', content: h('div', { class: 'form-grid' }, field(label, reason, { full: true })),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: confirmLabel, kind: 'danger', submit: true, run: async () => {
      setFieldError(reason, '');
      if (!reason.value.trim()) { setFieldError(reason, 'A reason is required.'); return false; }
      try { await run(reason.value.trim()); } catch (e) { setFieldError(reason, friendlyError(e).message); return false; }
    } }] });
}

export const onFinanceChange = (ctx, draw, root) => ctx.onLeave(ctx.bus.on('data:changed', ch => {
  if (!FIN_TABLES.includes(ch.table)) return;
  const a = document.activeElement;
  if (root && a && root.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.value && a.type !== 'date') return; // don't redraw under typing
  draw();
}));

export const participantName = (participants, id) => participants.find(p => p.id === id)?.full_name ?? '—';
