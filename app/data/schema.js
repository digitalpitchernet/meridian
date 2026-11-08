// Mirror of the Gate 1 schema (supabase/migrations, Rev 2.3.4) for the tables the app uses so far.
// The development adapter enforces these rules so screens are built against the real constraints.
// The DATABASE is the authority: when this file and the migrations disagree, the migrations win and this is a bug.
//
// Column spec: { type, notNull, default, enum, len: [min, max] (btrim length), pattern, between: [lo, hi] }
// Table spec:  insert: true (all columns) | [cols] | false   update: [granted columns] | false   delete: bool
//              fks: [{ col, ref, onDelete: 'cascade' | 'set null' }]   checks: [(row) => true | 'constraint_name']
//              activity: true when record_activity() is attached   sync: per-table trigger emulation key

const uuid = { type: 'uuid' };
const id = { type: 'uuid', notNull: true, default: 'uuid' };
const businessId = { type: 'uuid', notNull: true };
const ts = { type: 'timestamptz', notNull: true, default: 'now' };
const text = { type: 'text' };
const date = { type: 'date' };

export const ENUMS = {
  projectStatus: ['Planning', 'Active', 'On Hold', 'Completed', 'Archived'],
  priority: ['Low', 'Normal', 'High', 'Critical'],
  taskStatus: ['Inbox', 'Next', 'In Progress', 'Waiting', 'Done'],
  milestoneStatus: ['Upcoming', 'In Progress', 'Achieved', 'Delayed', 'Cancelled'],
  decisionStatus: ['Proposed', 'Approved', 'Superseded', 'Rejected'],
  contactCategory: ['Investor', 'Client', 'Partner', 'Vendor', 'Advisor', 'Collaborator', 'Other'],
  recurrence: ['daily', 'weekly', 'monthly', 'quarterly', 'annually'],
  theme: ['dark', 'light', 'system'],
  dateFormat: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'],
  timeFormat: ['12h', '24h'],
  weekStart: ['Monday', 'Sunday', 'Saturday'],
  participantType: ['founder', 'cofounder', 'investor', 'advisor', 'lender', 'other'],
};

export const TABLES = {
  // ---- migration 1: tenancy and privileges (clients cannot insert businesses or profiles; create_workspace does) ----
  businesses: {
    columns: {
      id, business_name: { ...text, notNull: true, len: [1, 200] }, legal_entity_name: text, industry: text,
      base_currency: { type: 'char3', notNull: true, pattern: /^[A-Z]{3}$/ },
      locale: { ...text, notNull: true, pattern: /^[a-z]{2,3}(-[A-Z]{2})?$/ },
      timezone: { ...text, notNull: true, rawLen: [2, 64] },
      financial_year_start_month: { type: 'int', notNull: true, default: 4, between: [1, 12] },
      accent_color: { ...text, notNull: true, default: '#3B82F6', pattern: /^#[0-9A-Fa-f]{6}$/ },
      logo_storage_key: text, created_by_user_id: { ...uuid, notNull: true }, created_at: ts, updated_at: ts,
    },
    insert: false,
    update: ['business_name', 'legal_entity_name', 'industry', 'locale', 'timezone', 'financial_year_start_month', 'accent_color', 'logo_storage_key'],
    delete: false, immutableBy: { base_currency: 'businesses.base_currency is fixed after onboarding' },
  },
  profiles: {
    columns: {
      id, business_id: businessId, full_name: { ...text, notNull: true, len: [1, 200] }, email: { ...text, notNull: true },
      role_title: text, avatar_storage_key: text,
      theme: { ...text, notNull: true, default: 'dark', enum: ENUMS.theme },
      date_format: { ...text, notNull: true, default: 'DD/MM/YYYY', enum: ENUMS.dateFormat },
      time_format: { ...text, notNull: true, default: '24h', enum: ENUMS.timeFormat },
      week_start_day: { ...text, notNull: true, default: 'Monday', enum: ENUMS.weekStart },
      number_format: { ...text, notNull: true, default: 'en-IN', rawLen: [2, 16] },
      countdown_preferences: { type: 'jsonb', notNull: true, default: () => ({ show_milestone_countdowns: true, show_runway_days: true }) },
      widget_layout: { type: 'jsonb', notNull: true, default: () => ({ order: ['kpi', 'attention', 'projects', 'finance', 'funding', 'schedule', 'activity'], hidden: [] }) },
      onboarding_completed: { type: 'bool', notNull: true, default: false },
      created_at: ts, updated_at: ts,
    },
    insert: false,
    update: ['full_name', 'role_title', 'avatar_storage_key', 'theme', 'date_format', 'time_format', 'week_start_day', 'number_format', 'countdown_preferences', 'widget_layout', 'onboarding_completed'],
    delete: false,
  },
  participants: {
    columns: {
      id, business_id: businessId, profile_id: uuid, full_name: { ...text, notNull: true, len: [1, 200] },
      participant_type: { ...text, notNull: true, enum: ENUMS.participantType }, designation: text, email: text, phone: text,
      agreed_equity_percentage: { type: 'numeric' }, avatar_storage_key: text, is_active: { type: 'bool', notNull: true, default: true },
      notes: text, created_at: ts, updated_at: ts,
    },
    insert: ['business_id', 'profile_id', 'full_name', 'participant_type', 'designation', 'email', 'phone', 'agreed_equity_percentage', 'avatar_storage_key', 'is_active', 'notes'],
    update: ['profile_id', 'full_name', 'participant_type', 'designation', 'email', 'phone', 'agreed_equity_percentage', 'avatar_storage_key', 'is_active', 'notes'],
    delete: true,
  },
  activity_records: {
    // append-only; written only by server triggers and RPCs (no client INSERT, no UPDATE/DELETE for anyone)
    columns: {
      id, business_id: businessId, actor_type: { ...text, notNull: true, enum: ['user', 'system'] }, actor_id: uuid,
      event_type: { ...text, notNull: true }, entity_table: { ...text, notNull: true }, entity_id: { ...uuid, notNull: true },
      summary: { ...text, notNull: true }, metadata: { type: 'jsonb', notNull: true, default: () => ({}) }, created_at: ts,
    },
    insert: false, update: false, delete: false,
  },

  // ---- migration 2: operations (full CRUD for the founder; UPDATE is column-granted) ----
  contacts: {
    columns: {
      id, business_id: businessId, first_name: { ...text, notNull: true, len: [1, 120] }, last_name: text, organization: text, role: text,
      email: text, phone: text, category: { ...text, notNull: true, enum: ENUMS.contactCategory }, notes: text, created_at: ts, updated_at: ts,
    },
    insert: true, update: ['first_name', 'last_name', 'organization', 'role', 'email', 'phone', 'category', 'notes'], delete: true,
  },
  projects: {
    columns: {
      id, business_id: businessId, name: { ...text, notNull: true, len: [1, 200] }, description: text, notes: text,
      status: { ...text, notNull: true, default: 'Planning', enum: ENUMS.projectStatus },
      priority: { ...text, notNull: true, default: 'Normal', enum: ENUMS.priority },
      start_date: date, target_date: date, completed_at: { type: 'timestamptz' }, created_at: ts, updated_at: ts,
    },
    insert: true, update: ['name', 'description', 'notes', 'status', 'priority', 'start_date', 'target_date', 'completed_at'], delete: true,
    checks: [r => !r.target_date || !r.start_date || r.target_date >= r.start_date || 'chk_projects_dates'],
    activity: true,
  },
  milestones: {
    columns: {
      id, business_id: businessId, project_id: { ...uuid, notNull: true }, title: { ...text, notNull: true, len: [1, 200] }, description: text,
      due_date: { ...date, notNull: true }, status: { ...text, notNull: true, default: 'Upcoming', enum: ENUMS.milestoneStatus },
      achieved_at: { type: 'timestamptz' }, created_at: ts, updated_at: ts,
    },
    insert: true, update: ['project_id', 'title', 'description', 'due_date', 'status', 'achieved_at'], delete: true,
    fks: [{ col: 'project_id', ref: 'projects', onDelete: 'cascade' }],
    activity: true,
  },
  tasks: {
    columns: {
      id, business_id: businessId, project_id: uuid, milestone_id: uuid, title: { ...text, notNull: true, len: [1, 300] }, description: text, notes: text,
      status: { ...text, notNull: true, default: 'Inbox', enum: ENUMS.taskStatus },
      priority: { ...text, notNull: true, default: 'Normal', enum: ENUMS.priority },
      due_date: date, recurrence_rule: { ...text, enum: ENUMS.recurrence }, recurrence_interval: { type: 'int', between: [1, 365] },
      completed_at: { type: 'timestamptz' }, created_at: ts, updated_at: ts,
    },
    insert: true, update: ['project_id', 'milestone_id', 'title', 'description', 'notes', 'status', 'priority', 'due_date', 'recurrence_rule', 'recurrence_interval'], delete: true,
    fks: [{ col: 'project_id', ref: 'projects', onDelete: 'set null' }, { col: 'milestone_id', ref: 'milestones', onDelete: 'set null' }],
    checks: [r => (r.recurrence_rule == null) === (r.recurrence_interval == null) || 'chk_tasks_recurrence'],
    activity: true, sync: 'taskCompletion',
  },
  subtasks: {
    columns: {
      id, business_id: businessId, task_id: { ...uuid, notNull: true }, title: { ...text, notNull: true, len: [1, 300] },
      is_completed: { type: 'bool', notNull: true, default: false }, sort_order: { type: 'int', notNull: true, default: 0 }, created_at: ts, updated_at: ts,
    },
    insert: true, update: ['title', 'is_completed', 'sort_order'], delete: true,
    fks: [{ col: 'task_id', ref: 'tasks', onDelete: 'cascade' }],
  },
  decisions: {
    columns: {
      id, business_id: businessId, project_id: uuid, contact_id: uuid, title: { ...text, notNull: true, len: [1, 300] },
      context: { ...text, notNull: true, default: '' }, problem: { ...text, notNull: true, default: '' }, rationale: { ...text, notNull: true, default: '' },
      status: { ...text, notNull: true, default: 'Proposed', enum: ENUMS.decisionStatus }, decision_date: { ...date, notNull: true, default: 'today' },
      review_date: date, selected_option_id: uuid, superseded_by_id: uuid, created_at: ts, updated_at: ts,
    },
    insert: true, update: ['project_id', 'contact_id', 'title', 'context', 'problem', 'rationale', 'status', 'decision_date', 'review_date', 'selected_option_id', 'superseded_by_id'], delete: true,
    fks: [{ col: 'project_id', ref: 'projects', onDelete: 'set null' }, { col: 'contact_id', ref: 'contacts', onDelete: 'set null' }],
    activity: true,
  },
  calendar_events: {
    columns: {
      id, business_id: businessId, project_id: uuid, task_id: uuid, milestone_id: uuid, contact_id: uuid, title: { ...text, notNull: true, len: [1, 300] },
      description: text, location: text, starts_at: { type: 'timestamptz', notNull: true }, ends_at: { type: 'timestamptz', notNull: true },
      is_all_day: { type: 'bool', notNull: true, default: false }, created_at: ts, updated_at: ts,
    },
    insert: true, update: ['project_id', 'task_id', 'milestone_id', 'contact_id', 'title', 'description', 'location', 'starts_at', 'ends_at', 'is_all_day'], delete: true,
    fks: [{ col: 'project_id', ref: 'projects', onDelete: 'set null' }, { col: 'task_id', ref: 'tasks', onDelete: 'set null' },
          { col: 'milestone_id', ref: 'milestones', onDelete: 'set null' }, { col: 'contact_id', ref: 'contacts', onDelete: 'set null' }],
    checks: [r => new Date(r.ends_at) >= new Date(r.starts_at) || 'chk_calendar_times'],
  },
};

// SQLSTATE codes the adapter raises, matching what PostgREST returns from Postgres
export const SQLSTATE = { notNull: '23502', check: '23514', fk: '23503', unique: '23505', privilege: '42501', noRow: 'P0002' };
