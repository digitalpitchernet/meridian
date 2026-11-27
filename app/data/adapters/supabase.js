// Supabase / PostgREST + GoTrue adapter. Implements the same select/get/insert/update/remove/rpc/subscribe
// contract as adapters/fixture.js so screens never change between backends.
import { DataError } from '../errors.js';

const AUTH_STORAGE_KEY = 'meridian.auth.v1';

function parseError(status, body, fallbackMessage) {
  const code = body?.code || (status === 401 || status === 403 ? '42501' : status === 404 ? 'P0002' : 'P0001');
  const message = body?.message || body?.error_description || body?.msg || body?.error || fallbackMessage || `Request failed (${status})`;
  return new DataError(String(code), message, {
    status,
    details: body?.details ?? null,
    hint: body?.hint ?? null,
  });
}

function buildEqParams(params, eq = {}) {
  for (const [col, val] of Object.entries(eq)) {
    if (val === undefined) continue;
    params.append(col, val === null ? 'is.null' : `eq.${val}`);
  }
}

export function createSupabaseAdapter({
  url,
  anonKey,
  label = 'Supabase · live',
  fetchImpl = globalThis.fetch.bind(globalThis),
  storage = null,
} = {}) {
  const baseUrl = String(url || '').replace(/\/+$/, '');
  const listeners = new Set();
  let session = null;
  let cachedBusinessId = null;

  const emit = change => {
    for (const fn of listeners) {
      try { fn(change); } catch (e) { console.error(e); }
    }
  };

  const loadStoredSession = () => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.access_token ? parsed : null;
    } catch {
      return null;
    }
  };

  const saveSession = next => {
    session = next;
    cachedBusinessId = null;
    if (!storage) return;
    try {
      if (next) storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
      else storage.removeItem(AUTH_STORAGE_KEY);
    } catch { /* ignore storage quota errors */ }
  };

  session = loadStoredSession();

  async function request(path, { method = 'GET', body, headers = {}, authRequired = true } = {}) {
    const reqHeaders = {
      apikey: anonKey,
      ...headers,
    };
    if (session?.access_token) {
      reqHeaders.Authorization = `Bearer ${session.access_token}`;
    } else if (authRequired) {
      throw new DataError('42501', 'Authentication required');
    }
    if (body !== undefined) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: reqHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = { message: text }; }
    }
    if (!res.ok) {
      if (res.status === 401 && session) {
        saveSession(null);
      }
      throw parseError(res.status, json, res.statusText);
    }
    return json;
  }

  async function ensureBusinessId() {
    if (cachedBusinessId) return cachedBusinessId;
    const id = await rpc('get_current_business_id', {});
    if (id) cachedBusinessId = id;
    return id;
  }

  async function select(table, query = {}) {
    const params = new URLSearchParams();
    params.set('select', query.select || '*');
    if (query.eq) buildEqParams(params, query.eq);
    if (query.order?.length) {
      params.set('order', query.order.map(o => `${o.col}.${o.asc === false ? 'desc' : 'asc'}`).join(','));
    }
    if (query.limit != null) params.set('limit', String(query.limit));
    const rows = await request(`/rest/v1/${encodeURIComponent(table)}?${params.toString()}`);
    return Array.isArray(rows) ? rows : [];
  }

  async function get(table, id) {
    if (id == null) return null;
    const params = new URLSearchParams({ select: '*', id: `eq.${id}`, limit: '1' });
    const rows = await request(`/rest/v1/${encodeURIComponent(table)}?${params.toString()}`);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async function insert(table, input) {
    const payload = { ...input };
    if (payload.business_id === undefined && table !== 'businesses') {
      const bid = await ensureBusinessId();
      if (bid) payload.business_id = bid;
    }
    const rows = await request(`/rest/v1/${encodeURIComponent(table)}`, {
      method: 'POST',
      body: payload,
      headers: { Prefer: 'return=representation' },
    });
    const created = Array.isArray(rows) ? rows[0] : rows;
    emit({ table, op: 'insert', row: created });
    return created;
  }

  async function update(table, id, patch) {
    const params = new URLSearchParams({ id: `eq.${id}` });
    const rows = await request(`/rest/v1/${encodeURIComponent(table)}?${params.toString()}`, {
      method: 'PATCH',
      body: patch,
      headers: { Prefer: 'return=representation' },
    });
    if (!Array.isArray(rows) || !rows.length) {
      throw new DataError('P0002', 'record not found');
    }
    const updated = rows[0];
    emit({ table, op: 'update', row: updated });
    return updated;
  }

  async function updateWhere(table, eq, patch) {
    const params = new URLSearchParams();
    buildEqParams(params, eq);
    const rows = await request(`/rest/v1/${encodeURIComponent(table)}?${params.toString()}`, {
      method: 'PATCH',
      body: patch,
      headers: { Prefer: 'return=representation' },
    });
    const list = Array.isArray(rows) ? rows : [];
    for (const row of list) emit({ table, op: 'update', row });
    return list;
  }

  async function remove(table, id) {
    const params = new URLSearchParams({ id: `eq.${id}` });
    const rows = await request(`/rest/v1/${encodeURIComponent(table)}?${params.toString()}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (!Array.isArray(rows) || !rows.length) {
      throw new DataError('P0002', 'record not found');
    }
    emit({ table, op: 'delete', row: rows[0] });
    return true;
  }

  async function removeWhere(table, eq) {
    const params = new URLSearchParams();
    buildEqParams(params, eq);
    const rows = await request(`/rest/v1/${encodeURIComponent(table)}?${params.toString()}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    const list = Array.isArray(rows) ? rows : [];
    for (const row of list) emit({ table, op: 'delete', row });
    return list.length;
  }

  async function rpc(fn, args = {}) {
    const result = await request(`/rest/v1/rpc/${encodeURIComponent(fn)}`, {
      method: 'POST',
      body: args,
    });
    if (fn === 'create_workspace') cachedBusinessId = result || null;
    return result;
  }

  const auth = {
    async getSession() {
      if (!session?.access_token) return null;
      try {
        const user = await request('/auth/v1/user', { method: 'GET' });
        session = { ...session, user };
        saveSession(session);
        return session;
      } catch (e) {
        if (e.code === '42501') {
          saveSession(null);
          return null;
        }
        throw e;
      }
    },
    async signIn(email, password) {
      const res = await request('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: { email: String(email || '').trim(), password: String(password || '') },
        authRequired: false,
      });
      if (!res?.access_token) throw new DataError('42501', 'Invalid login response');
      saveSession({ access_token: res.access_token, refresh_token: res.refresh_token || null, user: res.user || null });
      return session;
    },
    async signUp(email, password) {
      const res = await request('/auth/v1/signup', {
        method: 'POST',
        body: { email: String(email || '').trim(), password: String(password || '') },
        authRequired: false,
      });
      if (res?.access_token) {
        saveSession({ access_token: res.access_token, refresh_token: res.refresh_token || null, user: res.user || null });
      }
      return { session, user: res?.user || null };
    },
    async signOut() {
      if (session?.access_token) {
        await request('/auth/v1/logout', { method: 'POST' }).catch(() => {});
      }
      saveSession(null);
    },
  };

  return {
    kind: 'supabase',
    label,
    select,
    get,
    insert,
    update,
    updateWhere,
    remove,
    removeWhere,
    rpc,
    auth,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
