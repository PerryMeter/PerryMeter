// Confidence in the current verdict (CLEAR, APPROACH or ALERT), computed on the dashboard from the
// hub's raw numbers (msg.debug). The hub's own `confidence` field is cruder (0.5 + 0.5 x how far the
// radar movement energy is past its threshold), so it is only the fallback when there is no debug
// block. This is a heuristic for the operator, not a validated probability.

import type { AlertLevel } from './contract';
import type { HubDebug } from './hubDebug';

export type ConfidenceResult = {
  /** 0 to 1, or null when there is no fresh data. */
  value: number | null;
  /** Short factual lines saying what the value rests on, most important first. */
  basis: string[];
  /** Where the number comes from. */
  source: 'dashboard' | 'hub' | 'none';
};

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

const NONE: ConfidenceResult = { value: null, basis: [], source: 'none' };

export function computeConfidence(
  debug: HubDebug | null,
  alert: AlertLevel | null,
  hubConfidence: number | null,
  isFresh: boolean,
): ConfidenceResult {
  if (!isFresh || alert === null) return NONE;

  const radar = debug?.radar ?? null;
  const links = debug?.links.filter((l) => l.online) ?? [];
  if (!debug || (radar === null && links.length === 0)) {
    if (hubConfidence === null) return NONE;
    return {
      value: round2(clamp01(hubConfidence)),
      basis: ['Hub estimate: radar movement energy against its threshold'],
      source: 'hub',
    };
  }

  // Radar: how far the 1 s averaged energy is over its threshold (1.0 = at the threshold)
  let radarRatio: number | null = null;
  let radarLine: string | null = null;
  if (radar) {
    const mv = radar.avgMoving !== null && radar.movingThreshold ? radar.avgMoving / radar.movingThreshold : 0;
    const st = radar.avgStill !== null && radar.stillThreshold ? radar.avgStill / radar.stillThreshold : 0;
    radarRatio = Math.max(mv, st);
    if (mv >= st) {
      radarLine = `Radar movement ${Math.round(radar.avgMoving ?? 0)} of threshold ${radar.movingThreshold ?? '--'}`;
    } else {
      radarLine = `Radar stillness ${Math.round(radar.avgStill ?? 0)} of threshold ${radar.stillThreshold ?? '--'}`;
    }
  }

  // Wi-Fi sides: the highest side level (0 quiet, 1.0 at the threshold)
  let sideTop = 0;
  let sideId: string | null = null;
  for (const l of links) {
    const level = l.evidence ?? (l.score !== null && l.threshold ? l.score / l.threshold : 0);
    if (level > sideTop) {
      sideTop = level;
      sideId = l.id;
    }
  }
  const sideLine = sideId ? `${sideId[0].toUpperCase()}${sideId.slice(1)} side level ${sideTop.toFixed(2)} (1.0 = crossing)` : null;

  const zone = debug.zone;
  const basis: string[] = [];
  let value: number;

  if (alert === 'inside') {
    // Mostly the radar: strong energy and a module that agrees
    const over = radarRatio === null ? 0 : clamp01(radarRatio - 1);
    const moduleAgrees = radar !== null && !radar.moduleNobody && radar.stateName !== 'nobody';
    value = 0.45 + 0.35 * over + (moduleAgrees ? 0.2 : 0);
    if (radar?.held) value -= 0.15;
    if (radarRatio !== null && radarRatio < 1) value -= 0.15;
    if (radarLine) basis.push(radarLine);
    if (radar) {
      if (radar.held) basis.push('Reading kept from the previous second (module dropout or distance jump)');
      else if (radar.moduleNobody) basis.push('LD2410C itself reports nobody');
      else basis.push(`LD2410C reports ${radar.stateName ?? 'unknown'}`);
    }
    if (zone?.entrySide) basis.push(`Entry through the ${zone.entrySide === 'base' ? 'front' : zone.entrySide} side`);
    if (sideLine && sideTop >= 0.5) basis.push(sideLine);
    value = Math.max(0.2, Math.min(1, value));
  } else if (alert === 'approach') {
    // A side is active (over its threshold for 0.5 s), or the radar sees someone it does not track
    const radarPresent = radarRatio !== null && radarRatio >= 1;
    if (sideTop >= 0.8) {
      value = 0.45 + 0.45 * clamp01((sideTop - 0.8) / 0.8);
      if (sideLine) basis.push(sideLine);
    } else {
      value = 0.4;
      if (sideLine) basis.push(sideLine);
    }
    if (radarPresent) {
      value += 0.1;
      if (radarLine) basis.push(radarLine);
      if (zone?.state === 'left_zone') basis.push('Radar sees someone, but they crossed out through a side: not tracked');
    }
    value = Math.max(0.2, Math.min(1, value));
  } else {
    // Clear: everything well under its threshold
    value = 1 - 0.5 * clamp01(radarRatio ?? 0) - 0.3 * clamp01(sideTop);
    if (zone?.state === 'left_zone' && radarRatio !== null && radarRatio >= 1) {
      value = Math.min(value, 0.55);
      basis.push('Radar sees someone, but they crossed out through a side: not tracked');
    }
    if (radarLine) basis.push(radarLine);
    if (sideLine) basis.push(sideLine);
    if (!radar) basis.push('No radar data');
    value = Math.max(0.15, Math.min(1, value));
  }

  return { value: round2(value), basis: basis.slice(0, 3), source: 'dashboard' };
}
