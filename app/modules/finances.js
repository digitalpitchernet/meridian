// Finances (M3). Gate 1 migrations 3-5: accounts, append-only transactions, funding requirement -> commitment ->
// payment allocation, capital structure, settlements, CSV import. Every derived figure on these screens comes from a
// view or RPC (get_available_cash, get_account_balances, vw_*); the screens never compute balances or statuses.
import { h, mount } from '../core/dom.js';
import { button, pageHeader, stateBlock, chip } from '../ui/components.js';
import { openDialog } from '../ui/overlay.js';
import { field, input, textarea, select, dateInput, setFieldError, nullIfEmpty } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { formatDate, formatShortDate } from '../core/format.js';
import { FIN_ENUMS } from '../data/schema-finance.js';
import { ACCOUNT_TYPE_LABEL, CONTRIBUTION_LABEL } from './finance-model.js';
import { fmt, financeNav, figure, bar, onFinanceChange, participantName } from './finance-ui.js';
import { transactionDialog, renderTransactions } from './finance-ledger.js';
import { renderFunding, renderRequirement } from './finance-funding.js';
import { renderCapital } from './finance-capital.js';
import { renderImports, renderBatch } from './finance-import.js';

// ---------- accounts ----------
export function accountDialog(ctx, existing = null) {
  const a = existing || {};
  const f = {
    name: input({ value: a.name || '', maxlength: 200, autofocus: true }),
    account_type: select(FIN_ENUMS.accountType.map(t => [t, ACCOUNT_TYPE_LABEL[t]]), { value: a.account_type || 'bank', disabled: !!existing }),
    institution: input({ value: a.institution || '', maxlength: 200 }),
    opening_balance: input({ value: a.opening_balance ?? '0.00', inputmode: 'decimal', disabled: !!existing }),
    opening_balance_date: dateInput({ value: a.opening_balance_date || ctx.today, disabled: !!existing }),
    notes: textarea({ value: a.notes || '', rows: 2 }),
  };
  const active = h('input', { type: 'checkbox', checked: existing ? a.is_active : true });
  openDialog({ title: existing ? 'Edit account' : 'Add account',
    description: existing ? 'Type, opening balance and its date are fixed once the account exists; they anchor every balance.' : 'Bank and cash accounts count towards available cash. Credit lines and escrow are tracked but never counted.',
    content: h('div', { class: 'form-grid' }, field('Name', f.name, { full: true }), field('Type', f.account_type), field('Institution', f.institution),
      field('Opening balance', f.opening_balance, { hint: 'Negative for a credit line already drawn.' }), field('Opening balance date', f.opening_balance_date, { hint: 'No transaction can be dated before it.' }),
      field('Notes', f.notes, { full: true }),
      h('label', { class: 'check-row field-full' }, active, existing ? 'Active (inactive accounts accept no new transactions and never count as cash)' : 'Active')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: existing ? 'Save' : 'Add account', kind: 'primary', submit: true, run: async () => {
      Object.values(f).forEach(x => setFieldError(x, ''));
      try {
        if (existing) {
          const patch = { name: f.name.value, institution: nullIfEmpty(f.institution.value.trim()), notes: nullIfEmpty(f.notes.value.trim()), is_active: active.checked };
          await ctx.data.accounts.update(a.id, Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== a[k])));
        } else {
          await ctx.data.accounts.create({ name: f.name.value, account_type: f.account_type.value, institution: nullIfEmpty(f.institution.value.trim()),
            opening_balance: f.opening_balance.value.trim() || '0', opening_balance_date: f.opening_balance_date.value, notes: nullIfEmpty(f.notes.value.trim()), is_active: active.checked });
        }
      } catch (e) { const fe = friendlyError(e); if (f[e.details?.column]) setFieldError(f[e.details.column], fe.message); else ctx.toast(fe.message, { tone: 'bad' }); return false; }
    } }] });
}

// ---------- overview ----------
async function renderOverview(ctx, _params, query) {
  const asOf = dateInput({ value: /^\d{4}-\d{2}-\d{2}$/.test(query.asOf || '') ? query.asOf : ctx.today, aria: { label: 'As of date' }, class: 'input input-date input-sm' });
  const body = h('div', { class: 'fin-body' }, stateBlock('loading'));
  const root = h('div', { class: 'page page-fin' },
    pageHeader({ title: 'Finances', subtitle: 'Cash, accounts, funding, and what the business owes its people.',
      actions: [button('Add account', { kind: 'secondary', iconName: 'plus', onClick: () => accountDialog(ctx) }),
        button('New transaction', { kind: 'primary', iconName: 'plus', onClick: () => transactionDialog(ctx) })] }),
    financeNav('overview'), body);

  const draw = async () => {
    const day = asOf.value || ctx.today;
    try {
      const [cash, balances, accounts, settlements, requirements, participants, recurring] = await Promise.all([
        ctx.data.accounts.availableCash(day), ctx.data.accounts.balances(day), ctx.data.accounts.list(), ctx.data.transactions.settlements(),
        ctx.data.funding.requirementSummaries(), ctx.data.workspace.participants(), ctx.data.accounts.recurring()]);
      const byId = new Map(balances.map(b => [b.account_id, b]));
      const notOpen = accounts.filter(a => !byId.has(a.id));
      const owed = settlements.filter(s => Number(s.outstanding_amount) > 0);
      const isToday = day === ctx.today;
      mount(body,
        h('section', { class: 'fin-hero' },
          h('div', { class: 'fin-hero-main' }, h('span', { class: 'fig-label' }, 'Available cash'), h('span', { class: 'fin-cash num' }, fmt(ctx, cash)),
            h('span', { class: 'fig-sub' }, 'Active bank and cash accounts', isToday ? ', today' : `, on ${formatDate(day, ctx.profile.date_format)}`, '. Credit lines and escrow are never counted; transfers between accounts are neutral.')),
          h('label', { class: 'fin-asof' }, h('span', { class: 'field-label' }, 'As of'), asOf, !isToday && button('Today', { kind: 'ghost', size: 'sm', onClick: () => { asOf.value = ctx.today; draw(); } }))),
        h('section', { class: 'fin-section' }, h('h2', { class: 'section-title' }, `Accounts · ${accounts.length}`),
          accounts.length ? h('div', { class: 'rows', role: 'list' }, accounts.map(a => {
            const b = byId.get(a.id);
            return h('div', { class: ['row', 'acct-row', !a.is_active && 'is-muted'], role: 'listitem' },
              h('button', { type: 'button', class: 'row-main', onclick: () => accountDialog(ctx, a) },
                h('span', { class: 'row-title' }, a.name), h('span', { class: 'row-sub' }, [ACCOUNT_TYPE_LABEL[a.account_type], a.institution].filter(Boolean).join(' · '))),
              h('div', { class: 'row-meta' },
                !a.is_active && chip('Inactive', { tone: 'idle' }),
                b ? chip(b.counts_as_available_cash ? 'Counts as cash' : 'Not counted', { tone: b.counts_as_available_cash ? 'ok' : 'idle' }) : chip(`Opens ${formatShortDate(a.opening_balance_date, ctx.today, ctx.profile.date_format)}`, { tone: 'info' }),
                h('a', { class: 'link small', href: `#/finances/transactions?account=${a.id}` }, 'Transactions'),
                h('span', { class: ['amt', 'num', b && Number(b.balance) < 0 && 'amt-out'] }, b ? fmt(ctx, b.balance) : '—')));
          })) : stateBlock('empty', { title: 'No accounts yet', body: 'Add the business bank account first: its opening balance and date anchor every figure.', action: button('Add account', { kind: 'primary', size: 'sm', iconName: 'plus', onClick: () => accountDialog(ctx) }) }),
          notOpen.length ? h('p', { class: 'faint small' }, `${notOpen.length} account${notOpen.length > 1 ? 's open' : ' opens'} after this date and ${notOpen.length > 1 ? 'are' : 'is'} not included.`) : null),
        h('div', { class: 'fin-grid' },
          h('section', { class: 'fin-section' }, h('h2', { class: 'section-title' }, 'Owed to participants'),
            owed.length ? h('div', { class: 'rows', role: 'list' }, owed.map(s => h('div', { class: 'row', role: 'listitem' },
              h('a', { class: 'row-main', href: `#/finances/transactions/${s.transaction_id}` }, h('span', { class: 'row-title' }, s.description),
                h('span', { class: 'row-sub' }, `${participantName(participants, s.participant_id)} · ${CONTRIBUTION_LABEL[s.contribution_type]} of ${fmt(ctx, s.amount)}`)),
              h('div', { class: 'row-meta' }, h('span', { class: 'amt num amt-warn' }, fmt(ctx, s.outstanding_amount))))))
              : stateBlock('empty', { title: 'Nothing is owed', body: 'Founder loans and expenses paid personally appear here until they are repaid.' })),
          h('section', { class: 'fin-section' }, h('h2', { class: 'section-title' }, h('a', { class: 'link', href: '#/finances/funding' }, 'Funding requirements')),
            requirements.length ? h('div', { class: 'rows', role: 'list' }, requirements.map(r => h('div', { class: 'row fund-row', role: 'listitem' },
              h('a', { class: 'row-main', href: `#/finances/funding/${r.requirement_id}` }, h('span', { class: 'row-title' }, r.title),
                h('span', { class: 'row-sub' }, `${fmt(ctx, r.received_amount)} received of ${fmt(ctx, r.required_amount)} · ${fmt(ctx, r.committed_amount)} committed`)),
              h('div', { class: 'row-meta fund-meta' }, bar(r.received_amount, r.required_amount), chip(r.lifecycle, { tone: r.lifecycle === 'open' ? 'info' : 'idle' })))))
              : stateBlock('empty', { title: 'No funding requirements' }))),
        recurring.length ? h('section', { class: 'fin-section' }, h('h2', { class: 'section-title' }, 'Scheduled'),
          h('p', { class: 'faint small' }, 'Recurring templates are reminders only. Nothing is posted automatically; record each payment as a transaction.'),
          h('div', { class: 'rows', role: 'list' }, recurring.map(r => h('div', { class: ['row', !r.is_active && 'is-muted'], role: 'listitem' },
            h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.description), h('span', { class: 'row-sub' }, `${r.frequency} · ${accounts.find(a => a.id === r.account_id)?.name ?? ''}`)),
            h('div', { class: 'row-meta' }, h('span', null, `Next ${formatShortDate(r.next_due_date, ctx.today, ctx.profile.date_format)}`), h('span', { class: 'amt num' }, fmt(ctx, r.amount))))))) : null);
    } catch (e) { mount(body, stateBlock('error', { title: 'Finances could not load', body: friendlyError(e).message })); }
  };
  asOf.addEventListener('change', () => { history.replaceState(null, '', `#/finances${asOf.value && asOf.value !== ctx.today ? `?asOf=${asOf.value}` : ''}`); draw(); });
  await draw();
  onFinanceChange(ctx, draw, root);
  return root;
}

export const financesModule = { routes: [
  { pattern: '/finances', render: renderOverview },
  { pattern: '/finances/transactions', render: renderTransactions },
  { pattern: '/finances/transactions/:id', render: renderTransactions },
  { pattern: '/finances/funding', render: renderFunding },
  { pattern: '/finances/funding/:id', render: renderRequirement },
  { pattern: '/finances/capital', render: renderCapital },
  { pattern: '/finances/import', render: renderImports },
  { pattern: '/finances/import/:id', render: renderBatch },
] };
