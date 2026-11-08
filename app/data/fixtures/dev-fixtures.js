// FICTIONAL DEVELOPMENT FIXTURES. Every name, organisation and figure here is invented for development.
// No real people, businesses or financial data. Used only by the development adapter (adapters/fixture.js).
// Dates are relative to business-local "today" so overdue / due-soon / upcoming states always exist.
import { addDays } from '../../core/format.js';
import { buildFinanceFixtures } from './dev-finance.js';
import { TABLES } from '../schema.js';

export const DEV_BUSINESS_ID = '00000000-0000-4000-8000-00000000b001';
export const DEV_PROFILE_ID = '00000000-0000-4000-8000-00000000a001';

const ids = {};
const fid = (kind, n) => (ids[`${kind}${n}`] ||= `00000000-0000-4000-8${{ p: '1', m: '2', t: '3', s: '4', e: '5', c: '6', r: '7', a: '8', x: '9', f: 'a', g: 'b', h: 'c' }[kind]}00-${String(n).padStart(12, '0')}`);

// ISO timestamp at hh:mm business-local (Asia/Kolkata, +05:30) on today + offset days
const at = (today, offset, hh = 10, mm = 0) => new Date(`${addDays(today, offset)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`).toISOString();

export function buildFixtures(today) {
  const B = DEV_BUSINESS_ID, d = n => addDays(today, n), ts = (n, h, m) => at(today, n, h, m);
  const base = (n, extra) => ({ business_id: B, created_at: ts(n, 9), updated_at: ts(n, 9), ...extra });

  const businesses = [{
    id: B, business_name: 'Kestrel Ridge Studio', legal_entity_name: 'Kestrel Ridge Studio Pvt Ltd (fictional)', industry: 'Product design studio',
    base_currency: 'INR', locale: 'en-IN', timezone: 'Asia/Kolkata', financial_year_start_month: 4, accent_color: '#3B82F6',
    logo_storage_key: null, created_by_user_id: '00000000-0000-4000-8000-00000000f001', created_at: ts(-120, 9), updated_at: ts(-120, 9),
  }];
  const profiles = [{
    id: DEV_PROFILE_ID, business_id: B, full_name: 'Asha Varma', email: 'asha@kestrel-ridge.example', role_title: 'Founder', avatar_storage_key: null,
    theme: 'dark', date_format: 'DD/MM/YYYY', time_format: '24h', week_start_day: 'Monday', number_format: 'en-IN',
    countdown_preferences: { show_milestone_countdowns: true, show_runway_days: true },
    widget_layout: { order: ['kpi', 'attention', 'projects', 'finance', 'funding', 'schedule', 'activity'], hidden: [] },
    onboarding_completed: true, created_at: ts(-120, 9), updated_at: ts(-120, 9),
  }];
  const participants = [
    base(-120, { id: fid('x', 1), profile_id: DEV_PROFILE_ID, full_name: 'Asha Varma', participant_type: 'founder', designation: 'Founder & CEO', email: 'asha@kestrel-ridge.example', phone: null, agreed_equity_percentage: '60.00', avatar_storage_key: null, is_active: true, notes: null }),
    base(-110, { id: fid('x', 2), profile_id: null, full_name: 'Rohan Mehra', participant_type: 'cofounder', designation: 'Co-founder, Engineering', email: 'rohan@kestrel-ridge.example', phone: null, agreed_equity_percentage: '40.00', avatar_storage_key: null, is_active: true, notes: null }),
  ];

  const P = n => fid('p', n);
  const projects = [
    base(-60, { id: P(1), name: 'Meridian private beta', description: 'Ship the founder workspace to five design partners.', notes: null, status: 'Active', priority: 'Critical', start_date: d(-60), target_date: d(24), completed_at: null }),
    base(-45, { id: P(2), name: 'Seed round preparation', description: 'Data room, deck and the first investor conversations.', notes: null, status: 'Active', priority: 'High', start_date: d(-45), target_date: d(40), completed_at: null }),
    base(-30, { id: P(3), name: 'Brand identity refresh', description: 'New wordmark, colour system and site typography.', notes: null, status: 'Planning', priority: 'Normal', start_date: d(7), target_date: d(70), completed_at: null }),
    base(-50, { id: P(4), name: 'Vendor contracts review', description: 'Renegotiate hosting and tooling contracts before renewal.', notes: 'Paused until the seed round closes.', status: 'On Hold', priority: 'Low', start_date: d(-50), target_date: d(30), completed_at: null }),
    base(-110, { id: P(5), name: 'Company incorporation', description: 'Incorporation, PAN/TAN and the first bank account.', notes: null, status: 'Completed', priority: 'High', start_date: d(-110), target_date: d(-80), completed_at: ts(-82, 17) }),
    base(-100, { id: P(6), name: 'Studio landing page v1', description: 'The first one-page site.', notes: null, status: 'Archived', priority: 'Low', start_date: d(-100), target_date: d(-90), completed_at: ts(-91, 16) }),
  ];

  const M = n => fid('m', n);
  const milestones = [
    base(-55, { id: M(1), project_id: P(1), title: 'Design partner onboarding', description: 'All five partners using the beta weekly.', due_date: d(10), status: 'In Progress', achieved_at: null }),
    base(-55, { id: M(2), project_id: P(1), title: 'Beta feature freeze', description: null, due_date: d(-3), status: 'Delayed', achieved_at: null }),
    base(-55, { id: M(3), project_id: P(1), title: 'Public waitlist opens', description: null, due_date: d(24), status: 'Upcoming', achieved_at: null }),
    base(-40, { id: M(4), project_id: P(2), title: 'Data room complete', description: 'Financials, cap table, contracts, product metrics.', due_date: d(5), status: 'In Progress', achieved_at: null }),
    base(-40, { id: M(5), project_id: P(2), title: 'First partner meetings', description: null, due_date: d(18), status: 'Upcoming', achieved_at: null }),
    base(-28, { id: M(6), project_id: P(3), title: 'Wordmark shortlist', description: null, due_date: d(21), status: 'Upcoming', achieved_at: null }),
    base(-105, { id: M(7), project_id: P(5), title: 'Certificate of incorporation', description: null, due_date: d(-85), status: 'Achieved', achieved_at: ts(-86, 15) }),
  ];

  const T = n => fid('t', n);
  const t = (n, created, x) => base(created, { id: T(n), description: null, notes: null, recurrence_rule: null, recurrence_interval: null, milestone_id: null, completed_at: null, ...x });
  const tasks = [
    t(1, -20, { project_id: P(1), milestone_id: M(2), title: 'Fix sync conflict on task reorder', status: 'In Progress', priority: 'Critical', due_date: d(-2) }),
    t(2, -18, { project_id: P(1), milestone_id: M(1), title: 'Onboarding call with partner #3', status: 'Next', priority: 'High', due_date: d(0) }),
    t(3, -16, { project_id: P(1), milestone_id: M(1), title: 'Write partner feedback form', status: 'Next', priority: 'Normal', due_date: d(2) }),
    t(4, -15, { project_id: P(1), milestone_id: M(2), title: 'Cut beta release notes', status: 'Waiting', priority: 'Normal', due_date: d(1), notes: 'Waiting on Rohan for the changelog.' }),
    t(5, -14, { project_id: P(1), milestone_id: M(3), title: 'Draft waitlist page copy', status: 'Inbox', priority: 'Normal', due_date: d(12) }),
    t(6, -25, { project_id: P(1), milestone_id: M(1), title: 'Set up partner Slack channels', status: 'Done', priority: 'Low', due_date: d(-10), completed_at: ts(-11, 18) }),
    t(7, -22, { project_id: P(1), milestone_id: M(2), title: 'Accessibility pass on the sidebar', status: 'Done', priority: 'Normal', due_date: d(-6), completed_at: ts(-6, 16) }),
    t(8, -12, { project_id: P(1), title: 'Decide on error-reporting vendor', status: 'Waiting', priority: 'Normal', due_date: d(6) }),
    t(9, -10, { project_id: P(2), milestone_id: M(4), title: 'Upload last 6 months of statements to the data room', status: 'In Progress', priority: 'High', due_date: d(-1) }),
    t(10, -10, { project_id: P(2), milestone_id: M(4), title: 'Cap table reconciliation with the CA', status: 'Next', priority: 'High', due_date: d(3) }),
    t(11, -9, { project_id: P(2), milestone_id: M(5), title: 'Shortlist 12 seed funds', status: 'Next', priority: 'Normal', due_date: d(8) }),
    t(12, -9, { project_id: P(2), title: 'Rewrite deck narrative slide 4–7', status: 'Inbox', priority: 'High', due_date: d(4) }),
    t(13, -8, { project_id: P(2), milestone_id: M(5), title: 'Warm intro request to Ishaan (fictional advisor)', status: 'Waiting', priority: 'Normal', due_date: d(-4) }),
    t(14, -30, { project_id: P(2), milestone_id: M(4), title: 'Draft one-page company summary', status: 'Done', priority: 'Normal', due_date: d(-14), completed_at: ts(-15, 12) }),
    t(15, -5, { project_id: P(3), milestone_id: M(6), title: 'Collect wordmark references', status: 'Inbox', priority: 'Low', due_date: d(14) }),
    t(16, -5, { project_id: P(3), title: 'Brief two independent type designers', status: 'Inbox', priority: 'Normal', due_date: null }),
    t(17, -48, { project_id: P(4), title: 'Export current hosting invoices', status: 'Waiting', priority: 'Low', due_date: d(20) }),
    t(18, -3, { project_id: null, title: 'Renew domain registrations', status: 'Next', priority: 'High', due_date: d(1) }),
    t(19, -2, { project_id: null, title: 'Book quarterly review with the CA', status: 'Inbox', priority: 'Normal', due_date: d(9) }),
    t(20, -1, { project_id: null, title: 'Read: pricing page teardown notes', status: 'Inbox', priority: 'Low', due_date: null }),
    t(21, -1, { project_id: null, title: 'Reply to the co-working space about desk renewal', status: 'Next', priority: 'Normal', due_date: d(-1) }),
    t(22, -40, { project_id: null, title: 'Monthly founder update email', status: 'Next', priority: 'Normal', due_date: d(5), recurrence_rule: 'monthly', recurrence_interval: 1 }),
    t(23, -95, { project_id: P(5), title: 'Open current account', status: 'Done', priority: 'High', due_date: d(-84), completed_at: ts(-84, 13) }),
    t(24, -7, { project_id: P(1), milestone_id: M(1), title: 'Prepare partner #4 workspace', status: 'Inbox', priority: 'Normal', due_date: d(7) }),
  ];

  const S = n => fid('s', n);
  const sub = (n, task, title, done, order) => base(-5, { id: S(n), task_id: T(task), title, is_completed: done, sort_order: order });
  const subtasks = [
    sub(1, 1, 'Reproduce with two clients', true, 0), sub(2, 1, 'Add last-write-wins test', false, 1), sub(3, 1, 'Ship patch build', false, 2),
    sub(4, 9, 'April–June', true, 0), sub(5, 9, 'July–September', false, 1),
    sub(6, 10, 'Collect ESOP grant letters', false, 0), sub(7, 10, 'Confirm founder share counts', false, 1),
  ];

  const E = n => fid('e', n);
  const ev = (n, x) => base(-3, { id: E(n), project_id: null, task_id: null, milestone_id: null, contact_id: null, description: null, location: null, is_all_day: false, ...x });
  const calendar_events = [
    ev(1, { title: 'Partner #3 onboarding call', project_id: P(1), task_id: T(2), starts_at: ts(0, 16, 0), ends_at: ts(0, 16, 45), location: 'Video call' }),
    ev(2, { title: 'Weekly planning', starts_at: ts(1, 9, 30), ends_at: ts(1, 10, 0) }),
    ev(3, { title: 'CA review: cap table', project_id: P(2), task_id: T(10), starts_at: ts(3, 11, 0), ends_at: ts(3, 12, 0), location: 'CA office, Indiranagar' }),
    ev(4, { title: 'Design partner check-in', project_id: P(1), starts_at: ts(4, 15, 0), ends_at: ts(4, 15, 30) }),
    ev(5, { title: 'Studio offsite', starts_at: ts(9, 0, 0), ends_at: ts(9, 23, 59), is_all_day: true }),
    ev(6, { title: 'Investor coffee: Northline (fictional)', project_id: P(2), contact_id: fid('c', 3), starts_at: ts(-2, 11, 0), ends_at: ts(-2, 12, 0), location: 'Koramangala' }),
    ev(7, { title: 'Weekly planning', starts_at: ts(-6, 9, 30), ends_at: ts(-6, 10, 0) }),
    ev(8, { title: 'Wordmark review with Kavya', project_id: P(3), contact_id: fid('c', 6), starts_at: ts(16, 14, 0), ends_at: ts(16, 15, 0) }),
    ev(9, { title: 'Monthly founder update', starts_at: ts(5, 17, 0), ends_at: ts(5, 17, 30) }),
  ];

  const C = n => fid('c', n);
  const contacts = [
    base(-40, { id: C(1), first_name: 'Ishaan', last_name: 'Kapoor', organization: 'Fictional Advisors LLP', role: 'Advisor', email: 'ishaan@advisor.example', phone: null, category: 'Advisor', notes: null }),
    base(-35, { id: C(2), first_name: 'Meera', last_name: 'Iyer', organization: 'Partner Co. (fictional)', role: 'Head of Ops', email: 'meera@partner.example', phone: null, category: 'Client', notes: null }),
    base(-20, { id: C(3), first_name: 'Dev', last_name: 'Malhotra', organization: 'Northline Ventures (fictional)', role: 'Partner', email: 'dev@vc.example', phone: null, category: 'Investor', notes: null }),
    base(-60, { id: C(4), first_name: 'Priya', last_name: 'Nair', organization: 'Nair & Co. Chartered Accountants (fictional)', role: 'CA', email: 'priya@ca.example', phone: '+91 00000 00004', category: 'Vendor', notes: 'Handles statutory filings and the cap table.' }),
    base(-25, { id: C(5), first_name: 'Arjun', last_name: 'Sethi', organization: 'Loom & Ledger (fictional)', role: 'Product lead', email: 'arjun@partner.example', phone: null, category: 'Partner', notes: 'Design partner #3.' }),
    base(-15, { id: C(6), first_name: 'Kavya', last_name: null, organization: null, role: 'Type designer', email: 'kavya@type.example', phone: null, category: 'Collaborator', notes: null }),
  ];
  const project_contacts = [
    { business_id: B, project_id: P(2), contact_id: C(3), relationship_role: 'Prospective investor', created_at: ts(-20, 10) },
    { business_id: B, project_id: P(2), contact_id: C(1), relationship_role: 'Advisor', created_at: ts(-30, 10) },
    { business_id: B, project_id: P(2), contact_id: C(4), relationship_role: 'Cap table', created_at: ts(-30, 11) },
    { business_id: B, project_id: P(1), contact_id: C(2), relationship_role: 'Design partner', created_at: ts(-35, 10) },
    { business_id: B, project_id: P(1), contact_id: C(5), relationship_role: 'Design partner', created_at: ts(-25, 10) },
    { business_id: B, project_id: P(3), contact_id: C(6), relationship_role: 'Type designer', created_at: ts(-15, 10) },
  ];

  // decisions: D(1) was superseded by D(2); D(3) is open with options; D(4) is due for review; D(5) was rejected
  const D = n => fid('r', n), O = n => fid('r', 100 + n);
  const dec = (n, created, x) => base(created, { id: D(n), project_id: null, contact_id: null, context: '', problem: '', rationale: '', review_date: null, selected_option_id: null, superseded_by_id: null, ...x });
  // decision_options has created_at but no updated_at (Gate 1 schema)
  const opt = (n, decision, title, pros, cons, order) => ({ business_id: B, created_at: ts(-40, 9), id: O(n), decision_id: D(decision), title, description: null, pros, cons, sort_order: order });
  const decision_options = [
    opt(1, 1, 'Single VPS (fictional Provider A)', 'Cheapest; full control', 'We run upgrades and backups ourselves', 0),
    opt(2, 1, 'Managed platform', 'No server upkeep', 'Higher monthly cost', 1),
    opt(3, 2, 'Managed platform with database backups', 'Backups and restores are handled', 'Higher monthly cost', 0),
    opt(4, 2, 'Stay on the VPS', 'No migration work', 'Backups remain manual', 1),
    opt(5, 3, 'Raise a pre-seed now', 'Runway for the beta', 'Lower valuation', 0),
    opt(6, 3, 'Wait for beta traction', 'Better terms', 'Runway gets tight', 1),
    opt(7, 4, 'Annual plans only', 'Simpler billing', 'Higher upfront ask', 0),
    opt(8, 4, 'Monthly and annual plans', 'Lower barrier', 'More billing work', 1),
  ];
  const decisions = [
    dec(1, -90, { title: 'Hosting for the beta', project_id: P(1), context: 'We need somewhere to run the private beta.', problem: 'Choose a host for the first five design partners.', rationale: 'Cheapest option while usage is tiny.', status: 'Superseded', decision_date: d(-90), selected_option_id: O(1), superseded_by_id: D(2) }),
    dec(2, -12, { title: 'Hosting for the beta: move to a managed platform', project_id: P(1), context: 'Manual backups on the VPS were missed twice.', problem: 'Decide whether to keep running our own server.', rationale: 'Backups and restores matter more than the extra monthly cost.', status: 'Approved', decision_date: d(-12), selected_option_id: O(3) }),
    dec(3, -6, { title: 'Timing of the first raise', project_id: P(2), contact_id: C(1), context: 'Runway is about nine months at current spend.', problem: 'Raise now, or wait for beta traction?', rationale: '', status: 'Proposed', decision_date: d(-6), review_date: d(10) }),
    dec(4, -60, { title: 'Pricing plans for launch', project_id: null, context: 'Partners asked about pricing.', problem: 'Which billing periods to offer at launch.', rationale: 'Annual plans keep billing simple while we are small.', status: 'Approved', decision_date: d(-60), review_date: d(-2), selected_option_id: O(7) }),
    dec(5, -30, { title: 'Build a mobile app for V1', project_id: P(1), context: 'One partner asked for a phone app.', problem: 'Is a native app in scope for V1?', rationale: 'Responsive web covers the need; a native app is out of V1 scope.', status: 'Rejected', decision_date: d(-30) }),
  ];

  // activity as record_activity() would have written it
  const A = n => fid('a', n);
  const act = (n, offset, h, table, op, entity, label, status) => ({
    id: A(n), business_id: B, actor_type: 'user', actor_id: DEV_PROFILE_ID, event_type: `${table}.${op}`, entity_table: table, entity_id: entity,
    summary: `${table[0].toUpperCase()}${table.slice(1)} ${op}: ${label}`, metadata: status ? { status } : {}, created_at: ts(offset, h),
  });
  const activity_records = [
    act(1, -6, 16, 'tasks', 'update', T(7), 'Accessibility pass on the sidebar', 'Done'),
    act(2, -3, 11, 'milestones', 'update', M(2), 'Beta feature freeze', 'Delayed'),
    act(3, -2, 10, 'tasks', 'insert', T(19), 'Book quarterly review with the CA', 'Inbox'),
    act(4, -1, 12, 'tasks', 'insert', T(21), 'Reply to the co-working space about desk renewal', 'Next'),
    act(5, -1, 18, 'tasks', 'update', T(9), 'Upload last 6 months of statements to the data room', 'In Progress'),
    act(6, 0, 9, 'projects', 'update', P(3), 'Brand identity refresh', 'Planning'),
  ];

  const finance = buildFinanceFixtures({ B, d, ts, fid, founder: participants[0].id, cofounder: participants[1].id, project: P(2) });

  return { businesses, profiles, participants, projects, milestones, tasks, subtasks, calendar_events, contacts, project_contacts, contact_interactions: [], decisions, decision_options, activity_records, ...finance };
}
