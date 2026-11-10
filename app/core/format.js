// Formatting driven by the business and profile rows (businesses.locale / timezone / base_currency,
// profiles.date_format / time_format / number_format). Pure functions; tested in Node.
// Dates in the schema are 'YYYY-MM-DD' strings (SQL date) or ISO timestamps (timestamptz).

const pad = n => String(n).padStart(2, '0');

// 'YYYY-MM-DD' for "today" in a given IANA time zone (business-local today, as the RPCs use)
export function todayIn(timeZone, now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = t => p.find(x => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// whole days from a to b (both 'YYYY-MM-DD')
export function daysBetween(a, b) {
  const t = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

// profiles.date_format: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY'
export function formatDate(isoDate, dateFormat = 'DD/MM/YYYY') {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  if (dateFormat === 'YYYY-MM-DD') return `${y}-${m}-${d}`;
  if (dateFormat === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
  return `${d}/${m}/${y}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// compact '12 Nov' (or 'Nov 12' for MM/DD); adds the year when it differs from today's
export function formatShortDate(isoDate, today, dateFormat = 'DD/MM/YYYY') {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  const day = String(Number(d)), mon = MONTHS[Number(m) - 1];
  const core = dateFormat === 'MM/DD/YYYY' ? `${mon} ${day}` : `${day} ${mon}`;
  return today && today.slice(0, 4) !== y ? `${core} ${y}` : core;
}

// 'Today', 'Tomorrow', 'Yesterday', 'in 3 days', '2 days overdue' relative to business-local today
export function relativeDay(isoDate, today) {
  if (!isoDate) return '';
  const n = daysBetween(today, isoDate.slice(0, 10));
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n <= 6) return `in ${n} days`;
  if (n < -1) return `${-n} days ago`;
  return '';
}

// timestamptz in the business time zone; profiles.time_format '24h' | '12h'
export function formatTime(iso, timeZone, timeFormat = '24h') {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' }).format(new Date(iso));
}

export function formatDateTime(iso, timeZone, dateFormat, timeFormat) {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return `${formatDate(local, dateFormat)} ${formatTime(iso, timeZone, timeFormat)}`;
}

// 'x minutes ago' for activity timestamps
export function timeAgo(iso, now = new Date()) {
  const s = Math.max(0, Math.round((now - new Date(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d} d ago`;
  return `${Math.round(d / 30)} mo ago`;
}

// Money: amounts arrive as numeric(15,2) text and are shown, never computed, here.
// profiles.number_format is a locale such as 'en-IN' (lakh grouping) or 'en-GB'.
export function formatMoney(amount, currency, numberFormat = 'en-IN') {
  if (amount === null || amount === undefined || amount === '') return '';
  return new Intl.NumberFormat(numberFormat, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount));
}

export function formatCount(n, numberFormat = 'en-IN') {
  return new Intl.NumberFormat(numberFormat).format(n);
}

export function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

// Wall-clock 'YYYY-MM-DD' + 'HH:MM' in an IANA zone -> ISO instant (two-pass offset; correct across DST changes)
export function zonedToUtc(date, time, timeZone) {
  const [y, mo, d] = date.split('-').map(Number), [hh, mm] = (time || '00:00').split(':').map(Number);
  const want = Date.UTC(y, mo - 1, d, hh, mm);
  const offsetAt = t => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
  };
  let t = want - offsetAt(want);
  t = want - offsetAt(t);
  return new Date(t).toISOString();
}
// ISO instant -> { date: 'YYYY-MM-DD', time: 'HH:MM' } wall clock in the zone
export function utcToZoned(iso, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const WEEK_START = { Monday: 1, Sunday: 0, Saturday: 6 };
// weekday 0=Sunday for a 'YYYY-MM-DD'
export const weekday = date => new Date(`${date}T12:00:00Z`).getUTCDay();
// first day of the week containing date, per profiles.week_start_day
export function startOfWeek(date, weekStartDay = 'Monday') {
  const back = (weekday(date) - WEEK_START[weekStartDay] + 7) % 7;
  return addDays(date, -back);
}
// month grid: weeks (arrays of 7 dates) from the week containing the 1st through the week containing the last day
export function monthGrid(date, weekStartDay = 'Monday') {
  const first = `${date.slice(0, 7)}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const weeks = [];
  for (let d = startOfWeek(first, weekStartDay); d <= last; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return weeks;
}
export const monthLabel = (date, locale = 'en-IN') => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date.slice(0, 7)}-15T12:00:00Z`));
export const addMonths = (date, n) => { const [y, m] = date.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`; };
