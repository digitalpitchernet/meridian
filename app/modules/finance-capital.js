// Capital: the agreed structure, its targets and what each participant is expected to contribute (allocations),
// next to what they actually contributed, lent and are owed. Ownership (participants.agreed_equity_percentage),
// capital allocations and money are independent records: nothing here derives one from another, and over-allocation
// is shown, never blocked (vw_capital_target_summary, vw_capital_structure_summary, vw_participant_contribution_summary).
import { h, mount } from '../core/dom.js';
import { button, pageHeader, stateBlock, chip } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/overlay.js';
import { field, input, textarea, select, dateInput, setFieldError, nullIfEmpty } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { formatDate } from '../core/format.js';
import { ALLOCATION_LABEL } from './finance-model.js';
import { fmt, financeNav, figure, bar, onFinanceChange, participantName } from './finance-ui.js';

const TONE = { under_allocated: 'info', fully_allocated: 'ok', over_allocated: 'bad' };
const save = async (ctx, f, fn) => {
  Object.values(f).forEach(x => setFieldError(x, ''));
  try { await fn(); } catch (e) { const fe = friendlyError(e); const el = f[e.details?.column]; if (el) setFieldError(el, fe.message); else ctx.toast(fe.message, { tone: 'bad' }); return false; }
};
const changed = (row, old) => Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== old[k]));

function structureDialog(ctx, existing = null) {
  const s = existing || {};
  const f = { title: input({ value: s.title || 'Primary capital structure', maxlength: 200, autofocus: true }), agreed_capital_target: input({ value: s.agreed_capital_target || '', inputmode: 'decimal' }),
    contribution_basis: input({ value: s.contribution_basis || '', placeholder: 'For example: 60/40 founders' }), effective_date: dateInput({ value: s.effective_date || ctx.today }), notes: textarea({ value: s.notes || '', rows: 2 }) };
  const current = h('input', { type: 'checkbox', checked: existing ? s.is_current : true });
  openDialog({ title: existing ? 'Edit capital structure' : 'New capital structure',
    content: h('div', { class: 'form-grid' }, field('Title', f.title, { full: true }), field('Agreed capital target', f.agreed_capital_target), field('Effective date', f.effective_date),
      field('Contribution basis', f.contribution_basis, { full: true }), field('Notes', f.notes, { full: true }), h('label', { class: 'check-row field-full' }, current, 'Current structure (used in participant summaries)')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: existing ? 'Save' : 'Create', kind: 'primary', submit: true, run: () => save(ctx, f, () => {
      const row = { title: f.title.value, agreed_capital_target: f.agreed_capital_target.value.trim(), contribution_basis: nullIfEmpty(f.contribution_basis.value.trim()), effective_date: f.effective_date.value, notes: nullIfEmpty(f.notes.value.trim()), is_current: current.checked };
      return existing ? ctx.data.capital.updateStructure(s.id, changed(row, s)) : ctx.data.capital.createStructure(row);
    }) }] });
}

function targetDialog(ctx, structureId, existing = null) {
  const t = existing || {};
  const f = { name: input({ value: t.name || '', maxlength: 200, autofocus: true }), target_amount: input({ value: t.target_amount || '', inputmode: 'decimal' }), target_date: dateInput({ value: t.target_date || '' }) };
  openDialog({ title: existing ? 'Edit capital target' : 'Add a capital target',
    content: h('div', { class: 'form-grid' }, field('Name', f.name, { full: true }), field('Target amount', f.target_amount), field('Target date', f.target_date)),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: existing ? 'Save' : 'Add target', kind: 'primary', submit: true, run: () => save(ctx, f, () => {
      const row = { name: f.name.value, target_amount: f.target_amount.value.trim(), target_date: nullIfEmpty(f.target_date.value) };
      return existing ? ctx.data.capital.updateTarget(t.id, changed(row, t)) : ctx.data.capital.createTarget({ ...row, structure_id: structureId });
    }) }] });
}

async function allocationDialog(ctx, structureId, targets, existing = null) {
  const a = existing || {};
  const participants = await ctx.data.workspace.participants();
  const f = { participant_id: select(participants.map(p => [p.id, p.full_name]), { value: a.participant_id || participants[0]?.id, disabled: !!existing }),
    capital_target_id: select(targets.map(t => [t.id, t.name]), { value: a.capital_target_id || '', placeholder: 'The structure as a whole' }),
    allocated_amount: input({ value: a.allocated_amount || '', inputmode: 'decimal', autofocus: true }), basis_notes: input({ value: a.basis_notes || '' }) };
  const active = h('input', { type: 'checkbox', checked: existing ? a.is_active : true });
  openDialog({ title: existing ? 'Edit participant allocation' : 'Allocate capital to a participant', description: 'What this participant is expected to contribute. It is not ownership and it is not money received.',
    content: h('div', { class: 'form-grid' }, field('Participant', f.participant_id), field('Against', f.capital_target_id), field('Allocated amount', f.allocated_amount), field('Basis', f.basis_notes),
      h('label', { class: 'check-row field-full' }, active, 'Active')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: existing ? 'Save' : 'Allocate', kind: 'primary', submit: true, run: () => save(ctx, f, () => {
      const row = { capital_target_id: nullIfEmpty(f.capital_target_id.value), allocated_amount: f.allocated_amount.value.trim(), basis_notes: nullIfEmpty(f.basis_notes.value.trim()), is_active: active.checked };
      return existing ? ctx.data.capital.updateAllocation(a.id, changed(row, a)) : ctx.data.capital.createAllocation({ ...row, structure_id: structureId, participant_id: f.participant_id.value });
    }) }] });
}

export async function renderCapital(ctx) {
  const body = h('div', { class: 'fin-body' }, stateBlock('loading'));
  const root = h('div', { class: 'page page-fin' },
    pageHeader({ title: 'Capital', subtitle: 'The agreed capital plan next to what each participant has actually put in, lent and is owed.',
      actions: [button('New structure', { kind: 'secondary', iconName: 'plus', onClick: () => structureDialog(ctx) })] }),
    financeNav('capital'), body);
  const draw = async () => {
    const [structures, sSums, targets, tSums, allocs, contributions, participants] = await Promise.all([ctx.data.capital.structures(), ctx.data.capital.structureSummaries(),
      ctx.data.capital.targets(), ctx.data.capital.targetSummaries(), ctx.data.capital.allocations(), ctx.data.transactions.contributions(), ctx.data.workspace.participants()]);
    mount(body,
      h('section', { class: 'fin-section' }, h('h2', { class: 'section-title' }, 'By participant'),
        h('p', { class: 'faint small' }, 'Kept as separate figures and never netted. Agreed ownership is a separate record; money and allocations never change it.'),
        h('div', { class: 'table-scroll' }, h('table', { class: 'fin-table' },
          h('thead', null, h('tr', null, ['Participant', 'Agreed equity', 'Capital allocated', 'Capital contributed', 'Commitments outstanding', 'Loans advanced', 'Loans outstanding', 'Reimbursements owed'].map((x, i) => h('th', { class: i ? 'num' : null, scope: 'col' }, x)))),
          h('tbody', null, contributions.map(c => h('tr', null, h('th', { scope: 'row' }, c.full_name, h('span', { class: 'faint small' }, ` · ${c.participant_type}`)),
            h('td', { class: 'num' }, c.agreed_equity_percentage != null ? `${c.agreed_equity_percentage}%` : '—'),
            ...['capital_allocated', 'capital_contributed', 'commitments_outstanding', 'loans_advanced', 'loans_outstanding', 'reimbursements_owed'].map(k => h('td', { class: ['num', Number(c[k]) === 0 && 'faint'] }, fmt(ctx, c[k]))))))))),
      structures.length ? structures.map(s => {
        const sum = sSums.find(x => x.structure_id === s.id);
        const mine = tSums.filter(t => t.structure_id === s.id);
        const rawTargets = targets.filter(t => t.structure_id === s.id);
        const mineAllocs = allocs.filter(a => a.structure_id === s.id);
        return h('section', { class: ['fin-section', 'cap-structure', !s.is_current && 'is-muted'] },
          h('div', { class: 'cap-head' }, h('h2', { class: 'section-title' }, s.title), s.is_current ? chip('Current', { tone: 'ok' }) : chip('Not current', { tone: 'idle' }),
            h('span', { class: 'faint small' }, `Effective ${formatDate(s.effective_date, ctx.profile.date_format)}${s.contribution_basis ? ` · ${s.contribution_basis}` : ''}`),
            button('Edit', { kind: 'ghost', size: 'sm', iconName: 'edit', onClick: () => structureDialog(ctx, s) })),
          h('div', { class: 'fig-strip' }, figure('Agreed capital', fmt(ctx, sum.agreed_capital_target)), figure('Allocated to participants', fmt(ctx, sum.allocated_amount)),
            figure(sum.allocation_status === 'over_allocated' ? 'Over-allocated by' : 'Unallocated', fmt(ctx, sum.allocation_status === 'over_allocated' ? sum.over_allocated_amount : sum.unallocated_amount), { tone: sum.allocation_status === 'over_allocated' ? 'bad' : undefined }),
            figure('Targets total', fmt(ctx, sum.total_target_amount), { sub: Number(sum.targets_exceed_structure_by) > 0 ? `Exceeds the agreed capital by ${fmt(ctx, sum.targets_exceed_structure_by)}` : null, tone: Number(sum.targets_exceed_structure_by) > 0 ? 'warn' : undefined })),
          h('h3', { class: 'subsection-title' }, 'Targets', button('Add target', { kind: 'ghost', size: 'sm', iconName: 'plus', onClick: () => targetDialog(ctx, s.id) })),
          mine.length ? h('div', { class: 'rows', role: 'list' }, mine.map(t => {
            const raw = rawTargets.find(x => x.id === t.capital_target_id);
            return h('div', { class: 'row', role: 'listitem' },
              h('button', { type: 'button', class: 'row-main', onclick: () => targetDialog(ctx, s.id, raw) }, h('span', { class: 'row-title' }, t.name),
                h('span', { class: 'row-sub' }, `${fmt(ctx, t.allocated_amount)} allocated of ${fmt(ctx, t.target_amount)}${raw?.target_date ? ` · by ${formatDate(raw.target_date, ctx.profile.date_format)}` : ''}`)),
              h('div', { class: 'row-meta fund-meta' }, bar(t.allocated_amount, t.target_amount, { tone: TONE[t.allocation_status] === 'bad' ? 'bad' : undefined }), chip(ALLOCATION_LABEL[t.allocation_status], { tone: TONE[t.allocation_status] }),
                button('', { kind: 'ghost', size: 'sm', iconName: 'trash', title: `Delete target ${t.name}`, onClick: async () => {
                  if (await confirmDialog({ title: 'Delete this target?', body: 'Only possible while no participant allocation points at it.', confirmLabel: 'Delete', danger: true })) ctx.data.capital.removeTarget(t.capital_target_id).catch(e => ctx.toast(e.code === '23503' ? 'Participant allocations point at this target. Move or delete them first.' : friendlyError(e).message, { tone: 'bad' }));
                } })));
          })) : h('p', { class: 'faint small' }, 'No targets.'),
          h('h3', { class: 'subsection-title' }, 'Participant allocations', button('Allocate', { kind: 'ghost', size: 'sm', iconName: 'plus', onClick: () => allocationDialog(ctx, s.id, rawTargets) })),
          mineAllocs.length ? h('div', { class: 'rows', role: 'list' }, mineAllocs.map(a => h('div', { class: ['row', !a.is_active && 'is-muted'], role: 'listitem' },
            h('button', { type: 'button', class: 'row-main', onclick: () => allocationDialog(ctx, s.id, rawTargets, a) }, h('span', { class: 'row-title' }, participantName(participants, a.participant_id)),
              h('span', { class: 'row-sub' }, [rawTargets.find(t => t.id === a.capital_target_id)?.name ?? 'Whole structure', a.basis_notes, !a.is_active && 'Inactive'].filter(Boolean).join(' · '))),
            h('div', { class: 'row-meta' }, h('span', { class: 'amt num' }, fmt(ctx, a.allocated_amount)),
              button('', { kind: 'ghost', size: 'sm', iconName: 'trash', title: 'Delete allocation', onClick: async () => {
                if (await confirmDialog({ title: 'Delete this allocation?', body: 'Allocations are plans, not money: deleting one changes no balance. You can also mark it inactive instead.', confirmLabel: 'Delete', danger: true })) ctx.data.capital.removeAllocation(a.id).catch(e => ctx.toast(friendlyError(e).message, { tone: 'bad' }));
              } }))))) : h('p', { class: 'faint small' }, 'No participant allocations.'));
      }) : stateBlock('empty', { title: 'No capital structure yet', action: button('New structure', { kind: 'primary', size: 'sm', iconName: 'plus', onClick: () => structureDialog(ctx) }) }));
  };
  await draw();
  onFinanceChange(ctx, draw, root);
  return root;
}
