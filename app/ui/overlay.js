// Menus (popover lists) and modal dialogs, both keyboard-operable.
import { h } from '../core/dom.js';
import { icon } from './icons.js';
import { button } from './components.js';

let openMenu = null;
const closeMenu = () => { if (openMenu) { openMenu.el.remove(); openMenu.anchor.setAttribute('aria-expanded', 'false'); openMenu.anchor.focus({ preventScroll: true }); openMenu = null; } };
addEventListener('mousedown', e => { if (openMenu && !openMenu.el.contains(e.target) && !openMenu.anchor.contains(e.target)) closeMenu(); });
addEventListener('scroll', () => closeMenu(), true);

// items: [{ label, value, icon: Node, hint }] ; onPick(value)
export function popMenu(anchor, items, { onPick, current, label = 'Options' } = {}) {
  if (openMenu?.anchor === anchor) return closeMenu();
  closeMenu();
  const list = h('div', { class: 'menu', role: 'menu', aria: { label } },
    items.map(it => h('button', { type: 'button', class: ['menu-item', it.value === current && 'current'], role: 'menuitemradio', aria: { checked: it.value === current ? 'true' : 'false' },
      onclick: e => { e.stopPropagation(); closeMenu(); onPick(it.value); } },
      it.icon, h('span', { class: 'menu-label' }, it.label), it.hint && h('span', { class: 'menu-hint' }, it.hint), it.value === current && icon('check', { size: 14, cls: 'icon menu-check' }))));
  document.body.append(list);
  const r = anchor.getBoundingClientRect();
  const top = Math.min(r.bottom + 4, innerHeight - list.offsetHeight - 8);
  const left = Math.min(r.left, innerWidth - list.offsetWidth - 8);
  list.style.setProperty('top', `${Math.max(8, top)}px`); list.style.setProperty('left', `${Math.max(8, left)}px`);
  anchor.setAttribute('aria-expanded', 'true');
  openMenu = { el: list, anchor };
  const btns = [...list.querySelectorAll('.menu-item')];
  (btns.find(b => b.classList.contains('current')) || btns[0])?.focus();
  list.addEventListener('keydown', e => {
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); }
  });
}

// Modal dialog. content: Node; actions: [{ label, kind, run: async () => boolean|void }] (return false to keep open)
export function openDialog({ title, description, content, actions = [], size = 'md', onClose }) {
  const previous = document.activeElement;
  const close = () => { backdrop.remove(); removeEventListener('keydown', onKey, true); onClose?.(); previous?.focus?.({ preventScroll: true }); };
  const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
  const footer = h('div', { class: 'dialog-actions' }, actions.map(a => {
    const b = button(a.label, { kind: a.kind || 'secondary', type: a.submit ? 'submit' : 'button',
      onClick: a.submit ? undefined : async () => { b.disabled = true; try { if ((await a.run?.()) !== false) close(); } finally { b.disabled = false; } } });
    return b;
  }));
  const form = h('form', { class: ['dialog', `dialog-${size}`], role: 'dialog', aria: { modal: 'true', labelledby: titleId }, novalidate: true,
    onsubmit: async e => {
      e.preventDefault();
      const sub = actions.find(a => a.submit); if (!sub) return;
      const btns = footer.querySelectorAll('button'); btns.forEach(b => { b.disabled = true; });
      try { if ((await sub.run?.()) !== false) close(); } finally { btns.forEach(b => { b.disabled = false; }); }
    } },
    h('div', { class: 'dialog-head' }, h('h2', { class: 'dialog-title', id: titleId }, title), button('', { kind: 'ghost', size: 'sm', iconName: 'x', title: 'Close', onClick: close })),
    description && h('p', { class: 'dialog-desc' }, description), h('div', { class: 'dialog-body' }, content), footer);
  const backdrop = h('div', { class: 'backdrop', onmousedown: e => { if (e.target === backdrop) close(); } }, form);
  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...form.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  requestAnimationFrame(() => (form.querySelector('[autofocus]') || form.querySelector('input, textarea, select') || footer.querySelector('button'))?.focus());
  return { close, form };
}

export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger }) {
  return new Promise(resolve => {
    let decided = false;
    openDialog({ title, size: 'sm', content: h('div', { class: 'confirm-body' }, body),
      actions: [{ label: 'Cancel', kind: 'ghost', run: () => { decided = true; resolve(false); } },
                { label: confirmLabel, kind: danger ? 'danger' : 'primary', run: () => { decided = true; resolve(true); } }],
      onClose: () => { if (!decided) resolve(false); } });
  });
}
