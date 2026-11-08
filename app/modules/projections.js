// Pure projections over module data. The Command Centre is a projection of canonical module rows and stores
// nothing of its own (product brief); these functions are that projection, unit-tested in tests/app.
import { addDays, daysBetween, todayIn } from '../core/format.js';

const PRIORITY_RANK = { Critical: 0, High: 1, Normal: 2, Low: 3 };
export const isOpen = t => t.status !== 'Done';
export const byPriority = (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

export function dueState(dateStr, today) {
  if (!dateStr) return null;
  const n = daysBetween(today, dateStr);
  return n < 0 ? 'overdue' : n === 0 ? 'today' : n <= 7 ? 'soon' : 'later';
}

export function projectProgress(tasks) {
  const total = tasks.length, done = tasks.filter(t => t.status === 'Done').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// Milestones still open after their due date are late even if nobody marked them Delayed.
export const milestoneOpen = m => m.status === 'Upcoming' || m.status === 'In Progress' || m.status === 'Delayed';
export const milestoneLate = (m, today) => m.status === 'Delayed' || (milestoneOpen(m) && m.due_date < today);

export function kpis({ tasks, projects, milestones }, today) {
  const open = tasks.filter(isOpen);
  return {
    openTasks: open.length,
    dueToday: open.filter(t => t.due_date === today).length,
    overdue: open.filter(t => t.due_date && t.due_date < today).length,
    activeProjects: projects.filter(p => p.status === 'Active').length,
    milestonesNext14: milestones.filter(m => milestoneOpen(m) && m.due_date >= today && m.due_date <= addDays(today, 14)).length,
    lateMilestones: milestones.filter(m => milestoneLate(m, today)).length,
  };
}

// What needs the founder now, most urgent first. kind: overdue | milestone | today | critical
export function attention({ tasks, milestones, projects }, today, limit = 8) {
  const pname = id => projects.find(p => p.id === id)?.name ?? null;
  const items = [];
  for (const t of tasks.filter(isOpen)) {
    if (t.due_date && t.due_date < today) items.push({ kind: 'overdue', rank: 0, date: t.due_date, task: t, project: pname(t.project_id), days: daysBetween(t.due_date, today) });
    else if (t.due_date === today) items.push({ kind: 'today', rank: 2, date: t.due_date, task: t, project: pname(t.project_id) });
    else if (t.priority === 'Critical' && !t.due_date) items.push({ kind: 'critical', rank: 3, date: null, task: t, project: pname(t.project_id) });
  }
  for (const m of milestones.filter(m => milestoneLate(m, today))) {
    items.push({ kind: 'milestone', rank: 1, date: m.due_date, milestone: m, project: pname(m.project_id), days: Math.max(0, daysBetween(m.due_date, today)) });
  }
  items.sort((a, b) => a.rank - b.rank || (a.task && b.task ? byPriority(a.task, b.task) : 0) || String(a.date).localeCompare(String(b.date)));
  return { items: items.slice(0, limit), total: items.length };
}

export function activeProjects({ projects, tasks, milestones }, today) {
  return projects.filter(p => p.status === 'Active')
    .map(p => {
      const ptasks = tasks.filter(t => t.project_id === p.id);
      const next = milestones.filter(m => m.project_id === p.id && milestoneOpen(m)).sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null;
      return { project: p, progress: projectProgress(ptasks), openTasks: ptasks.filter(isOpen).length,
        overdue: ptasks.filter(t => isOpen(t) && t.due_date && t.due_date < today).length, next, nextLate: next ? milestoneLate(next, today) : false };
    })
    .sort((a, b) => byPriority(a.project, b.project) || String(a.project.target_date).localeCompare(String(b.project.target_date)));
}

// Next N days, grouped by business-local date: calendar events, open task due dates, open milestone due dates.
export function schedule({ events, tasks, milestones, projects }, today, timeZone, days = 14) {
  const end = addDays(today, days - 1);
  const pname = id => projects.find(p => p.id === id)?.name ?? null;
  const out = new Map();
  const put = (date, item) => { if (date < today || date > end) return; if (!out.has(date)) out.set(date, []); out.get(date).push(item); };
  for (const e of events) {
    // all-day and multi-day events appear on each local day they cover
    let d = todayIn(timeZone, new Date(e.starts_at)); const last = todayIn(timeZone, new Date(e.ends_at));
    for (let i = 0; d <= last && i < 31; i++, d = addDays(d, 1)) put(d, { kind: 'event', sort: e.is_all_day ? '00:00' : e.starts_at, event: e, project: pname(e.project_id) });
  }
  for (const t of tasks.filter(t => isOpen(t) && t.due_date)) put(t.due_date, { kind: 'task', sort: '99', task: t, project: pname(t.project_id) });
  for (const m of milestones.filter(milestoneOpen)) put(m.due_date, { kind: 'milestone', sort: '98', milestone: m, project: pname(m.project_id) });
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, items: items.sort((a, b) => String(a.sort).localeCompare(String(b.sort))) }));
}

// Human phrasing for activity_records written by record_activity(): '<table>.<op>' plus metadata.status
export function describeActivity(a) {
  const [table, op] = a.event_type.split('.');
  const noun = { projects: 'project', tasks: 'task', milestones: 'milestone', decisions: 'decision' }[table] || table;
  const label = a.summary.includes(': ') ? a.summary.slice(a.summary.indexOf(': ') + 2) : '';
  const verb = op === 'insert' ? 'Created' : op === 'delete' ? 'Deleted' : a.metadata?.status === 'Done' && table === 'tasks' ? 'Completed' : 'Updated';
  return { verb, noun, label, status: op === 'update' && a.metadata?.status && !(table === 'tasks' && a.metadata.status === 'Done') ? a.metadata.status : null };
}

// ---------- M2: milestones and calendar ----------
export function milestoneProgress(milestoneId, tasks) { return projectProgress(tasks.filter(t => t.milestone_id === milestoneId)); }

// achieved | cancelled | late | due-soon (≤ 7 days) | upcoming
export function milestoneState(m, today) {
  if (m.status === 'Achieved') return 'achieved';
  if (m.status === 'Cancelled') return 'cancelled';
  if (milestoneLate(m, today)) return 'late';
  return daysBetween(today, m.due_date) <= 7 ? 'due-soon' : 'upcoming';
}

// Calendar entries for [from, to] (inclusive dates), keyed by business-local date.
// state: done | overdue | today | upcoming | muted ; tasks and milestones appear on their due date.
export function calendarEntries({ events, tasks, milestones, projects }, from, to, timeZone, today) {
  const map = new Map();
  const put = (date, e) => { if (date < from || date > to) return; if (!map.has(date)) map.set(date, []); map.get(date).push(e); };
  const pname = id => projects.find(p => p.id === id)?.name ?? null;
  const dated = (date, done) => (done ? 'done' : date < today ? 'overdue' : date === today ? 'today' : 'upcoming');
  for (const e of events) {
    let d = todayIn(timeZone, new Date(e.starts_at)); const last = todayIn(timeZone, new Date(e.ends_at));
    for (let i = 0; d <= last && i < 62; i++, d = addDays(d, 1)) put(d, { kind: 'event', id: e.id, title: e.title, sort: e.is_all_day ? '0' : `1${e.starts_at}`, allDay: e.is_all_day, event: e, project: pname(e.project_id), state: e.ends_at < new Date().toISOString() ? 'done' : 'upcoming' });
  }
  for (const t of tasks) if (t.due_date) put(t.due_date, { kind: 'task', id: t.id, title: t.title, sort: '3', task: t, project: pname(t.project_id), state: dated(t.due_date, t.status === 'Done') });
  for (const m of milestones) put(m.due_date, { kind: 'milestone', id: m.id, title: m.title, sort: '2', milestone: m, project: pname(m.project_id),
    state: m.status === 'Cancelled' ? 'muted' : m.status === 'Achieved' ? 'done' : milestoneLate(m, today) ? 'overdue' : dated(m.due_date, false) });
  for (const list of map.values()) list.sort((a, b) => String(a.sort).localeCompare(String(b.sort)) || a.title.localeCompare(b.title));
  return map;
}

// ---------- M2: contacts ----------
export const contactName = c => [c.first_name, c.last_name].filter(Boolean).join(' ');
// search across name, organisation, role and email; all words must match (case-insensitive)
export function contactMatches(c, q) {
  const hay = [c.first_name, c.last_name, c.organization, c.role, c.email].filter(Boolean).join(' ').toLowerCase();
  return String(q).toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

// ---------- M2: decisions ----------
// App rules preserving decision history (the Gate 1 schema allows edits; enforcement in the database is a Gate 2 item):
// only Proposed decisions are edited or deleted; decided ones change course by being superseded.
export const decisionEditable = d => d.status === 'Proposed';
export const canSupersede = d => d.status === 'Approved' || d.status === 'Rejected';
// review_date: due (today or past, not superseded) | soon (≤ 7 days) | later | null
export function reviewState(d, today) {
  if (!d.review_date || d.status === 'Superseded') return null;
  const n = daysBetween(today, d.review_date);
  return n <= 0 ? 'due' : n <= 7 ? 'soon' : 'later';
}
export function decisionMatches(d, q) {
  const hay = [d.title, d.context, d.problem, d.rationale].filter(Boolean).join(' ').toLowerCase();
  return String(q).toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}
