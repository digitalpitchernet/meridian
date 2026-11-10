// Form controls. Native elements (select, date) for accessibility; styled consistently.
import { h } from '../core/dom.js';

let seq = 0;
export function field(label, control, { hint, error, full } = {}) {
  const id = control.id || (control.id = `f${++seq}`);
  return h('div', { class: ['field', full && 'field-full'] },
    h('label', { class: 'field-label', for: id }, label), control,
    hint && h('p', { class: 'field-hint' }, hint), h('p', { class: 'field-error', role: 'alert', hidden: !error }, error || ''));
}
export function setFieldError(control, message) {
  const err = control.closest('.field')?.querySelector('.field-error');
  if (!err) return;
  err.textContent = message || ''; err.hidden = !message;
  control.setAttribute('aria-invalid', message ? 'true' : 'false');
}
export const input = (props = {}) => h('input', { class: 'input', type: 'text', autocomplete: 'off', ...props });
export const dateInput = (props = {}) => h('input', { class: 'input input-date', type: 'date', ...props });
export const textarea = (props = {}) => h('textarea', { class: 'input textarea', rows: 3, ...props });
export function select(options, { value, placeholder, ...props } = {}) {
  return h('select', { class: 'input select', ...props },
    placeholder !== undefined && h('option', { value: '', selected: value == null || value === '' }, placeholder),
    options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: v === value }, l); }));
}
// '' from a form control means NULL in the database
export const nullIfEmpty = v => (v === '' || v === undefined ? null : v);
