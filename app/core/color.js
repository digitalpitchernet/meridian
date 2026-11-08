// Colour helpers for the founder-configurable accent (businesses.accent_color). Pure; tested in Node.
const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
export const luminance = h => { const [r, g, b] = rgb(h).map(v => lin(v / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// A filled-button colour derived from the accent with text that meets WCAG AA (4.5:1).
// Light accents keep their colour and get dark text; others are darkened only as far as white text needs.
export function accentSolid(accent, { dark = '#0d0e11', light = '#ffffff', min = 4.5 } = {}) {
  if (contrast(accent, dark) >= min && contrast(accent, light) < min && luminance(accent) > 0.35) return { solid: accent, text: dark };
  let c = rgb(accent);
  for (let i = 0; i < 40 && contrast(hex(c), light) < min; i++) c = c.map(v => v * 0.95);
  return { solid: hex(c), text: light };
}
