// Meridian bootstrap: load the workspace through the repositories, apply theme and accent, start the router.
import { data, dataSource, adapter } from './data/index.js';
import { createRouter } from './core/router.js';
import { todayIn } from './core/format.js';
import { bus } from './core/events.js';
import { h, mount } from './core/dom.js';
import { createShell } from './shell/shell.js';
import { MODULES, moduleById } from './modules/registry.js';
import { renderPlaceholder, renderNotFound } from './modules/placeholder.js';
import { BUILT } from './modules/index.js';
import { stateBlock } from './ui/components.js';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function applyTheme(theme) { document.documentElement.dataset.theme = theme; }
function applyAccent(hex) {
  const root = document.documentElement.style;
  root.setProperty('--accent', hex);
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4));
  root.setProperty('--text-on-accent', 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0d0e11' : '#ffffff');
}

async function boot() {
  const [business, profile] = await Promise.all([data.workspace.business(), data.workspace.profile()]);
  applyTheme(profile.theme);
  applyAccent(business.accent_color);

  const ctx = {
    data, dataSource, adapter, bus, business, profile, isMac,
    get today() { return todayIn(business.timezone); },
    navigate: (path, query) => router.navigate(path, query),
    openLauncher: () => bus.emit('launcher:open'),
    quickCreate: () => bus.emit('quick-create'),
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
