// Colours for the canvas and the chart, read from the CSS variables in index.css so they follow the
// light/dark theme. Components re-read them when the theme changes (the `themeKey` prop).

export type Palette = {
  bg: string;
  surface: string;
  surface2: string;
  line: string;
  lineStrong: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  alert: string;
  warn: string;
};

const DARK: Palette = {
  bg: '#0f1214',
  surface: '#161a1d',
  surface2: '#1e2429',
  line: '#29323a',
  lineStrong: '#3d4954',
  text: '#e8ecef',
  muted: '#9aa5ac',
  faint: '#66727a',
  accent: '#9fb3bf',
  alert: '#e5484d',
  warn: '#d8a632',
};

const VARS: Record<keyof Palette, string> = {
  bg: '--c-bg',
  surface: '--c-surface',
  surface2: '--c-surface-2',
  line: '--c-line',
  lineStrong: '--c-line-strong',
  text: '--c-text',
  muted: '--c-muted',
  faint: '--c-faint',
  accent: '--c-accent',
  alert: '--c-alert',
  warn: '--c-warn',
};

/** The current palette from the document's CSS variables (the dark defaults when unavailable). */
export function readPalette(): Palette {
  if (typeof document === 'undefined') return DARK;
  const style = getComputedStyle(document.documentElement);
  const out = { ...DARK };
  for (const key of Object.keys(VARS) as (keyof Palette)[]) {
    const v = style.getPropertyValue(VARS[key]).trim();
    if (v) out[key] = v;
  }
  return out;
}

/** "#rrggbb" to "rgba(r, g, b, a)". */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}
