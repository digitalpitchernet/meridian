// Tiny DOM builder. Text is always set as textContent, never parsed as HTML, so data cannot inject markup.
// h('button', { class: 'btn', onclick: fn, aria: { label: 'Close' } }, 'Close', icon('x'))
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'aria') for (const [a, av] of Object.entries(v)) { if (av !== undefined && av !== null && av !== false) el.setAttribute(`aria-${a}`, av === true ? 'true' : av); }
      else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv); // CSSOM: allowed by the CSP
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }
export function mount(el, ...children) { clear(el); return append(el, children); }

// inline SVG from a path list (icons.js); built with createElementNS, no innerHTML
export function svg(paths, { size = 16, stroke = 1.6, cls = 'icon' } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', stroke);
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', cls);
  for (const d of paths) {
    const [tag, attrs] = typeof d === 'string' ? ['path', { d }] : d;
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    s.append(node);
  }
  return s;
}
