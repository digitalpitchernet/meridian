// Data source selection. M1 has exactly one source: the development adapter with fictional fixtures.
// There is NO Supabase connection in this build. The Supabase adapter (same interface) arrives only after
// the relevant backend gate is authorised; screens will not change when it does.
import { createFixtureAdapter } from './adapters/fixture.js';
import { buildFixtures, DEV_BUSINESS_ID, DEV_PROFILE_ID } from './fixtures/dev-fixtures.js';
import { createRepositories } from './repositories.js';
import { todayIn } from '../core/format.js';

const safeStorage = (() => { try { const s = window.localStorage; s.setItem('__m', '1'); s.removeItem('__m'); return s; } catch { return null; } })();

export const adapter = createFixtureAdapter({
  seed: () => buildFixtures(todayIn('Asia/Kolkata')),
  session: { business_id: DEV_BUSINESS_ID, profile_id: DEV_PROFILE_ID }, // emulates auth.uid() -> profile
  storage: safeStorage,
});

export const data = createRepositories(adapter);

export const dataSource = {
  kind: adapter.kind,                 // 'development'
  label: adapter.label,               // shown in the shell at all times
  persisted: !!safeStorage,
  description: 'Fictional development fixtures in this browser only. No backend is connected; nothing is sent anywhere.',
};
