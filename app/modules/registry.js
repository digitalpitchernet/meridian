// Module registry: the approved V1 modules, their sidebar group (Command / Workspace / Business / Insights / System),
// route, the tables that back them (ENGINEERING-SPEC §2) and their build state. Unbuilt modules route to an honest
// "not built yet" page inside the shell rather than to a mock screen.
export const GROUPS = ['Command', 'Workspace', 'Business', 'Insights', 'System'];

export const MODULES = [
  { id: 'command', group: 'Command', label: 'Command Centre', icon: 'command', path: '/command', milestone: 'M1',
    summary: 'A projection of every module: what needs attention, what is moving and what is next. It stores nothing of its own.',
    tables: ['tasks', 'projects', 'milestones', 'calendar_events', 'activity_records'] },
  { id: 'projects', group: 'Workspace', label: 'Projects', icon: 'folder', path: '/projects', milestone: 'M1',
    summary: 'Projects with status, priority, dates, milestones and tasks.', tables: ['projects', 'milestones', 'project_contacts'] },
  { id: 'tasks', group: 'Workspace', label: 'Tasks', icon: 'checkSquare', path: '/tasks', milestone: 'M1',
    summary: 'Inbox, Next, In Progress, Waiting and Done, with priorities, due dates and subtasks.', tables: ['tasks', 'subtasks'] },
  { id: 'calendar', group: 'Workspace', label: 'Calendar', icon: 'calendar', path: '/calendar', milestone: 'M2', built: true,
    summary: 'Events linked to projects, tasks, milestones and contacts; month, week and agenda views.', tables: ['calendar_events'],
    planned: ['Month, week and agenda views in the business time zone', 'Events linked to a project, task, milestone or contact', 'All-day events and the profile week start'] },
  { id: 'milestones', group: 'Workspace', label: 'Milestones', icon: 'flag', path: '/milestones', milestone: 'M2', built: true,
    summary: 'Milestones across projects: Upcoming, In Progress, Achieved, Delayed, Cancelled.', tables: ['milestones'],
    planned: ['Timeline of every milestone by due date', 'Status changes with achieved dates', 'Countdowns where the profile enables them'] },
  { id: 'finances', group: 'Business', label: 'Finances', icon: 'wallet', path: '/finances', milestone: 'M3',
    summary: 'Accounts, transactions, funding requirements and commitments, capital structure, CSV import.',
    tables: ['financial_accounts', 'transactions', 'payment_allocations', 'funding_requirements', 'funding_commitments', 'capital_structures', 'import_batches'],
    planned: ['Accounts and available cash as of a date (get_available_cash)', 'Append-only transactions; corrections by reversal with a reason',
      'Requirement → commitment → payment → reconciliation, with derived commitment status', 'Founder loans and reimbursements kept separate from capital',
      'Capital structure and targets', 'CSV import: stage, decide duplicates, commit atomically'] },
  { id: 'contacts', group: 'Business', label: 'Contacts', icon: 'users', path: '/contacts', milestone: 'M2', built: true,
    summary: 'Investors, clients, partners, vendors, advisors and collaborators, with interactions.', tables: ['contacts', 'contact_interactions', 'project_contacts'],
    planned: ['Contacts by category', 'Interaction history (meetings, calls, emails, notes)', 'Links to projects'] },
  { id: 'decisions', group: 'Business', label: 'Decisions', icon: 'decision', path: '/decisions', milestone: 'M2', built: true,
    summary: 'Decision records with context, options, rationale and supersession.', tables: ['decisions', 'decision_options'],
    planned: ['Proposed, Approved, Superseded, Rejected', 'Options with pros and cons; the selected option', 'Review dates and supersession chains'] },
  { id: 'vault', group: 'Business', label: 'Company Vault', icon: 'vault', path: '/vault', milestone: 'M4',
    summary: 'Company documents, archive-only, behind one storage-provider interface.', tables: ['documents', 'document_links'],
    planned: ['Documents by category with versions', 'Links to projects, tasks, decisions, contacts and finance records', 'Archive-only: no client deletion'] },
  { id: 'reports', group: 'Insights', label: 'Reports', icon: 'chart', path: '/reports', milestone: 'M4',
    summary: 'Read-only reports built from the modules.', tables: [],
    planned: ['Project and task throughput', 'Funding and capital position', 'Exports'] },
  { id: 'settings', group: 'System', label: 'Settings', icon: 'settings', path: '/settings', milestone: 'M4',
    summary: 'Business profile, founder preferences and development data controls.', tables: ['businesses', 'profiles', 'participants'],
    planned: ['Business profile (base currency is fixed after onboarding)', 'Theme, accent, date, time and number formats, week start', 'Participants: founder and co-founder records'] },
];

export const moduleById = id => MODULES.find(m => m.id === id);
