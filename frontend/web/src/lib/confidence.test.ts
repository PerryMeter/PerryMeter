import { describe, expect, it } from 'vitest';
import { computeConfidence } from './confidence';
import type { HubDebug, HubLinkDebug, HubRadarDebug } from './hubDebug';

function link(id: string, evidence: number, motion = false): HubLinkDebug {
  return {
    id, mac: null, online: true, pps: 22, rssi: -66, score: 0.06, threshold: 0.12, baseline: 0.06, block: null,
    blockThreshold: null, calibrated: true, motion, evidence, followScale: 1, calibratedThreshold: 0.12,
  };
}

function radar(over: Partial<HubRadarDebug>): HubRadarDebug {
  return {
    fps: 10, stateName: 'nobody', movingCm: 130, movingEnergy: 0, stillCm: 130, stillEnergy: 2, detectCm: 130,
    avgMoving: 0, avgStill: 2, movingThreshold: 20, stillThreshold: 20, zoneCm: [0, 220], prediction: 'nothing',
    status: null, stillBeyondFront: false, moduleNobody: false, held: false, ...over,
  };
}

function debug(over: Partial<HubDebug>): HubDebug {
  return { source: 'esp1', uptimeS: 10, links: [], radar: null, esp1: null, calibration: null, zone: null, settings: null, ...over };
}

describe('computeConfidence', () => {
  it('is empty without fresh data', () => {
    expect(computeConfidence(debug({}), 'clear', 0.9, false)).toEqual({ value: null, basis: [], source: 'none' });
    expect(computeConfidence(debug({}), null, 0.9, true).value).toBeNull();
  });

  it('falls back to the hub number when there are no raw numbers', () => {
    const c = computeConfidence(null, 'clear', 0.73, true);
    expect(c.source).toBe('hub');
    expect(c.value).toBe(0.73);
    expect(c.basis[0]).toMatch(/Hub estimate/);
  });

  it('is high for a clear zone with quiet sensors and drops as they rise', () => {
    const quiet = computeConfidence(debug({ radar: radar({}), links: [link('left', 0.05), link('right', 0.1)] }), 'clear', 0.5, true);
    expect(quiet.value).toBeGreaterThan(0.9);
    const stirring = computeConfidence(debug({ radar: radar({ avgStill: 15 }), links: [link('left', 0.7), link('right', 0.1)] }), 'clear', 0.5, true);
    expect(stirring.value).toBeLessThan(quiet.value!);
    expect(stirring.basis.join(' ')).toMatch(/Left side level 0.70/);
  });

  it('is high for ALERT when the radar is well over its threshold and the module agrees', () => {
    const strong = computeConfidence(
      debug({ radar: radar({ avgStill: 100, stateName: 'still', prediction: 'still' }), zone: { state: 'inside', entrySide: 'left', entryLogic: false, exitOnCrossing: true, blockedSides: [] } }),
      'inside', 0.5, true,
    );
    expect(strong.value).toBe(1);
    expect(strong.basis).toContain('LD2410C reports still');
    expect(strong.basis).toContain('Entry through the left side');
    const weak = computeConfidence(debug({ radar: radar({ avgStill: 35, stateName: 'nobody', prediction: 'still', moduleNobody: true, held: true }) }), 'inside', 0.5, true);
    expect(weak.value).toBeLessThan(0.6);
    expect(weak.basis.join(' ')).toMatch(/kept from the previous second/);
  });

  it('rates APPROACH by the side level and caps a crossed-out person', () => {
    const approach = computeConfidence(debug({ radar: radar({}), links: [link('right', 1.5, true), link('left', 0.1)] }), 'approach', 0.5, true);
    expect(approach.value).toBeGreaterThan(0.7);
    expect(approach.basis[0]).toMatch(/Right side level 1.50/);
    const leftZone = computeConfidence(
      debug({ radar: radar({ avgMoving: 90, prediction: 'moving', stateName: 'moving' }), links: [link('left', 0.2)], zone: { state: 'left_zone', entrySide: null, entryLogic: false, exitOnCrossing: true, blockedSides: ['right'] } }),
      'clear', 0.5, true,
    );
    expect(leftZone.value).toBeLessThanOrEqual(0.55);
    expect(leftZone.basis[0]).toMatch(/crossed out/);
  });
});
