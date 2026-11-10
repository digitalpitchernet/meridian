// Hash router: '#/projects/abc' -> { path: '/projects/abc', route, params }.
// Hash routing needs no server rewrites, so the app works from tools/serve.mjs, XAMPP or a file host alike.
// matchRoute and parseHash are pure (unit-tested in Node); startRouter wires them to window.

export function compile(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([a-z_]+)/gi, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  return { pattern, keys, re };
}

export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = ('/' + pathPart.replace(/^\/+/, '')).replace(/\/+$/, '') || '/';
  return { path, query: Object.fromEntries(new URLSearchParams(queryPart)) };
}

// routes: [{ pattern, ...anything }] compiled once; first match wins
export function matchRoute(compiled, path) {
  for (const r of compiled) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r.route, params };
    }
  }
  return null;
}

export function href(path, query) {
  const q = query && Object.keys(query).length ? '?' + new URLSearchParams(query) : '';
  return '#' + path + q;
}

export function createRouter(routes, { onRoute, notFound, defaultPath = '/' }) {
  const compiled = routes.map(route => ({ ...compile(route.pattern), route }));
  const resolve = () => {
    const { path, query } = parseHash(location.hash);
    if (path === '/' && defaultPath !== '/') { location.replace(href(defaultPath)); return; }
    const hit = matchRoute(compiled, path);
    onRoute(hit ? { ...hit, path, query } : { route: notFound, params: {}, path, query });
  };
  return {
    start() { addEventListener('hashchange', resolve); resolve(); },
    navigate(path, query) { const next = href(path, query); if (location.hash === next) resolve(); else location.hash = next; },
    refresh: resolve,
  };
}
