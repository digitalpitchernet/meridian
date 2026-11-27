import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalSupabase, hasLocalPgServer } from '../../tools/local-supabase.mjs';
import { createSupabaseAdapter } from '../../app/data/adapters/supabase.js';
import { createRepositories } from '../../app/data/repositories.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const hasRemoteValidationProject = Boolean(
  process.env.TEST_SUPABASE_URL && process.env.TEST_SUPABASE_ANON_KEY && process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
);
const canRunPgE2E = hasLocalPgServer() || hasRemoteValidationProject;

test(
  'task execution E2E against PostgreSQL: auth, workspace isolation, assignment, transitions, activity, reload',
  { skip: !canRunPgE2E && 'No local PostgreSQL server (pg_config --sharedir/postgres.bki) or TEST_SUPABASE_* validation project configured' },
  async (t) => {
    let baseUrl;
    let anonKey = 'test-anon';

    if (hasLocalPgServer()) {
      const workDir = mkdtempSync(join(REPO_ROOT, '.local-pg-test-'));
      const backend = createLocalSupabase({
        dataDir: join(workDir, 'data'),
        logFile: join(workDir, 'postgres.log'),
        port: 55439,
        seedDemo: false,
      });
      backend.initAndStart();
      backend.runPsql(backend.pgUrl, 'UPDATE public.installation_settings SET max_workspaces = 2;');

      const server = createServer((req, res) => backend.handleRequest(req, res));
      await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
      const { port: httpPort } = server.address();
      baseUrl = `http://127.0.0.1:${httpPort}`;

      t.after(async () => {
        await new Promise(r => server.close(r));
        backend.stop();
        rmSync(workDir, { recursive: true, force: true });
      });
    } else {
      baseUrl = process.env.TEST_SUPABASE_URL;
      anonKey = process.env.TEST_SUPABASE_ANON_KEY;
    }

    const makeMemStorage = () => {
      const m = new Map();
      return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
    };

    const storageA = makeMemStorage();
    const adapterA = createSupabaseAdapter({ url: baseUrl, anonKey, storage: storageA });
    const signUpA = await adapterA.auth.signUp(`founder.a.${Date.now()}@meridian.test`, 'passwordA123');
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

    const storageB = makeMemStorage();
    const adapterB = createSupabaseAdapter({ url: baseUrl, anonKey, storage: storageB });
    await adapterB.auth.signUp(`founder.b.${Date.now()}@meridian.test`, 'passwordB123');
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

    const created = await repoA.tasks.create({
      title: 'Ship Task Execution Slice',
      priority: 'High',
      status: 'Inbox',
      description: 'End-to-end persisted task.',
    });
    assert.equal(created.business_id, bizA);
    assert.equal(created.status, 'Inbox');
    assert.equal(created.completed_at, null);

    // Reject inactive member (23514) and cross-workspace member (23503)
    await assert.rejects(
      repoA.tasks.update(created.id, { assigned_to_participant_id: inactiveMemberA.id }),
      err => err.code === '23514',
    );
    await assert.rejects(
      repoA.tasks.update(created.id, { assigned_to_participant_id: memberB.id }),
      err => err.code === '23503',
    );

    // Simultaneous status + assignee update must log both events
    const movedAndAssigned = await repoA.tasks.update(created.id, {
      status: 'In Progress',
      assigned_to_participant_id: activeMemberA.id,
    });
    assert.equal(movedAndAssigned.status, 'In Progress');
    assert.equal(movedAndAssigned.assigned_to_participant_id, activeMemberA.id);

    // Workspace B cannot see or mutate Workspace A's task
    assert.equal(await repoB.tasks.get(created.id), null);
    assert.equal((await repoB.tasks.list()).length, 0);
    await assert.rejects(repoB.tasks.update(created.id, { status: 'Done' }), err => err.code === 'P0002');

    // Complete task -> server-side completed_at
    const completed = await repoA.tasks.update(created.id, { status: 'Done' });
    assert.equal(completed.status, 'Done');
    assert.ok(completed.completed_at);

    // Accountability activity_records
    const history = await repoA.activity.forEntity('tasks', created.id, 20);
    const eventTypes = history.map(a => a.event_type);
    assert.ok(eventTypes.includes('tasks.insert'));
    assert.ok(eventTypes.includes('tasks.assigned'));
    assert.ok(eventTypes.includes('tasks.status_changed'));
    assert.ok(eventTypes.includes('tasks.completed'));
    assert.ok(history.every(a => a.actor_type === 'user' && a.actor_id === signUpA.user.id));

    // Reload persistence
    const reloadedAdapter = createSupabaseAdapter({ url: baseUrl, anonKey, storage: storageA });
    const restoredSession = await reloadedAdapter.auth.getSession();
    assert.equal(restoredSession.user.id, signUpA.user.id);
    const reloadedRepo = createRepositories(reloadedAdapter);
    const reloadedTask = await reloadedRepo.tasks.get(created.id);
    assert.equal(reloadedTask.title, 'Ship Task Execution Slice');
    assert.equal(reloadedTask.status, 'Done');
    assert.equal(reloadedTask.assigned_to_participant_id, activeMemberA.id);
  },
);
