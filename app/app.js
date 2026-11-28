// Meridian bootstrap: authenticate if using a live backend, load the workspace through the repositories,
// apply theme and accent, and start the router.
import { initData } from './data/index.js';
import { createRouter } from './core/router.js';
import { todayIn } from './core/format.js';
import { accentSolid } from './core/color.js';
import { bus } from './core/events.js';
import { h, mount } from './core/dom.js';
import { createShell } from './shell/shell.js';
import { MODULES, moduleById } from './modules/registry.js';
import { renderPlaceholder, renderNotFound } from './modules/placeholder.js';
import { BUILT } from './modules/index.js';
import { button, stateBlock } from './ui/components.js';
import { field, input, select } from './ui/forms.js';
import { friendlyError } from './ui/errors.js';
import { installLauncher } from './ui/launcher.js';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function applyTheme(theme) { document.documentElement.dataset.theme = theme; }
function applyAccent(hex) {
  const root = document.documentElement.style;
  const { solid, text } = accentSolid(hex);
  root.setProperty('--accent', hex);          // icons, focus, progress, active tab
  root.setProperty('--accent-solid', solid);  // filled buttons and the brand mark
  root.setProperty('--text-on-accent', text);
}

function renderAuthGate(adapter, dataSource, onAuthenticated) {
  const root = document.getElementById('app');
  let mode = 'signin';
  const emailEl = input({ type: 'email', placeholder: 'founder@company.com', required: true, autocomplete: 'email' });
  const passEl = input({ type: 'password', placeholder: 'Password', required: true, minlength: 8, autocomplete: 'current-password' });
  const errEl = h('p', { class: 'field-error', hidden: true });
  const submitBtn = button('Sign in', { type: 'submit', kind: 'primary' });
  const toggleBtn = button('Create account', {
    kind: 'ghost',
    size: 'sm',
    onClick: () => {
      mode = mode === 'signin' ? 'signup' : 'signin';
      submitBtn.textContent = mode === 'signin' ? 'Sign in' : 'Create account';
      toggleBtn.textContent = mode === 'signin' ? 'Create account' : 'Already have an account? Sign in';
      passEl.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
      errEl.hidden = true;
    },
  });

  const form = h('form', {
    class: 'card',
    style: { maxWidth: '420px', margin: '8vh auto 0', padding: '24px', display: 'grid', gap: '14px' },
    onsubmit: async e => {
      e.preventDefault();
      errEl.hidden = true;
      submitBtn.disabled = true;
      try {
        if (mode === 'signin') {
          await adapter.auth.signIn(emailEl.value, passEl.value);
        } else {
          const res = await adapter.auth.signUp(emailEl.value, passEl.value);
          if (!res.session) {
            errEl.textContent = 'Check your email to confirm your account, then sign in.';
            errEl.hidden = false;
            return;
          }
        }
        await onAuthenticated();
      } catch (err) {
        errEl.textContent = friendlyError(err).message;
        errEl.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    },
  },
  h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
    h('span', { class: 'brand-mark', aria: { hidden: true } }, 'M'),
    h('div', null,
      h('h1', { style: { fontSize: '18px', margin: 0 } }, 'Meridian'),
      h('p', { style: { fontSize: '12px', color: 'var(--text-3)', margin: 0 } }, dataSource.label))),
  field('Email', emailEl, { required: true }),
  field('Password', passEl, { required: true }),
  errEl,
  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '4px' } },
    toggleBtn, submitBtn));

  mount(root, h('div', { class: 'page page-narrow' }, form));
  root.removeAttribute('aria-busy');
  emailEl.focus();
}

function renderWorkspaceSetup(adapter, session, onReady) {
  const root = document.getElementById('app');
  const bizEl = input({ placeholder: 'e.g. Kestrel Ridge Studio', required: true, maxlength: 200 });
  const nameEl = input({ placeholder: 'Your full name', required: true, maxlength: 200 });
  const curEl = select(['INR', 'USD', 'EUR', 'GBP'], { value: 'INR' });
  const tzEl = input({ value: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata', required: true });
  const errEl = h('p', { class: 'field-error', hidden: true });
  const submitBtn = button('Create workspace', { type: 'submit', kind: 'primary' });

  const form = h('form', {
    class: 'card',
    style: { maxWidth: '460px', margin: '8vh auto 0', padding: '24px', display: 'grid', gap: '14px' },
    onsubmit: async e => {
      e.preventDefault();
      errEl.hidden = true;
      submitBtn.disabled = true;
      try {
        await adapter.rpc('create_workspace', {
          p_business_name: bizEl.value,
          p_base_currency: curEl.value,
          p_locale: 'en-IN',
          p_timezone: tzEl.value,
          p_full_name: nameEl.value,
          p_financial_year_start_month: 4,
        });
        await onReady();
      } catch (err) {
        errEl.textContent = friendlyError(err).message;
        errEl.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    },
  },
  h('h1', { style: { fontSize: '18px', margin: 0 } }, 'Set up your workspace'),
  h('p', { style: { fontSize: '13px', color: 'var(--text-2)', margin: 0 } },
    `Signed in as ${session.user?.email || 'authenticated user'}. Create your business workspace to begin.`),
  field('Business name', bizEl, { required: true }),
  field('Your name', nameEl, { required: true }),
  h('div', { class: 'prop-grid' },
    field('Base currency', curEl, { required: true }),
    field('Timezone', tzEl, { required: true })),
  errEl,
  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
    button('Sign out', { kind: 'ghost', size: 'sm', onClick: () => adapter.auth.signOut().then(() => location.reload()) }),
    submitBtn));

  mount(root, h('div', { class: 'page page-narrow' }, form));
  root.removeAttribute('aria-busy');
  bizEl.focus();
}

async function boot() {
  const { data, dataSource, adapter } = await initData();
  if (adapter.auth) {
    const session = await adapter.auth.getSession();
    if (!session) {
      renderAuthGate(adapter, dataSource, () => boot());
      return;
    }
    const [business, profile] = await Promise.all([data.workspace.business(), data.workspace.profile()]);
    if (!business || !profile) {
      renderWorkspaceSetup(adapter, session, () => boot());
      return;
    }
    adapter.auth.onStateChange(event => {
      if (event === 'SIGNED_OUT') renderAuthGate(adapter, dataSource, () => boot());
    });
    await startApp({ data, dataSource, adapter, business, profile });
    return;
  }

  const [business, profile] = await Promise.all([data.workspace.business(), data.workspace.profile()]);
  await startApp({ data, dataSource, adapter, business, profile });
}

async function startApp({ data, dataSource, adapter, business, profile }) {
  applyTheme(profile.theme);
  applyAccent(business.accent_color);

  const ctx = {
    data, dataSource, adapter, bus, business, profile, isMac,
    get today() { return todayIn(business.timezone); },
    navigate: (path, query) => router.navigate(path, query),
    openLauncher: () => bus.emit('launcher:open'),
    quickCreate: () => bus.emit('quick-create'),
    signOut: adapter.auth ? async () => { await adapter.auth.signOut(); location.reload(); } : null,
    async setTheme(theme) {
      const p = await data.workspace.updateProfile(profile.id, { theme });
      Object.assign(profile, p); applyTheme(p.theme); shell.syncTheme(p.theme);
    },
    async setAccent(hex) {
      const b = await data.workspace.updateBusiness(business.id, { accent_color: hex });
      Object.assign(business, b); applyAccent(b.accent_color);
    },
  };

  const shell = createShell(ctx);
  Object.assign(ctx, { openPanel: shell.openPanel, closePanel: shell.closePanel, toast: shell.toast });
  installLauncher(ctx);

  // sidebar counts are a projection of module data, refreshed on every data change
  const refreshCounts = async () => {
    const [tasks, projects] = await Promise.all([data.tasks.list(), data.projects.list()]);
    shell.setCounts({ tasks: tasks.filter(t => t.status !== 'Done').length, projects: projects.filter(p => p.status === 'Active').length });
  };
  let leave = [];
  ctx.onLeave = fn => leave.push(fn);
  adapter.subscribe(change => { refreshCounts(); bus.emit('data:changed', change); });
  refreshCounts();

  const routes = [];
  for (const m of MODULES) {
    const built = BUILT[m.id];
    if (built) for (const r of built.routes) routes.push({ ...r, moduleId: m.id });
    else routes.push({ pattern: m.path, moduleId: m.id, render: () => renderPlaceholder(m) });
  }

  let seq = 0;
  const router = createRouter(routes, {
    defaultPath: '/command',
    notFound: { moduleId: null, render: (_c, _p, _q, path) => renderNotFound(path) },
    async onRoute({ route, params, query, path }) {
      const mine = ++seq;
      for (const fn of leave.splice(0)) { try { fn(); } catch (e) { console.error(e); } }
      shell.closePanel();
      const mod = moduleById(route.moduleId);
      const trail = mod ? [{ label: mod.group }, { label: mod.label, href: `#${mod.path}` }] : [{ label: 'Not found' }];
      shell.setActive(route.moduleId, trail);
      mount(shell.main, h('div', { class: 'page' }, stateBlock('loading', { title: 'Loading' })));
      try {
        const node = await route.render(ctx, params, query, path, crumbs => shell.setActive(route.moduleId, [...trail, ...crumbs]));
        if (mine !== seq) return; // a newer navigation won
        mount(shell.main, node);
        shell.main.scrollTop = 0;
      } catch (e) {
        console.error(e);
        if (mine === seq) mount(shell.main, h('div', { class: 'page page-narrow' }, stateBlock('error', { title: 'This page failed to load', body: e.message })));
      }
    },
  });
  router.start();
  return ctx;
}

boot().catch(e => {
  console.error(e);
  mount(document.getElementById('app'), h('div', { class: 'page page-narrow' }, stateBlock('error', { title: 'Meridian could not start', body: e.message })));
});
