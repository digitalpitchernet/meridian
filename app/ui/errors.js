// Turn data-layer errors (Postgres SQLSTATE, as the adapters raise them) into plain messages for the founder.
const CONSTRAINTS = {
  chk_projects_dates: 'The target date can’t be before the start date.',
  chk_tasks_recurrence: 'Choose both a repeat rule and an interval, or neither.',
  chk_calendar_times: 'The end can’t be before the start.',
};
const LABELS = { name: 'Name', title: 'Title', status: 'Status', priority: 'Priority', due_date: 'Due date', target_date: 'Target date', start_date: 'Start date',
  project_id: 'Project', first_name: 'First name', category: 'Category', decision_date: 'Decision date', review_date: 'Review date', starts_at: 'Start', ends_at: 'End',
  superseded_by_id: 'Superseding decision', selected_option_id: 'Selected option', relationship_role: 'Role' };

export function friendlyError(e) {
  const col = e?.details?.column;
  const label = LABELS[col] || col;
  switch (e?.code) {
    case '23502': return { column: col, message: `${label || 'This field'} is required.` };
    case '23514':
      if (e.details?.constraint && CONSTRAINTS[e.details.constraint]) return { column: e.details.constraint === 'chk_projects_dates' ? 'target_date' : null, message: CONSTRAINTS[e.details.constraint] };
      if (/length (\d+)–(\d+)/.test(e.message)) { const [, a, b] = e.message.match(/length (\d+)–(\d+)/); return { column: col, message: `${label} must be ${a}–${b} characters.` }; }
      return { column: col, message: `${label || 'That value'} isn’t allowed.` };
    case '23503': return { column: col, message: 'The linked record no longer exists. Refresh and try again.' };
    case '42501': return { column: col, message: 'Not permitted. Meridian manages that field itself.' };
    case '22007': return { column: col, message: `${label || 'That date'} isn’t a valid date.` };
    default: return { column: col, message: e?.message || 'Something went wrong.' };
  }
}
