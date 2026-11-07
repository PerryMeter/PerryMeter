export const theme = {
  bg: '#070A0C',
  surface: '#0D1316',
  surface2: '#121A1E',
  line: '#1E2A2F',
  lineStrong: '#2B3B41',
  text: '#E7EEF0',
  muted: '#93A4AA',
  faint: '#5B6B71',
  accent: '#3DD6B0',
  motion: '#FF8A3D',
  warn: '#E8C14E',
  error: '#F05A5A',
} as const;

export type Theme = typeof theme;
export type ThemeColorToken = keyof typeof theme;
