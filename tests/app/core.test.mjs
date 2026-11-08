// node --test tests/app
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, parseHash, matchRoute, href } from '../../app/core/router.js';
import { todayIn, addDays, daysBetween, formatDate, formatShortDate, relativeDay, formatMoney, formatTime, timeAgo } from '../../app/core/format.js';
import { createBus } from '../../app/core/events.js';

test('router: parseHash normalises paths and queries', () => {
  assert.deepEqual(parseHash(''), { path: '/', query: {} });
  assert.deepEqual(parseHash('#/'), { path: '/', query: {} });
  assert.deepEqual(parseHash('#/projects/'), { path: '/projects', query: {} });
  assert.deepEqual(parseHash('#projects?status=Active&x=1'), { path: '/projects', query: { status: 'Active', x: '1' } });
  assert.deepEqual(parseHash('#//tasks//'), { path: '/tasks', query: {} });
});

test('router: matchRoute picks the first match and decodes params', () => {
  const routes = ['/command', '/projects', '/projects/:id', '/tasks/:id'].map(p => ({ ...compile(p), route: p }));
  assert.equal(matchRoute(routes, '/command').route, '/command');
  assert.deepEqual(matchRoute(routes, '/projects/a%20b'), { route: '/projects/:id', params: { id: 'a b' } });
  assert.equal(matchRoute(routes, '/projects/1/extra'), null);
  assert.equal(matchRoute(routes, '/nope'), null);
  assert.equal(href('/tasks', { view: 'Next' }), '#/tasks?view=Next');
  assert.equal(href('/tasks'), '#/tasks');
});

test('format: business-local today and date arithmetic', () => {
  // 20:00 UTC on 31 Dec is already 1 Jan in Asia/Kolkata (+05:30)
  assert.equal(todayIn('Asia/Kolkata', new Date('2026-12-31T20:00:00Z')), '2027-01-01');
  assert.equal(todayIn('UTC', new Date('2026-12-31T20:00:00Z')), '2026-12-31');
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(daysBetween('2026-11-08', '2026-11-15'), 7);
  assert.equal(daysBetween('2026-11-08', '2026-11-01'), -7);
});

test('format: profile date formats and relative days', () => {
  assert.equal(formatDate('2026-11-08', 'DD/MM/YYYY'), '08/11/2026');
  assert.equal(formatDate('2026-11-08', 'MM/DD/YYYY'), '11/08/2026');
  assert.equal(formatDate('2026-11-08', 'YYYY-MM-DD'), '2026-11-08');
  assert.equal(formatShortDate('2026-11-08', '2026-11-01'), '8 Nov');
  assert.equal(formatShortDate('2027-01-03', '2026-11-01'), '3 Jan 2027');
  assert.equal(formatShortDate('2026-11-08', '2026-11-01', 'MM/DD/YYYY'), 'Nov 8');
  const t = '2026-11-08';
  assert.equal(relativeDay('2026-11-08', t), 'Today');
  assert.equal(relativeDay('2026-11-09', t), 'Tomorrow');
  assert.equal(relativeDay('2026-11-07', t), 'Yesterday');
  assert.equal(relativeDay('2026-11-11', t), 'in 3 days');
  assert.equal(relativeDay('2026-11-04', t), '4 days ago');
  assert.equal(relativeDay('2026-12-25', t), '');
});

test('format: money shows numeric(15,2) text with the business currency and the profile number format', () => {
  assert.equal(formatMoney('150000.00', 'INR', 'en-IN'), '₹1,50,000.00');
  assert.equal(formatMoney('1500.5', 'GBP', 'en-GB'), '£1,500.50');
  assert.equal(formatMoney(null, 'INR'), '');
  assert.equal(formatTime('2026-11-08T10:30:00Z', 'Asia/Kolkata', '24h'), '16:00');
  assert.equal(timeAgo('2026-11-08T10:00:00Z', new Date('2026-11-08T10:00:20Z')), 'just now');
  assert.equal(timeAgo('2026-11-08T07:00:00Z', new Date('2026-11-08T10:00:00Z')), '3 h ago');
});

test('events: handlers receive events; one failing handler does not stop the others', () => {
  const bus = createBus(); const got = [];
  const off = bus.on('x', d => got.push(d));
  bus.on('x', () => { throw new Error('boom'); });
  bus.on('*', e => got.push(e.type));
  const err = console.error; console.error = () => {};
  bus.emit('x', 1); off(); bus.emit('x', 2);
  console.error = err;
  assert.deepEqual(got, [1, 'x', 'x']);
});

import { score } from '../../app/core/search.js';
test('launcher search: prefix > word start > substring > no match', () => {
  assert.equal(score('Seed round preparation', 'seed'), 3);
  assert.equal(score('Seed round preparation', 'round'), 2);
  assert.equal(score('Seed round preparation', 'para'), 1);
  assert.equal(score('Seed round preparation', 'xyz'), -1);
  assert.equal(score('Partner #3 onboarding', '  ONBOARD '), 2);
  assert.equal(score('anything', ''), 0);
});

import { accentSolid, contrast } from '../../app/core/color.js';
test('accent: filled buttons always reach WCAG AA text contrast, whatever accent the founder picks', () => {
  for (const a of ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#FFFFFF', '#000000', '#FDE047', '#0EA5E9']) {
    const { solid, text } = accentSolid(a);
    assert.ok(contrast(solid, text) >= 4.5, `${a} -> ${solid}/${text} = ${contrast(solid, text).toFixed(2)}`);
  }
  assert.equal(accentSolid('#1E3A8A').solid.toLowerCase(), '#1e3a8a'); // already dark enough: unchanged
});
