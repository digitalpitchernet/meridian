// Status and priority vocabulary, exactly the canonical values in the schema (data/schema.js ENUMS).
import { h } from '../core/dom.js';
import { icon } from './icons.js';
import { ENUMS } from '../data/schema.js';

export const TASK_STATUS = {
  Inbox: { icon: 'circleDashed', tone: 'idle' },
  Next: { icon: 'circle', tone: 'info' },
  'In Progress': { icon: 'circleHalf', tone: 'accent' },
  Waiting: { icon: 'pause', tone: 'warn' },
  Done: { icon: 'circleCheck', tone: 'ok' },
};
export const PROJECT_STATUS = {
  Planning: { icon: 'circleDashed', tone: 'idle' },
  Active: { icon: 'circleHalf', tone: 'accent' },
  'On Hold': { icon: 'pause', tone: 'warn' },
  Completed: { icon: 'circleCheck', tone: 'ok' },
  Archived: { icon: 'archive', tone: 'idle' },
};
export const MILESTONE_STATUS = {
  Upcoming: { icon: 'circle', tone: 'idle' },
  'In Progress': { icon: 'circleHalf', tone: 'info' },
  Achieved: { icon: 'circleCheck', tone: 'ok' },
  Delayed: { icon: 'alert', tone: 'bad' },
  Cancelled: { icon: 'x', tone: 'idle' },
};
export const PRIORITY = {
  Low: { icon: 'bars1', tone: 'faint' },
  Normal: { icon: 'bars2', tone: 'idle' },
  High: { icon: 'bars3', tone: 'warn' },
  Critical: { icon: 'priorityCritical', tone: 'bad' },
};
// guard: the vocabularies above must match the schema enums exactly
for (const [map, values] of [[TASK_STATUS, ENUMS.taskStatus], [PROJECT_STATUS, ENUMS.projectStatus], [MILESTONE_STATUS, ENUMS.milestoneStatus], [PRIORITY, ENUMS.priority]]) {
  if (Object.keys(map).join() !== values.join()) console.error('[status] vocabulary out of sync with schema', values);
}

export function statusIcon(map, status, size = 15) {
  const s = map[status] || { icon: 'dot', tone: 'idle' };
  return h('span', { class: ['status-icon', `fg-${s.tone}`], title: status, aria: { label: status } }, icon(s.icon, { size, stroke: 1.8 }));
}
export function statusChip(map, status) {
  const s = map[status] || { icon: 'dot', tone: 'idle' };
  return h('span', { class: ['status-chip', `fg-${s.tone}`] }, icon(s.icon, { size: 13, stroke: 1.8 }), h('span', null, status));
}
export function priorityIcon(priority, size = 15) {
  const p = PRIORITY[priority] || PRIORITY.Normal;
  return h('span', { class: ['priority-icon', `fg-${p.tone}`], title: `${priority} priority`, aria: { label: `${priority} priority` } }, icon(p.icon, { size, stroke: 1.6 }));
}
