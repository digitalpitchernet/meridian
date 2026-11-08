// Settings module (M4.1): Business profile, founder preferences, and development data controls.
// Schema: businesses (profile-level), profiles (preferences), participants (founder/co-founder).
// Business profile: base_currency is fixed after onboarding; other fields editable.
// Profiles: theme, accent, date/time/number formats, week start, countdown prefs, widget layout.
// Participants: founder and co-founder records with equity, designation, contact info.
import { h, mount } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { button, pageHeader, stateBlock, chip, avatar } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/overlay.js';
import { field, input, textarea, select, setFieldError, nullIfEmpty } from '../ui/forms.js';
import { friendlyError } from '../ui/errors.js';
import { ENUMS } from '../data/schema.js';
import { formatDateTime } from '../core/format.js';

const PARTICIPANT_TYPES = ['founder', 'cofounder', 'investor', 'advisor', 'lender', 'other'];

async function businessDialog(ctx, biz) {
  const b = biz || {};
  const f = {
    business_name: input({ value: b.business_name || '', maxlength: 200, autofocus: true }),
    legal_entity_name: input({ value: b.legal_entity_name || '', maxlength: 200 }),
    industry: input({ value: b.industry || '', maxlength: 100 }),
    locale: input({ value: b.locale || 'en-IN', maxlength: 10, placeholder: 'e.g., en-IN, en-US' }),
    timezone: input({ value: b.timezone || 'Asia/Kolkata', maxlength: 64, placeholder: 'IANA tz, e.g., Asia/Kolkata' }),
    financial_year_start_month: select(
      Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1} — ${new Date(2000, i, 1).toLocaleString('default', { month: 'long' })}`]),
      { value: String(b.financial_year_start_month || 4) }
    ),
    accent_color: input({ value: b.accent_color || '#3B82F6', type: 'color' }),
    // base_currency is shown but not editable after onboarding
    base_currency: input({ value: b.base_currency || 'INR', maxlength: 3, readonly: true, title: 'Fixed after onboarding' }),
  };

  openDialog({
    title: 'Business profile',
    description: 'Base currency is fixed after onboarding and cannot be changed.',
    content: h('div', { class: 'form-grid' },
      field('Business name', f.business_name),
      field('Legal entity name', f.legal_entity_name),
      field('Industry', f.industry),
      field('Locale', f.locale),
      field('Timezone', f.timezone),
      field('Financial year starts', f.financial_year_start_month),
      field('Accent colour', f.accent_color),
      field('Base currency', f.base_currency, { help: 'Fixed after onboarding' })
    ),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Save', kind: 'primary', submit: true, run: async () => {
        Object.values(f).forEach(x => setFieldError(x, ''));
        const row = Object.fromEntries(
          Object.entries(f).map(([k, el]) =>
            k === 'base_currency' ? [] : // not sent
            k === 'financial_year_start_month' ? [k, Number(el.value)] :
            [k, nullIfEmpty(el.value?.trim())]
          ).filter(x => x.length)
        );
        try {
          await ctx.data.workspace.updateBusiness(biz.id, row);
          ctx.toast('Business profile updated');
        } catch (e) {
          const fe = friendlyError(e);
          if (f[fe.column]) setFieldError(f[fe.column], fe.message);
          else ctx.toast(fe.message, { tone: 'bad' });
          return false;
        }
      }
    }]
  });
}

async function preferencesDialog(ctx, profile) {
  const p = profile || {};
  const f = {
    full_name: input({ value: p.full_name || '', maxlength: 200, autofocus: true }),
    role_title: input({ value: p.role_title || '', maxlength: 100 }),
    theme: select(ENUMS.theme.map(v => [v, v]), { value: p.theme || 'dark' }),
    date_format: select(ENUMS.dateFormat.map(v => [v, v]), { value: p.date_format || 'DD/MM/YYYY' }),
    time_format: select(ENUMS.timeFormat.map(v => [v, v]), { value: p.time_format || '24h' }),
    week_start_day: select(ENUMS.weekStart.map(v => [v, v]), { value: p.week_start_day || 'Monday' }),
    number_format: input({ value: p.number_format || 'en-IN', maxlength: 16, placeholder: 'e.g., en-IN, en-US, de-DE' }),
  };

  // Countdown preferences
  const countdown = p.countdown_preferences || { show_milestone_countdowns: true, show_runway_days: true };
  const fCountdown = {
    show_milestone_countdowns: input({ type: 'checkbox', checked: countdown.show_milestone_countdowns }),
    show_runway_days: input({ type: 'checkbox', checked: countdown.show_runway_days }),
  };

  // Widget layout (order + hidden)
  const allWidgets = ['kpi', 'attention', 'projects', 'finance', 'funding', 'schedule', 'activity'];
  const layout = p.widget_layout || { order: allWidgets, hidden: [] };
  const fLayout = {
    order: select(allWidgets.map(w => [w, w]), { value: layout.order[0] || 'kpi', multiple: true, size: allWidgets.length }),
    hidden: allWidgets.map(w => h('label', { class: 'checkbox-inline' },
      input({ type: 'checkbox', value: w, checked: layout.hidden?.includes(w), onchange: e => {
        if (e.target.checked) layout.hidden.push(w); else layout.hidden = layout.hidden.filter(x => x !== w);
      } }), w
    )),
  };

  openDialog({
    title: 'Founder preferences',
    size: 'lg',
    content: h('div', { class: 'form-grid' },
      field('Full name', f.full_name),
      field('Role / title', f.role_title),
      h('hr', { class: 'form-sep' }),
      field('Theme', f.theme),
      field('Date format', f.date_format),
      field('Time format', f.time_format),
      field('Week starts on', f.week_start_day),
      field('Number format (locale)', f.number_format, { help: 'BCP 47 locale, e.g., en-IN, en-US, de-DE' }),
      h('hr', { class: 'form-sep' }),
      h('h4', { class: 'section-title small' }, 'Countdown preferences'),
      field('Milestone countdowns', h('div', null, fCountdown.show_milestone_countdowns)),
      field('Runway days', h('div', null, fCountdown.show_runway_days)),
      h('hr', { class: 'form-sep' }),
      h('h4', { class: 'section-title small' }, 'Dashboard widget layout'),
      field('Order (drag not yet implemented; select first)', fLayout.order),
      field('Hidden widgets', h('div', { class: 'checkbox-group' }, fLayout.hidden))
    ),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Save', kind: 'primary', submit: true, run: async () => {
        Object.values(f).forEach(x => setFieldError(x, ''));
        const row = Object.fromEntries(
          Object.entries(f).map(([k, el]) => {
            if (k === 'order') return [k, Array.from(el.selectedOptions).map(o => o.value)];
            if (k === 'hidden') return null; // handled below
            return [k, k === 'full_name' ? el.value : nullIfEmpty(el.value?.trim())];
          }).filter(x => x)
        );
        row.countdown_preferences = {
          show_milestone_countdowns: fCountdown.show_milestone_countdowns.checked,
          show_runway_days: fCountdown.show_runway_days.checked,
        };
        row.widget_layout = { order: layout.order, hidden: layout.hidden };
        try {
          await ctx.data.workspace.updateProfile(profile.id, row);
          ctx.toast('Preferences saved');
        } catch (e) {
          const fe = friendlyError(e);
          if (f[fe.column]) setFieldError(f[fe.column], fe.message);
          else ctx.toast(fe.message, { tone: 'bad' });
          return false;
        }
      }
    }]
  });
}

async function participantDialog(ctx, existing = null, allParticipants = []) {
  const p = existing || {};
  const f = {
    full_name: input({ value: p.full_name || '', maxlength: 200, autofocus: true }),
    participant_type: select(PARTICIPANT_TYPES.map(v => [v, v]), { value: p.participant_type || 'investor' }),
    designation: input({ value: p.designation || '', maxlength: 100, placeholder: 'e.g., Founder, CTO, Angel Investor' }),
    email: input({ value: p.email || '', type: 'email', inputmode: 'email' }),
    phone: input({ value: p.phone || '', type: 'tel' }),
    agreed_equity_percentage: input({ value: p.agreed_equity_percentage ?? '', type: 'number', step: '0.01', min: '0', max: '100', placeholder: '0' }),
    notes: textarea({ value: p.notes || '', rows: 3 }),
  };

  // Warn if adding another founder
  const hasFounder = allParticipants.some(x => x.participant_type === 'founder' && x.id !== p.id);
  const isFounder = f.participant_type.value === 'founder';

  openDialog({
    title: existing ? 'Edit participant' : 'Add participant',
    description: hasFounder && isFounder ? 'A founder already exists. Adding another is allowed but unusual.' : undefined,
    content: h('div', { class: 'form-grid' },
      field('Full name', f.full_name),
      field('Type', f.participant_type),
      field('Designation', f.designation),
      field('Email', f.email),
      field('Phone', f.phone),
      field('Agreed equity %', f.agreed_equity_percentage, { hint: 'Agreed ownership, 0–100. Money and capital allocations never change it.' }),
      field('Notes', f.notes, { full: true })
    ),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: existing ? 'Save' : 'Add participant', kind: 'primary', submit: true, run: async () => {
        Object.values(f).forEach(x => setFieldError(x, ''));
        const row = Object.fromEntries(
          Object.entries(f).map(([k, el]) => {
            if (k === 'agreed_equity_percentage') return [k, el.value.trim() || '0']; // NOT NULL DEFAULT 0
            return [k, k === 'full_name' ? el.value : nullIfEmpty(el.value?.trim())];
          })
        );
        try {
          if (existing) {
            const patch = Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== existing[k]));
            if (Object.keys(patch).length) await ctx.data.workspace.updateParticipant(existing.id, patch);
          } else {
            await ctx.data.workspace.createParticipant(row);
          }
          ctx.toast(existing ? 'Participant updated' : 'Participant added');
        } catch (e) {
          const fe = friendlyError(e);
          if (f[fe.column]) setFieldError(f[fe.column], fe.message);
          else ctx.toast(fe.message, { tone: 'bad' });
          return false;
        }
      }
    }]
  });
}

// ---------- participant removal and deactivation ----------
// The database is the authority (migrations 1, 3, 4): DELETE is granted, but transactions, funding_commitments and
// participant_capital_allocations reference participants ON DELETE RESTRICT, so anyone with money, pledges or capital
// plans on record cannot be deleted. Deactivation (participants.is_active) keeps every record and hides the
// participant from pickers for new entries. The participant linked to the signed-in founder's profile is the account
// owner's own record: the app offers neither removal nor deactivation for it.
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isOwner = (ctx, p) => p.profile_id != null && p.profile_id === ctx.profile.id;

function setActive(ctx, p, active) {
  if (active) return ctx.data.workspace.setParticipantActive(p.id, true).then(() => ctx.toast(`${p.full_name} is active again`)).catch(e => ctx.toast(friendlyError(e).message, { tone: 'bad' }));
  return confirmDialog({ title: `Deactivate ${p.full_name}?`, confirmLabel: 'Deactivate',
    body: h('div', null, h('p', null, 'Every record that mentions them stays exactly as it is: transactions, commitments, capital allocations and their contribution figures.'),
      h('p', null, 'They will no longer be offered for new commitments or capital allocations. While money is still owed to them, they stay available for recording repayments. You can reactivate them at any time.')) })
    .then(ok => ok && ctx.data.workspace.setParticipantActive(p.id, false).then(() => ctx.toast(`${p.full_name} deactivated`)))
    .catch(e => ctx.toast(friendlyError(e).message, { tone: 'bad' }));
}

async function removeParticipant(ctx, p) {
  if (isOwner(ctx, p)) {
    openDialog({ title: `${p.full_name} can’t be removed`, size: 'sm',
      content: h('div', { class: 'confirm-body' }, h('p', null, 'This is your own participant record, linked to the account you are signed in with. It anchors your contributions, loans and equity.'),
        h('p', null, 'You can edit its details, but not remove or deactivate it.')),
      actions: [{ label: 'Close', kind: 'secondary' }] });
    return;
  }
  const usage = await ctx.data.workspace.participantUsage(p.id);
  if (usage.total) {
    const lines = [usage.transactions && plural(usage.transactions, 'transaction'), usage.commitments && plural(usage.commitments, 'funding commitment'),
      usage.capitalAllocations && plural(usage.capitalAllocations, 'capital allocation')].filter(Boolean);
    openDialog({ title: `${p.full_name} can’t be removed`, size: 'sm',
      content: h('div', { class: 'confirm-body' }, h('p', null, `${p.full_name} is part of the financial history:`), h('ul', { class: 'plain-list dep-list' }, lines.map(l => h('li', null, l))),
        h('p', null, 'Removing them would break those records, so the database refuses it. Reversed transactions and revoked commitments count too: they are kept as history.'),
        h('p', null, p.is_active ? 'Deactivate them instead: their records stay intact and they stop appearing for new entries.' : 'They are already inactive, which keeps their records intact.')),
      actions: [{ label: 'Close', kind: 'ghost' }, ...(p.is_active ? [{ label: 'Deactivate instead', kind: 'primary', run: () => { setActive(ctx, p, false); } }] : [])] });
    return;
  }
  const equity = Number(p.agreed_equity_percentage) > 0;
  const ok = await confirmDialog({ title: `Remove ${p.full_name}?`, danger: true, confirmLabel: 'Remove participant',
    body: h('div', null, h('p', null, h('strong', null, p.full_name), ` · ${p.participant_type}${p.designation ? ` · ${p.designation}` : ''}`),
      h('p', null, 'No transactions, funding commitments or capital allocations refer to them, so nothing else changes.'),
      h('p', null, `Their participant record is deleted permanently: name, contact details${equity ? `, and the agreed equity of ${p.agreed_equity_percentage}%` : ''}. This can’t be undone.`),
      equity && h('p', { class: 'fg-warn' }, 'Agreed ownership will no longer include this share.')) });
  if (!ok) return;
  try { await ctx.data.workspace.removeParticipant(p.id); ctx.toast(`${p.full_name} removed`); }
  catch (e) { ctx.toast(e.code === '23503' ? `${p.full_name} now has financial records, so they can’t be removed. Deactivate them instead.` : friendlyError(e).message, { tone: 'bad' }); }
}

function participantRow(ctx, p, allParticipants) {
  const typeTone = p.participant_type === 'founder' ? 'accent' : p.participant_type === 'cofounder' ? 'ok' : 'idle';
  const owner = isOwner(ctx, p);
  return h('div', { class: ['row', 'participant-row', !p.is_active && 'is-muted'], role: 'listitem' },
    avatar(p.full_name, { size: 26 }),
    h('button', { type: 'button', class: 'row-main', title: `Edit ${p.full_name}`, onclick: () => participantDialog(ctx, p, allParticipants) },
      h('span', { class: 'row-title' }, p.full_name),
      h('span', { class: 'row-sub' }, [p.designation, p.email, `${Number(p.agreed_equity_percentage).toFixed(2)}% equity`].filter(Boolean).join(' · '))),
    h('div', { class: 'row-meta participant-meta' },
      owner && chip('You', { tone: 'info' }), chip(p.participant_type, { tone: typeTone }), !p.is_active && chip('Inactive', { tone: 'idle' }),
      button('Edit', { kind: 'ghost', size: 'sm', iconName: 'edit', aria: { label: `Edit ${p.full_name}` }, onClick: () => participantDialog(ctx, p, allParticipants) }),
      !owner && (p.is_active ? button('Deactivate', { kind: 'ghost', size: 'sm', aria: { label: `Deactivate ${p.full_name}` }, onClick: () => setActive(ctx, p, false) })
        : button('Reactivate', { kind: 'ghost', size: 'sm', iconName: 'refresh', aria: { label: `Reactivate ${p.full_name}` }, onClick: () => setActive(ctx, p, true) })),
      button('Remove', { kind: 'ghost', size: 'sm', iconName: 'trash', aria: { label: `Remove ${p.full_name}` }, onClick: () => removeParticipant(ctx, p) })));
}

async function renderSettings(ctx, _params, _query) {
  // Business profile (singleton per installation)
  let business = null;
  let profile = null;
  let participants = [];

  const bizSection = h('section', { class: 'plain-section' });
  const prefSection = h('section', { class: 'plain-section' });
  const partSection = h('section', { class: 'plain-section' });

  const draw = async () => {
    [business, profile, participants] = await Promise.all([
      ctx.data.workspace.business(),
      ctx.data.workspace.profile(),
      ctx.data.workspace.participants(),
    ]);

    // --- Business ---
    mount(bizSection,
      h('h2', { class: 'section-title' }, 'Business profile'),
      business ? h('div', { class: 'rows' },
        h('div', { class: 'row business-row', role: 'listitem' },
          h('div', { class: 'row-main' },
            h('span', { class: 'row-title' }, business.business_name),
            h('span', { class: 'row-sub' }, [business.legal_entity_name, business.industry].filter(Boolean).join(' · ') || '—')
          ),
          h('div', { class: 'row-meta' },
            h('span', { class: 'faint small' }, `Base currency: ${business.base_currency}`),
            h('span', { class: 'faint small' }, `FY starts: ${business.financial_year_start_month}`),
            h('span', { class: 'faint small' }, business.timezone),
            button('Edit', { kind: 'secondary', size: 'sm', iconName: 'edit', onClick: () => businessDialog(ctx, business) })
          )
        )
      ) : stateBlock('empty', { title: 'No business loaded' }),
      h('p', { class: 'faint small' }, 'One business per installation. Base currency is fixed after onboarding.')
    );

    // --- Preferences ---
    mount(prefSection,
      h('h2', { class: 'section-title' }, 'Founder preferences'),
      profile ? h('div', { class: 'rows' },
        h('div', { class: 'row profile-row', role: 'listitem' },
          avatar(profile.full_name || 'Founder', { size: 32 }),
          h('div', { class: 'row-main' },
            h('span', { class: 'row-title' }, profile.full_name || 'Founder'),
            h('span', { class: 'row-sub' }, [profile.role_title, profile.theme, profile.date_format, profile.time_format].filter(Boolean).join(' · ') || '—')
          ),
          h('div', { class: 'row-meta' },
            h('span', { class: 'faint small' }, `Week starts: ${profile.week_start_day}`),
            h('span', { class: 'faint small' }, `Numbers: ${profile.number_format}`),
            button('Edit', { kind: 'secondary', size: 'sm', iconName: 'edit', onClick: () => preferencesDialog(ctx, profile) })
          )
        )
      ) : stateBlock('empty', { title: 'No profile loaded' })
    );

    // --- Participants ---
    mount(partSection,
      h('div', { class: 'section-head' },
        h('h2', { class: 'section-title' }, `Participants · ${participants.length}`),
        h('div', { class: 'section-actions' }, button('Add participant', { kind: 'primary', size: 'sm', iconName: 'plus', onClick: () => participantDialog(ctx, null, participants) }))
      ),
      h('p', { class: 'faint small' }, 'Anyone with transactions, funding commitments or capital allocations on record can be deactivated but not removed: their financial history stays intact.'),
      participants.length ? h('div', { class: 'rows', role: 'list' }, [...participants].sort((x, y) => Number(y.is_active) - Number(x.is_active)).map(p => participantRow(ctx, p, participants))) :
      stateBlock('empty', { title: 'No participants yet', action: button('Add participant', { kind: 'primary', size: 'sm', iconName: 'plus', onClick: () => participantDialog(ctx, null, participants) }) })
    );
  };

  await draw();
  ctx.onLeave(ctx.bus.on('data:changed', ch => ['businesses', 'profiles', 'participants', '*'].includes(ch.table) && draw()));

  return h('div', { class: 'page' },
    pageHeader({ title: 'Settings', subtitle: 'Business profile, founder preferences, and participant records.' }),
    bizSection,
    prefSection,
    partSection
  );
}

export const settingsModule = { routes: [{ pattern: '/settings', render: renderSettings }] };