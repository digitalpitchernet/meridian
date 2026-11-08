// Launcher matching: prefix beats word-start beats substring; -1 = no match. Pure, tested in Node.
export function score(text, q) {
  const t = String(text).toLowerCase(), s = String(q).trim().toLowerCase();
  if (!s) return 0;
  if (t.startsWith(s)) return 3;
  if (t.split(/[\s\-_/·]+/).some(w => w.startsWith(s))) return 2;
  return t.includes(s) ? 1 : -1;
}
