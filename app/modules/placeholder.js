// "Not built yet" page for approved modules scheduled after M1. Deliberately not a mock screen:
// nothing here pretends to be more finished than it is.
import { h } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader } from '../ui/components.js';

export function renderPlaceholder(mod) {
  return h('div', { class: 'page page-narrow' },
    pageHeader({ title: mod.label, subtitle: mod.summary }),
    h('section', { class: 'notice' },
      h('div', { class: 'notice-head' }, icon('clock', { size: 16 }), h('strong', null, `Not built yet · planned for ${mod.milestone}`)),
      h('p', { class: 'muted' }, 'This module is part of the approved V1 scope. Its screens have not been built, so none are shown.')),
    mod.planned?.length && h('section', { class: 'plain-section' },
      h('h2', { class: 'section-title' }, 'What it will hold'),
      h('ul', { class: 'plain-list' }, mod.planned.map(p => h('li', null, p)))),
    mod.tables.length > 0 && h('section', { class: 'plain-section' },
      h('h2', { class: 'section-title' }, 'Backed by'),
      h('div', { class: 'table-chips' }, mod.tables.map(t => h('code', { class: 'code-chip' }, t)))));
}

export function renderNotFound(path) {
  return h('div', { class: 'page page-narrow' },
    pageHeader({ title: 'Nothing here', subtitle: `There is no page at ${path}.` }),
    h('p', null, h('a', { class: 'link', href: '#/command' }, 'Go to the Command Centre')));
}
