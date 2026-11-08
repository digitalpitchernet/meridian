// Application shell: persistent grouped sidebar, compact header, main outlet, optional right panel, mobile drawer.
import { h, mount, clear } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { button, avatar, toast } from '../ui/components.js';
import { GROUPS, MODULES } from '../modules/registry.js';

export function createShell(ctx) {
  const root = document.getElementById('app');
  const main = h('main', { id: 'main', class: 'main', tabindex: '-1' });
  const panel = h('aside', { class: 'side-panel', aria: { label: 'Details panel' }, hidden: true });
  const crumbs = h('nav', { class: 'crumbs', aria: { label: 'Breadcrumb' } });
  const counts = {};
  const navLinks = new Map();

  // ---- sidebar ----
  const navGroups = GROUPS.map(group => h('div', { class: 'nav-group' },
    h('div', { class: 'nav-group-label' }, group),
    MODULES.filter(m => m.group === group).map(m => {
      const count = h('span', { class: 'nav-count num' });
      counts[m.id] = count;
      const a = h('a', { class: 'nav-item', href: `#${m.path}`, dataset: { module: m.id } },
        icon(m.icon, { size: 16 }), h('span', { class: 'nav-label' }, m.label), count,
        m.milestone !== 'M1' && !m.built && h('span', { class: 'nav-tag', title: `Planned for ${m.milestone}` }, m.milestone));
      navLinks.set(m.id, a);
      return a;
    })));

  const themeSeg = h('div', { class: 'seg', role: 'radiogroup', aria: { label: 'Theme' } },
    [['dark', 'moon', 'Dark'], ['light', 'sun', 'Light'], ['system', 'monitor', 'System']].map(([value, ic, label]) =>
      h('button', { type: 'button', class: 'seg-btn', role: 'radio', title: label, aria: { label, checked: ctx.profile.theme === value ? 'true' : 'false' }, dataset: { value }, onclick: () => ctx.setTheme(value) }, icon(ic, { size: 14 }))));

  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', aria: { label: 'Main navigation' } },
    h('div', { class: 'brand' },
      h('span', { class: 'brand-mark', aria: { hidden: true } }, 'M'),
      h('div', { class: 'brand-text' }, h('strong', { class: 'brand-name' }, ctx.business.business_name), h('span', { class: 'brand-sub' }, 'Meridian'))),
    button('Search or jump to…', { kind: 'search', iconName: 'search', kbd: ctx.isMac ? '⌘K' : 'Ctrl K', onClick: () => ctx.openLauncher(), cls: 'sidebar-search' }),
    h('nav', { class: 'nav' }, navGroups),
    h('div', { class: 'sidebar-foot' },
      h('a', { class: 'dev-badge', href: '#/settings', title: ctx.dataSource.description },
        icon('beaker', { size: 14 }), h('span', null, 'Development data'), h('span', { class: 'dev-badge-sub' }, 'fictional · no backend')),
      h('div', { class: 'me' }, avatar(ctx.profile.full_name, { size: 26 }),
        h('div', { class: 'me-text', title: `${ctx.profile.full_name} · ${ctx.profile.role_title || 'Founder'}` }, h('span', { class: 'me-name' }, ctx.profile.full_name), h('span', { class: 'me-role' }, ctx.profile.role_title || 'Founder')),
        themeSeg)));

  const menuBtn = button('', { kind: 'ghost', iconName: 'menu', title: 'Open navigation', cls: 'menu-btn', onClick: () => setNav(true) });
  const topbar = h('header', { class: 'topbar' },
    menuBtn, crumbs,
    h('div', { class: 'topbar-actions' },
      h('span', { class: 'dev-pill', title: ctx.dataSource.description }, icon('beaker', { size: 12 }), 'Dev data'),
      button('', { kind: 'ghost', iconName: 'search', title: 'Search (Ctrl K)', cls: 'topbar-search', onClick: () => ctx.openLauncher() }),
      button('New', { kind: 'primary', size: 'sm', iconName: 'plus', title: 'Quick create', onClick: () => ctx.quickCreate() })));

  const scrim = h('div', { class: 'scrim', onclick: () => setNav(false) });
  mount(root, sidebar, scrim, h('div', { class: 'main-col' }, topbar, main), panel);
  root.removeAttribute('aria-busy');

  function setNav(open) {
    root.classList.toggle('nav-open', open);
    if (open) sidebar.querySelector('.nav-item')?.focus();
  }
  addEventListener('keydown', e => {
    if (e.key !== 'Escape' || document.querySelector('.backdrop, .menu')) return; // dialogs and menus handle their own Escape
    if (root.classList.contains('nav-open')) setNav(false);
    else if (!panel.hidden) api.closePanel();
  });
  sidebar.addEventListener('click', e => { if (e.target.closest('.nav-item')) setNav(false); });

  const api = {
    main, panel,
    setActive(moduleId, trail) {
      for (const [id, a] of navLinks) { a.classList.toggle('active', id === moduleId); a.toggleAttribute('aria-current', id === moduleId); if (id === moduleId) a.setAttribute('aria-current', 'page'); }
      mount(crumbs, trail.map((c, i) => [i > 0 && icon('chevronRight', { size: 12, cls: 'icon crumb-sep' }),
        i === trail.length - 1 ? h('span', { class: 'crumb current', aria: { current: 'page' } }, c.label)
          : c.href ? h('a', { class: 'crumb', href: c.href }, c.label) : h('span', { class: 'crumb' }, c.label)]));
      document.title = `${trail[trail.length - 1].label} · Meridian`;
    },
    setCounts(map) { for (const [id, el] of Object.entries(counts)) el.textContent = map[id] ? String(map[id]) : ''; },
    syncTheme(theme) { for (const b of themeSeg.children) b.setAttribute('aria-checked', b.dataset.value === theme ? 'true' : 'false'); },
    openPanel(node, { label = 'Details', onClose } = {}) {
      mount(panel, node); panel.hidden = false; panel.setAttribute('aria-label', label); root.classList.add('panel-open');
      panel._onClose = onClose; requestAnimationFrame(() => panel.querySelector('[autofocus], input, textarea, select, button')?.focus());
    },
    closePanel() { if (panel.hidden) return; panel.hidden = true; root.classList.remove('panel-open'); clear(panel); const fn = panel._onClose; panel._onClose = null; fn?.(); },
    toast,
  };
  return api;
}
