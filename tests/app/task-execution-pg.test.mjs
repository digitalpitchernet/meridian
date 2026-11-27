import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalSupabase } from '../../tools/local-supabase.mjs';
import { createSupabaseAdapter } from '../../app/data/adapters/supabase.js';
import { createRepositories } from '../../app/data/repositories.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const hasPgServer = existsSync('C:\\Program Files\\PostgreSQL\\17\\share\\postgres.bki');

test('task execution E2E against real PostgreSQL 17: auth, workspace isolation, assignment, transitions, activity, reload', { skip: !hasPgServer && 'Local PostgreSQL 17 server (share/postgres.bki) is not installed' }, async (t) => {
  const workDir = mkdtempSync(join(REPO_ROOT, '.local-pg-test-'));
  const pgPort = 55439;
  const backend = createLocalSupabase({
    dataDir: join(workDir, 'data'),
    logFile: join(workDir, 'postgres.log'),
    port: pgPort,
    seedDemo: false,
  });

  backend.initAndStart();
  // Allow 2 workspaces in this test cluster so we can verify cross-workspace isolation
  backend.runPsql(backend.pgUrl, 'UPDATE public.installation_settings SET max_workspaces = 2;');

  const server = createServer((req, res) => backend.handleRequest(req, res));
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const { port: httpPort } = server.address();
  const baseUrl = `http://127.0.0.1:${httpPort}`;

  t.after(async () => {
    await new Promise(r => server.close(r));
    backend.stop();
    rmSync(workDir, { recursive: true, force: true });
  });

  const makeMemStorage = () => {
    const m = new Map();
    return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  };

  // 1. Sign up Founder A and create Workspace A
  const storageA = makeMemStorage();
  const adapterA = createSupabaseAdapter({ url: baseUrl, anonKey: 'test-anon', storage: storageA });
  const signUpA = await adapterA.auth.signUp('founder.a@meridian.test', 'passwordA123');
  assert.ok(signUpA.session?.access_token);
  const repoA = createRepositories(adapterA);

  const bizA = await adapterA.rpc('create_workspace', {
    p_business_name: 'Alpha Studio',
    p_base_currency: 'INR',
    p_locale: 'en-IN',
    p_timezone: 'Asia/Kolkata',
    p_full_name: 'Asha Varma',
    p_financial_year_start_month: 4,
  });
  assert.ok(bizA);

  const activeMemberA = await repoA.workspace.createParticipant({
    full_name: 'Rohan Mehra',
    participant_type: 'cofounder',
    is_active: true,
  });
  const inactiveMemberA = await repoA.workspace.createParticipant({
    full_name: 'Inactive Advisor',
    participant_type: 'advisor',
    is_active: false,
  });

  // 2. Sign up Founder B and create Workspace B
  const storageB = makeMemStorage();
  const adapterB = createSupabaseAdapter({ url: baseUrl, anonKey: 'test-anon', storage: storageB });
  await adapterB.auth.signUp('founder.b@meridian.test', 'passwordB123');
  const repoB = createRepositories(adapterB);

  const bizB = await adapterB.rpc('create_workspace', {
    p_business_name: 'Beta Labs',
    p_base_currency: 'USD',
    p_locale: 'en-US',
    p_timezone: 'America/New_York',
    p_full_name: 'Ben Carter',
    p_financial_year_start_month: 1,
  });
  assert.ok(bizB);
  const memberB = (await repoB.workspace.participants())[0];

  // 3. Founder A creates a task and assigns it to Rohan
  const created = await repoA.tasks.create({
    title: 'Ship Task Execution Slice',
    priority: 'High',
    status: 'Inbox',
    description: 'End-to-end persisted task.',
  });
  assert.equal(created.business_id, bizA);
  assert.equal(created.status, 'Inbox');
  assert.equal(created.completed_at, null);

  // 4. Reject assigning to inactive member (23514) and cross-workspace member (23503)
  await assert.rejects(
    repoA.tasks.update(created.id, { assigned_to_participant_id: inactiveMemberA.id }),
    err => err.code === '23514',
  );
  await assert.rejects(
    repoA.tasks.update(created.id, { assigned_to_participant_id: memberB.id }),
    err => err.code === '23503',
  );

  // 5. Assign to active Workspace A member
  const assigned = await repoA.tasks.update(created.id, { assigned_to_participant_id: activeMemberA.id });
  assert.equal(assigned.assigned_to_participant_id, activeMemberA.id);

  // 6. Workspace B cannot see or mutate Workspace A's task
  assert.equal(await repoB.tasks.get(created.id), null);
  assert.equal((await repoB.tasks.list()).length, 0);
  await assert.rejects(repoB.tasks.update(created.id, { status: 'Done' }), err => err.code === 'P0002');

  // 7. Status transitions & server-side completed_at
  const inProgress = await repoA.tasks.update(created.id, { status: 'In Progress' });
  assert.equal(inProgress.status, 'In Progress');
  assert.equal(inProgress.completed_at, null);

  const completed = await repoA.tasks.update(created.id, { status: 'Done' });
  assert.equal(completed.status, 'Done');
  assert.ok(completed.completed_at, 'completed_at set server-side by sync_task_completion');

  // 8. Check accountability activity_records
  const history = await repoA.activity.forEntity('tasks', created.id, 20);
  const eventTypes = history.map(a => a.event_type);
  assert.ok(eventTypes.includes('tasks.insert'));
  assert.ok(eventTypes.includes('tasks.assigned'));
  assert.ok(eventTypes.includes('tasks.status_changed'));
  assert.ok(eventTypes.includes('tasks.completed'));
  assert.ok(history.every(a => a.actor_type === 'user' && a.actor_id === signUpA.user.id));

  // 9. Simulate full browser reload: new adapter + repositories reading only from storageA + Postgres
  const reloadedAdapter = createSupabaseAdapter({ url: baseUrl, anonKey: 'test-anon', storage: storageA });
  const restoredSession = await reloadedAdapter.auth.getSession();
  assert.equal(restoredSession.user.id, signUpA.user.id);
  const reloadedRepo = createRepositories(reloadedAdapter);
  const reloadedTask = await reloadedRepo.tasks.get(created.id);
  assert.equal(reloadedTask.title, 'Ship Task Execution Slice');
  assert.equal(reloadedTask.status, 'Done');
  assert.equal(reloadedTask.assigned_to_participant_id, activeMemberA.id);
});
