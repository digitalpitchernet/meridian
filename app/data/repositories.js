// Repositories: the ONLY way screens read or write data. Named after the backend tables, views and RPCs
// (supabase/migrations, ENGINEERING-SPEC §5), so swapping the development adapter for the Supabase adapter
// does not change a single screen. Each repository takes an adapter with select/get/insert/update/remove/rpc.

export function createRepositories(db) {
  const table = name => ({
    list: (query) => db.select(name, query),
    get: (id) => db.get(name, id),
    create: (row) => db.insert(name, row),
    update: (id, patch) => db.update(name, id, patch),
    remove: (id) => db.remove(name, id),
  });

  const workspace = {
    // one workspace per installation: the caller's business (get_current_business_id) and own profile
    async business() { const id = await db.rpc('get_current_business_id'); return db.get('businesses', id); },
    async profile() { return (await db.select('profiles', { limit: 1 }))[0] ?? null; },
    updateBusiness: (id, patch) => db.update('businesses', id, patch),
    updateProfile: (id, patch) => db.update('profiles', id, patch),
    participants: () => db.select('participants', { order: [{ col: 'created_at' }] }),
  };

  const projects = {
    ...table('projects'),
    list: (query = {}) => db.select('projects', { order: [{ col: 'updated_at', asc: false }], ...query }),
  };

  const milestones = {
    ...table('milestones'),
    forProject: (projectId) => db.select('milestones', { eq: { project_id: projectId }, order: [{ col: 'due_date' }] }),
    list: (query = {}) => db.select('milestones', { order: [{ col: 'due_date' }], ...query }),
  };

  const tasks = {
    ...table('tasks'),
    list: (query = {}) => db.select('tasks', { order: [{ col: 'due_date' }, { col: 'created_at' }], ...query }),
    forProject: (projectId) => db.select('tasks', { eq: { project_id: projectId }, order: [{ col: 'due_date' }, { col: 'created_at' }] }),
    subtasks: (taskId) => db.select('subtasks', { eq: { task_id: taskId }, order: [{ col: 'sort_order' }, { col: 'created_at' }] }),
    allSubtasks: () => db.select('subtasks'),
    addSubtask: (row) => db.insert('subtasks', row),
    updateSubtask: (id, patch) => db.update('subtasks', id, patch),
    removeSubtask: (id) => db.remove('subtasks', id),
  };

  const calendar = {
    ...table('calendar_events'),
    // events overlapping [fromIso, toIso)
    async between(fromIso, toIso) {
      const all = await db.select('calendar_events', { order: [{ col: 'starts_at' }] });
      return all.filter(e => e.ends_at >= fromIso && e.starts_at < toIso);
    },
  };

  const activity = {
    // activity_records is append-only and server-written: no create/update/remove here, by design
    recent: (limit = 20) => db.select('activity_records', { order: [{ col: 'created_at', asc: false }], limit }),
  };

  const contacts = { ...table('contacts'), list: (q = {}) => db.select('contacts', { order: [{ col: 'first_name' }], ...q }) };

  return { workspace, projects, milestones, tasks, calendar, activity, contacts };
}
