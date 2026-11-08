// Funding: requirement -> commitment (a pledge, not money) -> payment allocation (money received) -> reconciliation.
// Commitment status, received and outstanding amounts come from vw_funding_commitment_status; requirement totals from
// vw_funding_requirement_summary. Revocation is revoke_funding_commitment() with a reason; commitments are never deleted.
import { h, mount } from '../core/dom.js';
import { button, pageHeader, stateBlock, chip } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/overlay.js';
import { field, input, textarea, select, dateInput, setFieldError, nullIfEmpty } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { formatDate, formatShortDate } from '../core/format.js';
import { FIN_ENUMS } from '../data/schema-finance.js';
import { COMMITMENT_LABEL, COMMITMENT_TONE } from './finance-model.js';
import { fmt, financeNav, figure, bar, reasonDialog, onFinanceChange, participantName } from './finance-ui.js';
import { allocateDialog } from './finance-ledger.js';

const LIFECYCLE_TONE = { draft: 'idle', open: 'info', closed: 'ok', cancelled: 'idle' };
const showError = (ctx, f, e) => { const fe = friendlyError(e); const el = f[e.details?.column]; if (el) setFieldError(el, fe.message); else ctx.toast(fe.message, { tone: 'bad' }); };

export async function requirementDialog(ctx, existing = null) {
  const r = existing || {};
  const [projects, milestones] = await Promise.all([ctx.data.projects.list(), ctx.data.milestones.list()]);
  const f = {
    title: input({ value: r.title || '', maxlength: 200, autofocus: true }), required_amount: input({ value: r.required_amount || '', inputmode: 'decimal' }),
    needed_by: dateInput({ value: r.needed_by || '' }), lifecycle: select(FIN_ENUMS.lifecycle, { value: r.lifecycle || 'open' }),
    project_id: select(projects.filter(p => p.status !== 'Archived' || p.id === r.project_id).map(p => [p.id, p.name]), { value: r.project_id || '', placeholder: 'No project' }),
    milestone_id: select(milestones.map(m => [m.id, m.title]), { value: r.milestone_id || '', placeholder: 'No milestone' }),
    notes: textarea({ value: r.notes || '', rows: 2 }),
  };
  openDialog({ title: existing ? 'Edit funding requirement' : 'New funding requirement', description: 'What the business needs money for, and by when.',
    content: h('div', { class: 'form-grid' }, field('Title', f.title, { full: true }), field('Required amount', f.required_amount), field('Needed by', f.needed_by),
      field('Lifecycle', f.lifecycle), field('Project', f.project_id), field('Milestone', f.milestone_id), field('Notes', f.notes, { full: true })),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: existing ? 'Save' : 'Create requirement', kind: 'primary', submit: true, run: async () => {
      Object.values(f).forEach(x => setFieldError(x, ''));
      const row = { title: f.title.value, required_amount: f.required_amount.value.trim(), needed_by: nullIfEmpty(f.needed_by.value), lifecycle: f.lifecycle.value,
        project_id: nullIfEmpty(f.project_id.value), milestone_id: nullIfEmpty(f.milestone_id.value), notes: nullIfEmpty(f.notes.value.trim()) };
      try {
        if (existing) await ctx.data.funding.updateRequirement(r.id, Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== r[k])));
        else { const c = await ctx.data.funding.createRequirement(row); ctx.navigate(`/finances/funding/${c.id}`); }
      } catch (e) { showError(ctx, f, e); return false; }
    } }] });
}

export async function commitmentDialog(ctx, requirementId, existing = null) {
  const c = existing || {};
  const participants = await ctx.data.workspace.participants();
  const who = select(participants.map(p => [p.id, p.full_name]), { value: c.participant_id || '', placeholder: 'An outside funder (no participant)', disabled: !!existing });
  const f = {
    funder_name: input({ value: c.funder_name || '', maxlength: 200, autofocus: true }), committed_amount: input({ value: c.committed_amount || '', inputmode: 'decimal' }),
    expected_payment_date: dateInput({ value: c.expected_payment_date || '' }), notes: textarea({ value: c.notes || '', rows: 2 }),
  };
  who.addEventListener('change', () => { if (!f.funder_name.value && who.value) f.funder_name.value = participants.find(p => p.id === who.value)?.full_name ?? ''; });
  openDialog({ title: existing ? 'Edit commitment' : 'Add a commitment', description: existing ? 'The funder and participant are fixed. Lowering the amount below what was received shows the commitment as over-allocated.'
      : 'A commitment is a pledge: it is not money until a payment is received and allocated to it.',
    content: h('div', { class: 'form-grid' }, field('Participant', who, { full: true, hint: 'A participant’s commitment can only be paid by that participant’s money.' }),
      field('Funder name', f.funder_name, { full: true }), field('Committed amount', f.committed_amount), field('Expected payment', f.expected_payment_date), field('Notes', f.notes, { full: true })),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: existing ? 'Save' : 'Add commitment', kind: 'primary', submit: true, run: async () => {
      Object.values(f).forEach(x => setFieldError(x, ''));
      const row = { funder_name: f.funder_name.value, committed_amount: f.committed_amount.value.trim(), expected_payment_date: nullIfEmpty(f.expected_payment_date.value), notes: nullIfEmpty(f.notes.value.trim()) };
      try {
        if (existing) await ctx.data.funding.updateCommitment(c.id, Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== c[k])));
        else await ctx.data.funding.createCommitment({ ...row, requirement_id: requirementId, participant_id: nullIfEmpty(who.value) });
      } catch (e) { showError(ctx, f, e); return false; }
    } }] });
}

const statusChip = s => chip(COMMITMENT_LABEL[s], { tone: COMMITMENT_TONE[s] });

// ---------- requirement page ----------
export async function renderRequirement(ctx, params, _q, _path, setCrumbs) {
  const root = h('div', { class: 'page page-fin' });
  const draw = async () => {
    const r = await ctx.data.funding.getRequirement(params.id);
    if (!r) { setCrumbs([{ label: 'Not found' }]); mount(root, stateBlock('empty', { title: 'This funding requirement doesn’t exist', action: h('a', { class: 'link', href: '#/finances/funding' }, 'Back to funding') })); return; }
    setCrumbs([{ label: 'Funding', href: '#/finances/funding' }, { label: r.title }]);
    const [summary, statuses, rawCommitments, allocations, txs, participants, project] = await Promise.all([
      ctx.data.funding.requirementSummaries().then(l => l.find(x => x.requirement_id === r.id)), ctx.data.funding.commitments({ eq: { requirement_id: r.id } }),
      ctx.data.funding.commitmentRows(), ctx.data.funding.allocations(), ctx.data.transactions.list(), ctx.data.workspace.participants(), r.project_id ? ctx.data.projects.get(r.project_id) : null]);
    const raw = new Map(rawCommitments.map(c => [c.id, c]));
    const txById = new Map(txs.map(t => [t.id, t]));
    mount(root,
      h('header', { class: 'project-head' },
        h('div', { class: 'project-title-row' }, h('h1', { class: 'page-title' }, r.title), h('div', { class: 'page-actions' },
          button('Edit', { kind: 'secondary', size: 'sm', iconName: 'edit', onClick: () => requirementDialog(ctx, r) }),
          button('Add commitment', { kind: 'primary', size: 'sm', iconName: 'plus', onClick: () => commitmentDialog(ctx, r.id) }),
          !statuses.length && button('', { kind: 'ghost', size: 'sm', iconName: 'trash', title: 'Delete requirement', onClick: async () => {
            if (await confirmDialog({ title: 'Delete this requirement?', body: 'It has no commitments. Requirements with commitments cannot be deleted; close or cancel them instead.', confirmLabel: 'Delete', danger: true })) {
              try { await ctx.data.funding.removeRequirement(r.id); ctx.navigate('/finances/funding'); } catch (e) { ctx.toast(friendlyError(e).message, { tone: 'bad' }); }
            } } }))),
        h('div', { class: 'prop-row' }, chip(r.lifecycle, { tone: LIFECYCLE_TONE[r.lifecycle] }), r.needed_by && h('span', { class: 'faint small' }, `Needed by ${formatDate(r.needed_by, ctx.profile.date_format)}`),
          project && h('a', { class: 'proj-tag', href: `#/projects/${project.id}` }, project.name))),
      r.notes && h('p', { class: 'muted' }, r.notes),
      h('div', { class: 'fig-strip' }, figure('Required', fmt(ctx, summary.required_amount)), figure('Committed', fmt(ctx, summary.committed_amount), { sub: 'Excludes revoked' }),
        figure('Received', fmt(ctx, summary.received_amount), { tone: 'ok', sub: 'Allocated payments' }), figure('Outstanding', fmt(ctx, summary.outstanding_commitments), { sub: 'Committed, not yet paid' }),
        figure('Not yet committed', fmt(ctx, summary.uncommitted_gap), { tone: Number(summary.uncommitted_gap) > 0 ? 'warn' : undefined })),
      h('div', { class: 'fund-bar' }, bar(summary.received_amount, summary.required_amount, { tone: 'ok' })),
      h('section', { class: 'fin-section' }, h('h2', { class: 'section-title' }, `Commitments · ${statuses.length}`),
        statuses.length ? h('div', { class: 'commitments' }, statuses.map(s => {
          const mine = allocations.filter(a => a.commitment_id === s.commitment_id);
          const revoked = s.status === 'revoked';
          return h('article', { class: ['commitment', revoked && 'is-revoked'] },
            h('header', { class: 'commitment-head' }, statusChip(s.status), h('strong', null, s.funder_name),
              s.participant_id && h('span', { class: 'faint small' }, participantName(participants, s.participant_id)),
              h('span', { class: 'commitment-amt num' }, fmt(ctx, s.committed_amount))),
            h('div', { class: 'commitment-figs small' },
              h('span', null, 'Received ', h('strong', { class: 'num' }, fmt(ctx, s.received_amount))), h('span', null, 'Outstanding ', h('strong', { class: 'num' }, fmt(ctx, s.outstanding_amount))),
              s.expected_payment_date && !revoked && h('span', null, `Expected ${formatShortDate(s.expected_payment_date, ctx.today, ctx.profile.date_format)}`),
              s.status === 'over_allocated' && h('span', { class: 'fg-bad' }, 'More was received than committed. Raise the commitment, or reverse an allocation.')),
            revoked && h('p', { class: 'faint small' }, `Revoked ${formatDate(s.revoked_at.slice(0, 10), ctx.profile.date_format)}: ${s.revocation_reason}`),
            raw.get(s.commitment_id)?.notes && h('p', { class: 'faint small' }, raw.get(s.commitment_id).notes),
            mine.length ? h('ul', { class: 'plain-list alloc-list' }, mine.map(a => {
              const t = txById.get(a.transaction_id);
              return h('li', { class: a.is_reversed && 'is-reversed' }, h('a', { class: 'link', href: `#/finances/transactions/${a.transaction_id}` }, t?.description ?? 'Payment'),
                ` · ${fmt(ctx, a.amount)} · ${t ? formatDate(t.transaction_date, ctx.profile.date_format) : ''}`,
                a.is_reversed ? h('span', { class: 'faint small' }, ` · reversed: ${a.reversal_reason}`)
                  : button('Reverse', { kind: 'ghost', size: 'sm', onClick: () => reasonDialog(ctx, { title: 'Reverse this payment allocation?', description: 'The money stays recorded in the ledger; it stops counting towards this commitment.', confirmLabel: 'Reverse allocation', run: x => ctx.data.funding.reverseAllocation(a.id, x) }) }));
            })) : !revoked && h('p', { class: 'faint small' }, 'Nothing received yet.'),
            !revoked && h('div', { class: 'row-actions' },
              button('Record payment', { kind: 'secondary', size: 'sm', iconName: 'link', onClick: () => allocateDialog(ctx, { commitment: s }) }),
              button('Edit', { kind: 'ghost', size: 'sm', iconName: 'edit', onClick: () => commitmentDialog(ctx, r.id, raw.get(s.commitment_id)) }),
              button('Revoke…', { kind: 'ghost', size: 'sm', onClick: () => {
                if (mine.some(a => !a.is_reversed)) { ctx.toast('Money has been received against this commitment. Reverse those allocations first, then revoke it.', { tone: 'warn' }); return; }
                reasonDialog(ctx, { title: `Revoke ${s.funder_name}’s commitment?`, description: 'It stays on record as revoked, with your reason. It cannot be un-revoked or edited afterwards.', confirmLabel: 'Revoke', run: x => ctx.data.funding.revokeCommitment(s.commitment_id, x) });
              } })));
        })) : stateBlock('empty', { title: 'No commitments yet', body: 'Add who has pledged money towards this requirement.', action: button('Add commitment', { kind: 'primary', size: 'sm', iconName: 'plus', onClick: () => commitmentDialog(ctx, r.id) }) })));
  };
  await draw();
  onFinanceChange(ctx, draw, root);
  return root;
}

// ---------- requirements list ----------
export async function renderFunding(ctx) {
  const listEl = h('div', { class: 'list-wrap' }, stateBlock('loading'));
  const root = h('div', { class: 'page page-fin' },
    pageHeader({ title: 'Funding', subtitle: 'Requirements, who has committed, and what has actually been received.',
      actions: [button('New requirement', { kind: 'primary', iconName: 'plus', onClick: () => requirementDialog(ctx) })] }),
    financeNav('funding'), listEl);
  const draw = async () => {
    const [sums, statuses] = await Promise.all([ctx.data.funding.requirementSummaries(), ctx.data.funding.commitments()]);
    if (!sums.length) { mount(listEl, stateBlock('empty', { title: 'No funding requirements yet', action: button('New requirement', { kind: 'primary', size: 'sm', iconName: 'plus', onClick: () => requirementDialog(ctx) }) })); return; }
    sums.sort((a, b) => (a.needed_by ?? '9999') < (b.needed_by ?? '9999') ? -1 : 1);
    mount(listEl, h('div', { class: 'fund-cards' }, sums.map(r => {
      const mine = statuses.filter(s => s.requirement_id === r.requirement_id);
      const counts = Object.entries(COMMITMENT_LABEL).map(([k, l]) => [l, mine.filter(s => s.status === k).length, k]).filter(([, n]) => n);
      return h('a', { class: 'fund-card', href: `#/finances/funding/${r.requirement_id}` },
        h('div', { class: 'fund-card-head' }, h('strong', null, r.title), chip(r.lifecycle, { tone: LIFECYCLE_TONE[r.lifecycle] })),
        h('div', { class: 'fund-card-figs' }, h('span', { class: 'num fund-big' }, fmt(ctx, r.received_amount)), h('span', { class: 'faint small' }, ` received of ${fmt(ctx, r.required_amount)}`)),
        bar(r.received_amount, r.required_amount, { tone: 'ok' }),
        h('div', { class: 'fund-card-foot small' }, h('span', null, `Committed ${fmt(ctx, r.committed_amount)}`), Number(r.uncommitted_gap) > 0 && h('span', { class: 'fg-warn' }, `Gap ${fmt(ctx, r.uncommitted_gap)}`),
          r.needed_by && h('span', { class: 'faint' }, `By ${formatShortDate(r.needed_by, ctx.today, ctx.profile.date_format)}`)),
        counts.length ? h('div', { class: 'fund-card-chips' }, counts.map(([l, n, k]) => chip(`${n} ${l.toLowerCase()}`, { tone: COMMITMENT_TONE[k] }))) : null);
    })));
  };
  await draw();
  onFinanceChange(ctx, draw, root);
  return root;
}
