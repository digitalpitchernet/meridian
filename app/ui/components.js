// Shared UI components. Every component is a function returning DOM; text is always textContent (core/dom.js).
import { h } from '../core/dom.js';
import { icon } from './icons.js';

export function button(label, { kind = 'secondary', size = 'md', iconName, onClick, title, type = 'button', disabled, kbd, aria, cls } = {}) {
  return h('button', { type, class: ['btn', `btn-${kind}`, `btn-${size}`, !label && 'btn-icon', cls], onclick: onClick, title, disabled, aria: aria || (!label && title ? { label: title } : undefined) },
    iconName && icon(iconName, { size: size === 'sm' ? 14 : 16 }), label && h('span', null, label), kbd && h('kbd', { class: 'kbd' }, kbd));
}

export function pageHeader({ title, subtitle, actions = [], meta }) {
  return h('header', { class: 'page-header' },
    h('div', { class: 'page-header-text' }, h('h1', { class: 'page-title' }, title), subtitle && h('p', { class: 'page-subtitle' }, subtitle)),
    meta && h('div', { class: 'page-header-meta' }, meta),
    actions.length ? h('div', { class: 'page-actions' }, actions) : null);
}

// Panel states required by the Command Centre spec: loading, empty, error, stale
export function stateBlock(kind, { title, body, action } = {}) {
  const icons = { loading: 'refresh', empty: 'inbox', error: 'alert', stale: 'clock', unavailable: 'link' };
  return h('div', { class: ['state', `state-${kind}`], role: kind === 'error' ? 'alert' : 'status' },
    kind === 'loading' ? h('div', { class: 'skeleton-stack', aria: { hidden: true } }, h('span', { class: 'skeleton' }), h('span', { class: 'skeleton w70' }), h('span', { class: 'skeleton w40' }))
      : icon(icons[kind] || 'dot', { size: 18, cls: 'icon state-icon' }),
    title && h('p', { class: 'state-title' }, title), body && h('p', { class: 'state-body' }, body), action);
}

export function chip(text, { tone = 'idle', title } = {}) { return h('span', { class: ['chip', `tone-${tone}`], title }, text); }

export function avatar(name, { size = 24 } = {}) {
  const initials = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
  return h('span', { class: 'avatar', aria: { hidden: true }, style: { '--size': `${size}px` } }, initials);
}

let toastRoot;
export function toast(message, { tone = 'idle', action, timeout = 3600 } = {}) {
  toastRoot ||= document.body.appendChild(h('div', { class: 'toasts', role: 'status', aria: { live: 'polite' } }));
  const el = h('div', { class: ['toast', `tone-${tone}`] }, h('span', null, message), action && button(action.label, { kind: 'ghost', size: 'sm', onClick: () => { action.run(); el.remove(); } }));
  toastRoot.append(el);
  setTimeout(() => el.classList.add('out'), timeout);
  setTimeout(() => el.remove(), timeout + 300);
}
