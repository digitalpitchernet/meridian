// Data source selection: connects to the configured Supabase/PostgreSQL backend when runtime config
// is present (and ?mode=dev is not forced), or falls back to the fictional development adapter.
import { createFixtureAdapter } from './adapters/fixture.js';
import { createSupabaseAdapter } from './adapters/supabase.js';
import { buildFixtures, DEV_BUSINESS_ID, DEV_PROFILE_ID } from './fixtures/dev-fixtures.js';
import { createRepositories } from './repositories.js';
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

async function loadRuntimeConfig() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') === 'dev') return null;
  if (window.__MERIDIAN_CONFIG__?.supabaseUrl) return window.__MERIDIAN_CONFIG__;
  try {
    const res = await fetch('./app-config.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const cfg = await res.json();
    return cfg?.supabaseUrl ? cfg : null;
  } catch {
    return null;
  }
}

export async function initData() {
  const cfg = await loadRuntimeConfig();
  if (cfg) {
    const adapter = createSupabaseAdapter({
      url: cfg.supabaseUrl,
      anonKey: cfg.supabaseAnonKey || 'local-anon',
      label: cfg.label || 'Supabase · live',
      storage: safeStorage,
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
    storage: safeStorage,
  });
  return {
    adapter,
    data: createRepositories(adapter),
    dataSource: {
      kind: adapter.kind,
      label: adapter.label,
      persisted: !!safeStorage,
      description: 'Fictional development fixtures in this browser only. No backend is connected; nothing is sent anywhere.',
    },
  };
}
