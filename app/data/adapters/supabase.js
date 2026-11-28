// Supabase / PostgREST + GoTrue adapter. Implements the same select/get/insert/update/remove/rpc/subscribe
// contract as adapters/fixture.js so screens never change between backends.
import { DataError } from '../errors.js';

const AUTH_STORAGE_KEY = 'meridian.auth.v1';
const REFRESH_MARGIN_SEC = 30;

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
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  const baseUrl = String(url || '').replace(/\/+$/, '');
  const listeners = new Set();
  const authListeners = new Set();
  let session = null;
  let cachedBusinessId = null;
  let refreshPromise = null;

  const emit = change => {
    for (const fn of listeners) {
      try { fn(change); } catch (e) { console.error(e); }
    }
  };

  const emitAuth = (event, nextSession) => {
    for (const fn of authListeners) {
      try { fn(event, nextSession); } catch (e) { console.error(e); }
    }
  };

  const computeExpiresAt = res => {
    if (typeof res?.expires_at === 'number') return res.expires_at;
    if (typeof res?.expires_in === 'number' && res.expires_in > 0) return now() + res.expires_in;
    return null;
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

  const saveSession = (next, event = null) => {
    const prevToken = session?.access_token ?? null;
    session = next;
    cachedBusinessId = null;
    if (storage) {
      try {
        if (next) storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
        else storage.removeItem(AUTH_STORAGE_KEY);
      } catch { /* ignore storage quota errors */ }
    }
    if (event) {
      emitAuth(event, next);
    } else if (prevToken && !next) {
      emitAuth('SIGNED_OUT', null);
    }
  };

  session = loadStoredSession();

  function isExpiringSoon() {
    if (!session?.expires_at) return false;
    return session.expires_at - now() <= REFRESH_MARGIN_SEC;
  }

  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    const rt = session?.refresh_token;
    if (!rt) {
      saveSession(null, 'SIGNED_OUT');
      throw new DataError('42501', 'Session expired. Please sign in again.');
    }

    refreshPromise = (async () => {
      try {
        const res = await fetchImpl(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { apikey: anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt }),
        });
        const text = await res.text();
        let json = null;
        if (text) {
          try { json = JSON.parse(text); } catch { json = { message: text }; }
        }
        if (!res.ok || !json?.access_token) {
          saveSession(null, 'SIGNED_OUT');
          throw new DataError('42501', json?.error_description || json?.message || 'Session expired. Please sign in again.');
        }
        const next = {
          access_token: json.access_token,
          refresh_token: json.refresh_token || rt,
          expires_at: computeExpiresAt(json),
          user: json.user || session?.user || null,
        };
        saveSession(next, 'TOKEN_REFRESHED');
        return next;
      } catch (err) {
        if (err instanceof DataError) throw err;
        saveSession(null, 'SIGNED_OUT');
        throw new DataError('42501', 'Session expired. Please sign in again.');
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  async function request(path, { method = 'GET', body, headers = {}, authRequired = true, _retried = false } = {}) {
    if (authRequired && !session?.access_token) {
      throw new DataError('42501', 'Authentication required');
    }
    if (authRequired && isExpiringSoon() && session?.refresh_token) {
      await refreshSession();
    }

    const reqHeaders = {
      apikey: anonKey,
      ...headers,
    };
    if (authRequired && session?.access_token) {
      reqHeaders.Authorization = `Bearer ${session.access_token}`;
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
      if (res.status === 401 && authRequired) {
        if (!_retried && session?.refresh_token) {
          await refreshSession();
          return request(path, { method, body, headers, authRequired, _retried: true });
        }
        if (session) saveSession(null, 'SIGNED_OUT');
        throw new DataError('42501', json?.message || json?.error_description || 'Session expired. Please sign in again.', { status: 401 });
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
    onStateChange(fn) {
      authListeners.add(fn);
      return () => authListeners.delete(fn);
    },
    refreshSession,
    async getSession() {
      if (!session?.access_token) return null;
      try {
        const user = await request('/auth/v1/user', { method: 'GET' });
        const next = { ...session, user };
        saveSession(next);
        return next;
      } catch (e) {
        if (e.code === '42501') {
          saveSession(null, 'SIGNED_OUT');
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
      saveSession({
        access_token: res.access_token,
        refresh_token: res.refresh_token || null,
        expires_at: computeExpiresAt(res),
        user: res.user || null,
      }, 'SIGNED_IN');
      return session;
    },
    async signUp(email, password) {
      const res = await request('/auth/v1/signup', {
        method: 'POST',
        body: { email: String(email || '').trim(), password: String(password || '') },
        authRequired: false,
      });
      if (res?.access_token) {
        saveSession({
          access_token: res.access_token,
          refresh_token: res.refresh_token || null,
          expires_at: computeExpiresAt(res),
          user: res.user || null,
        }, 'SIGNED_IN');
      }
      return { session, user: res?.user || null };
    },
    async signOut() {
      if (session?.access_token) {
        await request('/auth/v1/logout', { method: 'POST' }).catch(() => {});
      }
      saveSession(null, 'SIGNED_OUT');
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
