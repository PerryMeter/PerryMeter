import type { Units } from './settings';

const CM_PER_IN = 2.54;

/** A distance in metres, in the chosen units: "1.4 m" or "4.6 ft". */
export function formatMetres(m: number | null, units: Units, digits = 1): string {
  if (m === null || !Number.isFinite(m)) return '--';
  if (units === 'imperial') return `${(m / 0.3048).toFixed(digits)} ft`;
  return `${m.toFixed(digits)} m`;
}

/** A distance in centimetres, in the chosen units: "176 cm" or "69 in". */
export function formatCm(cm: number | null, units: Units): string {
  if (cm === null || !Number.isFinite(cm)) return '--';
  if (units === 'imperial') return `${Math.round(cm / CM_PER_IN)} in`;
  return `${Math.round(cm)} cm`;
}

/** The short unit label for a distance axis or slider. */
export function distanceUnitLabel(units: Units, small = false): string {
  if (units === 'imperial') return small ? 'in' : 'ft';
  return small ? 'cm' : 'm';
}

/** Centimetres to the small display unit (cm or in) and back, for sliders. */
export function cmToSmall(cm: number, units: Units): number {
  return units === 'imperial' ? Math.round(cm / CM_PER_IN) : Math.round(cm);
}

export function smallToCm(value: number, units: Units): number {
  return units === 'imperial' ? Math.round(value * CM_PER_IN) : Math.round(value);
}
