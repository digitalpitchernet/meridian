import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixtureAdapter } from '../../app/data/adapters/fixture.js';
import { createSupabaseAdapter } from '../../app/data/adapters/supabase.js';
import { resolveDataConfig } from '../../app/data/index.js';
import { buildFixtures, DEV_BUSINESS_ID, DEV_PROFILE_ID } from '../../app/data/fixtures/dev-fixtures.js';
import { createRepositories } from '../../app/data/repositories.js';
import { todayIn } from '../../app/core/format.js';
import { quickAddStatusForView } from '../../app/modules/projections.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function makeFixture() {
  const db = createFixtureAdapter({
    seed: () => buildFixtures(todayIn('Asia/Kolkata')),
    session: { business_id: DEV_BUSINESS_ID, profile_id: DEV_PROFILE_ID },
  });
  return { db, repo: createRepositories(db) };
}

function makeMemStorage() {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
}

test('task execution (fixture): assign to active member, reject inactive member, transition and log activity', async () => {
  const { repo } = makeFixture();
  const participants = await repo.workspace.participants();
  const active = participants.find(p => p.is_active);
  assert.ok(active);

  const inactive = await repo.workspace.createParticipant({
    full_name: 'Former Advisor',
    participant_type: 'advisor',
    is_active: false,
  });

  const task = await repo.tasks.create({ title: 'Verify persistence', status: 'Inbox', priority: 'High' });
  assert.equal(task.assigned_to_participant_id, null);

  await assert.rejects(
    repo.tasks.update(task.id, { assigned_to_participant_id: inactive.id }),
    err => err.code === '23514',
  );

  // Simultaneous status + assignee change must emit both accountability events
  const movedAndAssigned = await repo.tasks.update(task.id, {
    status: 'In Progress',
    assigned_to_participant_id: active.id,
  });
  assert.equal(movedAndAssigned.status, 'In Progress');
  assert.equal(movedAndAssigned.assigned_to_participant_id, active.id);
  assert.equal(movedAndAssigned.completed_at, null);

  const done = await repo.tasks.update(task.id, { status: 'Done' });
  assert.equal(done.status, 'Done');
  assert.ok(done.completed_at);

  const act = await repo.activity.forEntity('tasks', task.id, 10);
  const types = act.map(a => a.event_type);
  assert.ok(types.includes('tasks.insert'));
  assert.ok(types.includes('tasks.status_changed'));
  assert.ok(types.includes('tasks.assigned'));
  assert.ok(types.includes('tasks.completed'));
});

test('supabase adapter: maps auth, query filters, inserts with business_id, and SQLSTATE errors', async () => {
  const calls = [];
  const storage = makeMemStorage();

  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/auth/v1/token?grant_type=password')) {
      return new Response(JSON.stringify({ access_token: 'tok-1', refresh_token: 'rt-1', expires_in: 3600, user: { id: 'u-1', email: 'a@b.com' } }), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/get_current_business_id')) {
      return new Response(JSON.stringify('biz-1'), { status: 200 });
    }
    if (url.includes('/rest/v1/tasks') && init.method === 'POST') {
      return new Response(JSON.stringify([{ id: 't-1', business_id: 'biz-1', title: 'Ship slice', status: 'Inbox' }]), { status: 201 });
    }
    if (url.includes('/rest/v1/tasks') && init.method === 'PATCH') {
      return new Response(JSON.stringify({ code: '23514', message: 'cannot assign a task to an inactive workspace member' }), { status: 400 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };

  const adapter = createSupabaseAdapter({ url: 'http://127.0.0.1:5180', anonKey: 'anon', fetchImpl, storage });
  const session = await adapter.auth.signIn('a@b.com', 'secret123');
  assert.equal(session.access_token, 'tok-1');

  const repo = createRepositories(adapter);
  const created = await repo.tasks.create({ title: 'Ship slice' });
  assert.equal(created.business_id, 'biz-1');

  const postCall = calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/tasks'));
  assert.equal(postCall.body.business_id, 'biz-1');
  assert.equal(postCall.headers.Authorization, 'Bearer tok-1');

  await assert.rejects(
    repo.tasks.update('t-1', { assigned_to_participant_id: 'p-inactive' }),
    err => err.code === '23514',
  );
});

test('supabase adapter auth: proactive refresh, concurrent 401 retry, session expiry, and signOut', async () => {
  let clock = 1000;
  let refreshCount = 0;
  let logoutCount = 0;
  let failRefresh = false;
  let force401 = false;
  const events = [];
  const storage = makeMemStorage();

  const fetchImpl = async (url, init) => {
    if (url.endsWith('/auth/v1/token?grant_type=password')) {
      return new Response(JSON.stringify({
        access_token: 'tok-initial',
        refresh_token: 'rt-1',
        expires_at: clock + 20, // within 30s refresh margin
        user: { id: 'u-1', email: 'a@b.com' },
      }), { status: 200 });
    }
    if (url.endsWith('/auth/v1/token?grant_type=refresh_token')) {
      refreshCount += 1;
      if (failRefresh) return new Response(JSON.stringify({ error_description: 'Refresh token expired' }), { status: 401 });
      return new Response(JSON.stringify({
        access_token: `tok-refreshed-${refreshCount}`,
        refresh_token: `rt-${refreshCount + 1}`,
        expires_at: clock + 3600,
        user: { id: 'u-1', email: 'a@b.com' },
      }), { status: 200 });
    }
    if (url.endsWith('/auth/v1/logout')) {
      logoutCount += 1;
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (url.includes('/rest/v1/tasks')) {
      if (force401 && init.headers.Authorization === 'Bearer tok-refreshed-1') {
        return new Response(JSON.stringify({ message: 'JWT expired' }), { status: 401 });
      }
      return new Response(JSON.stringify([{ id: 't-1', title: 'OK' }]), { status: 200 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };

  const adapter = createSupabaseAdapter({
    url: 'http://127.0.0.1:5180',
    anonKey: 'anon',
    fetchImpl,
    storage,
    now: () => clock,
  });
  adapter.auth.onStateChange(ev => events.push(ev));

  await adapter.auth.signIn('a@b.com', 'secret123');
  // Proactive refresh triggers because expires_at is within 30s
  const rows = await adapter.select('tasks');
  assert.equal(rows.length, 1);
  assert.equal(refreshCount, 1);
  assert.ok(events.includes('TOKEN_REFRESHED'));

  // Concurrent 401s coalesce into a single refresh_token request
  force401 = true;
  const [r1, r2] = await Promise.all([adapter.select('tasks'), adapter.select('tasks')]);
  assert.equal(r1.length, 1);
  assert.equal(r2.length, 1);
  assert.equal(refreshCount, 2, 'concurrent 401s must coalesce into one refresh call');

  // Expired refresh token clears session and emits SIGNED_OUT
  failRefresh = true;
  clock += 4000; // past expires_at
  await assert.rejects(adapter.select('tasks'), err => err.code === '42501');
  assert.equal(storage.getItem('meridian.auth.v1'), null);
  assert.equal(events[events.length - 1], 'SIGNED_OUT');

  // Sign in again and sign out explicitly
  failRefresh = false;
  force401 = false;
  await adapter.auth.signIn('a@b.com', 'secret123');
  await adapter.auth.signOut();
  assert.equal(logoutCount, 1);
  assert.equal(storage.getItem('meridian.auth.v1'), null);
  await assert.rejects(adapter.select('tasks'), err => err.code === '42501');
});

test('data source selection: never silently falls back to fixtures when live config is missing or unreachable', async () => {
  await assert.rejects(
    resolveDataConfig({ search: '', globalConfig: null, fetchImpl: async () => new Response('not found', { status: 404 }) }),
    err => /missing/i.test(err.message),
  );
  await assert.rejects(
    resolveDataConfig({ search: '', globalConfig: null, fetchImpl: async () => { throw new Error('network down'); } }),
    err => /unreachable/i.test(err.message),
  );
  assert.deepEqual(await resolveDataConfig({ search: '?mode=dev', globalConfig: null }), { mode: 'fixtures' });
  assert.deepEqual(
    await resolveDataConfig({ search: '', globalConfig: null, fetchImpl: async () => new Response(JSON.stringify({ mode: 'fixtures' }), { status: 200 }) }),
    { mode: 'fixtures' },
  );
  const live = await resolveDataConfig({
    search: '',
    globalConfig: null,
    fetchImpl: async () => new Response(JSON.stringify({ supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'k' }), { status: 200 }),
  });
  assert.equal(live.mode, 'supabase');
  assert.equal(live.supabaseUrl, 'https://example.supabase.co');
});

test('migration 10 static safety check: aligns with tenancy, column grants, search_path, and dual activity', () => {
  const m10 = readFileSync(resolve(REPO_ROOT, 'supabase', 'migrations', '20261127000000_task_execution_slice.sql'), 'utf8');
  assert.match(m10, /FOREIGN KEY\s*\(business_id,\s*assigned_to_participant_id\)\s*REFERENCES\s+public\.participants\(business_id,\s*id\)/i);
  assert.match(m10, /GRANT UPDATE\s*\(assigned_to_participant_id\)\s*ON\s+public\.tasks\s+TO\s+authenticated/i);
  assert.match(m10, /guard_task_assignee\(\)[\s\S]*SECURITY DEFINER SET search_path = ''/i);
  assert.match(m10, /record_task_activity\(\)[\s\S]*SECURITY DEFINER SET search_path = ''/i);
  assert.match(m10, /REVOKE ALL ON FUNCTION public\.guard_task_assignee\(\) FROM PUBLIC, anon, authenticated/i);
  assert.match(m10, /REVOKE ALL ON FUNCTION public\.record_task_activity\(\) FROM PUBLIC, anon, authenticated/i);
  assert.doesNotMatch(m10, /ELSIF\s+OLD\.assigned_to_participant_id\s+IS\s+DISTINCT\s+FROM/i, 'status and assignee activity must be independent IF blocks');
});

test('context-aware quickAddStatusForView maps tabs predictably', () => {
  assert.equal(quickAddStatusForView('Open'), 'Inbox');
  assert.equal(quickAddStatusForView('Done'), 'Inbox');
  assert.equal(quickAddStatusForView('Inbox'), 'Inbox');
  assert.equal(quickAddStatusForView('Next'), 'Next');
  assert.equal(quickAddStatusForView('In Progress'), 'In Progress');
  assert.equal(quickAddStatusForView('Waiting'), 'Waiting');
});

test('task continuity wiring: projects, milestones, and launcher include participant lookups and controls', () => {
  const projSrc = readFileSync(resolve(REPO_ROOT, 'app', 'modules', 'projects.js'), 'utf8');
  const msSrc = readFileSync(resolve(REPO_ROOT, 'app', 'modules', 'milestones.js'), 'utf8');
  const launcherSrc = readFileSync(resolve(REPO_ROOT, 'app', 'ui', 'launcher.js'), 'utf8');
  const shellCss = readFileSync(resolve(REPO_ROOT, 'app', 'styles', 'shell.css'), 'utf8');
  assert.match(projSrc, /lookups\s*=\s*\{[^}]*participants/);
  assert.match(msSrc, /taskRows\([\s\S]*?participants/);
  assert.match(launcherSrc, /assigned_to_participant_id:\s*nullIfEmpty\(assignee\.value\)/);
  assert.match(launcherSrc, /milestone_id:\s*nullIfEmpty\(milestone\.value\)/);
  assert.match(shellCss, /\.me-signout\s*\{[^}]*margin-left:\s*auto/);
});
