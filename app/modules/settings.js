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
    agreed_equity_percentage: input({ value: p.agreed_equity_percentage || '', type: 'number', step: '0.01', min: '0', max: '100', placeholder: 'e.g., 45.5' }),
    is_active: input({ type: 'checkbox', checked: p.is_active !== false }),
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
      field('Agreed equity %', f.agreed_equity_percentage, { help: 'Percentage, e.g., 45.5 for 45.5%' }),
      field('Active', h('div', null, f.is_active)),
      field('Notes', f.notes, { full: true })
    ),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: existing ? 'Save' : 'Add participant', kind: 'primary', submit: true, run: async () => {
        Object.values(f).forEach(x => setFieldError(x, ''));
        const row = Object.fromEntries(
          Object.entries(f).map(([k, el]) => {
            if (k === 'agreed_equity_percentage') {
              const v = el.value.trim();
              return v ? [k, v] : [k, null];
            }
            if (k === 'is_active') return [k, el.checked];
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

async function deleteParticipant(ctx, participant, allParticipants) {
  const isFounder = participant.participant_type === 'founder';
  const otherFounders = allParticipants.filter(p => p.participant_type === 'founder' && p.id !== participant.id);
  const body = h('div', null,
    h('p', null, `Delete ${participant.full_name} (${participant.participant_type})? This can’t be undone.`),
    isFounder && otherFounders.length === 0 && h('p', { class: 'fg-warn' }, '⚠ This is the only founder record. Removing it will leave the business without a founder.')
  );
  const ok = await confirmDialog({ title: 'Delete participant?', danger: true, confirmLabel: 'Delete', body });
  if (!ok) return false;
  await ctx.data.workspace.removeParticipant(participant.id);
  ctx.toast('Participant deleted');
  return true;
}

function participantRow(p, allParticipants) {
  const equity = p.agreed_equity_percentage != null ? `${Number(p.agreed_equity_percentage).toFixed(2)}%` : '—';
  const typeTone = p.participant_type === 'founder' ? 'accent' : p.participant_type === 'cofounder' ? 'ok' : 'idle';
  return h('div', { class: 'row participant-row', role: 'listitem' },
    avatar(p.full_name, { size: 26 }),
    h('button', { type: 'button', class: 'row-main', onclick: () => { /* panel not implemented yet */ } },
      h('span', { class: 'row-title' }, p.full_name),
      h('span', { class: 'row-sub' }, [p.designation, p.email].filter(Boolean).join(' · ') || '—')
    ),
    h('div', { class: 'row-meta' },
      p.email && h('a', { class: 'link', href: `mailto:${p.email}` }, p.email),
      h('span', { class: 'faint small' }, equity),
      chip(p.participant_type, { tone: typeTone }),
      p.is_active === false && chip('Inactive', { tone: 'bad' })
    )
  );
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
      participants.length ? h('div', { class: 'rows', role: 'list' }, participants.map(p => participantRow(p, participants))) :
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