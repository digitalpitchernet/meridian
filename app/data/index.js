// Data source selection: connects to the configured Supabase/PostgreSQL backend when runtime config
// is present. Fixture mode is strictly opt-in (?mode=dev / ?mode=fixtures or explicit { mode: "fixtures" });
// a missing or unreachable live config never silently falls back to fictional data.
import { createFixtureAdapter } from './adapters/fixture.js';
import { createSupabaseAdapter } from './adapters/supabase.js';
import { buildFixtures, DEV_BUSINESS_ID, DEV_PROFILE_ID } from './fixtures/dev-fixtures.js';
import { createRepositories } from './repositories.js';
import { DataError } from './errors.js';
import { todayIn } from '../core/format.js';

const safeStorage = (() => {
  try {
    const s = window.localStorage;
    s.setItem('__m', '1');
    s.removeItem('__m');
    return s;
  } catch {
    return null;
  }
})();

export async function resolveDataConfig({
  search = typeof window !== 'undefined' ? window.location.search : '',
  globalConfig = typeof window !== 'undefined' ? window.__MERIDIAN_CONFIG__ : null,
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
} = {}) {
  const params = new URLSearchParams(search);
  const modeParam = params.get('mode');
  if (modeParam === 'dev' || modeParam === 'fixtures') {
    return { mode: 'fixtures' };
  }

  let cfg = globalConfig;
  if (!cfg) {
    if (!fetchImpl) {
      throw new DataError('P0001', 'Live backend configuration is unavailable in this environment.');
    }
    let res;
    try {
      res = await fetchImpl('./app-config.json', { cache: 'no-store' });
    } catch {
      throw new DataError(
        'P0001',
        'Live backend configuration is unreachable (app-config.json). Start a configured backend or open ?mode=dev for explicit fictional fixtures.',
      );
    }
    if (!res.ok) {
      throw new DataError(
        'P0001',
        `Live backend configuration is missing (app-config.json HTTP ${res.status}). Start a configured backend or open ?mode=dev for explicit fictional fixtures.`,
      );
    }
    try {
      cfg = await res.json();
    } catch {
      throw new DataError('P0001', 'Invalid app-config.json: response is not valid JSON.');
    }
  }

  if (cfg?.mode === 'fixtures') {
    return { mode: 'fixtures' };
  }
  if (cfg?.supabaseUrl) {
    return { mode: 'supabase', ...cfg };
  }
  throw new DataError('P0001', 'Invalid app-config.json: expected supabaseUrl or explicit mode="fixtures".');
}

export async function initData(opts = {}) {
  const cfg = await resolveDataConfig(opts);
  if (cfg.mode === 'supabase') {
    const adapter = createSupabaseAdapter({
      url: cfg.supabaseUrl,
      anonKey: cfg.supabaseAnonKey || 'local-anon',
      label: cfg.label || 'Supabase · live',
      storage: opts.storage !== undefined ? opts.storage : safeStorage,
      fetchImpl: opts.fetchImpl,
    });
    return {
      adapter,
      data: createRepositories(adapter),
      dataSource: {
        kind: adapter.kind,
        label: adapter.label,
        persisted: true,
        description: cfg.description || 'Connected to PostgreSQL with row-level security and server-side audit logging.',
      },
    };
  }

  const adapter = createFixtureAdapter({
    seed: () => buildFixtures(todayIn('Asia/Kolkata')),
    session: { business_id: DEV_BUSINESS_ID, profile_id: DEV_PROFILE_ID },
    storage: opts.storage !== undefined ? opts.storage : safeStorage,
  });
  return {
    adapter,
    data: createRepositories(adapter),
    dataSource: {
      kind: adapter.kind,
      label: adapter.label,
      persisted: !!(opts.storage !== undefined ? opts.storage : safeStorage),
      description: 'Fictional development fixtures in this browser only. No backend is connected; nothing is sent anywhere.',
    },
  };
}
