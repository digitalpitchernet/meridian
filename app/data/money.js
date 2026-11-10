// numeric(15,2) money, handled as exact integer cents (never binary floating point).
// Values cross the data boundary as numeric text ("1200.50"), as PostgREST returns numeric columns.
import { DataError } from './errors.js';

const MAX = 1e15; // numeric(15,2): |value| < 10^13 units = 10^15 cents

// Parse numeric text or a number into integer cents, rounding half away from zero like Postgres numeric.
export function toCents(v, column) {
  const s = String(v).trim();
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && !m[3])) throw new DataError('22P02', `invalid input syntax for type numeric: "${v}"`, { column });
  const frac = (m[3] || '').padEnd(3, '0');
  let c = Number(m[2] || '0') * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) c += 1;
  if (c >= MAX) throw new DataError('22003', 'numeric field overflow', { column });
  return m[1] === '-' ? -c : c;
}

export function fromCents(c) {
  const a = Math.abs(c);
  return `${c < 0 ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

export const money = v => fromCents(toCents(v));
export const sumCents = (list, f = x => x) => list.reduce((s, x) => s + toCents(f(x)), 0);
