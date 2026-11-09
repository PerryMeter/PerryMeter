import { describe, expect, it } from 'vitest';
import { parseHubDebug } from './hubDebug';

describe('parseHubDebug', () => {
  it('reads a full hub debug section', () => {
    const raw = JSON.stringify({
      t: 1794174633.2,
      motion: false,
      strength: 0.1,
      confidence: 0.9,
      debug: {
        source: 'esp1',
        uptime_s: 12,
        links: [
          { id: 'left', mac: '1a:00:00:00:00:02', online: true, pps: 19, rssi: -69, score: 0.0385, threshold: 0.15, calibrated: false, motion: false },
        ],
        radar: {
          fps: 10, state: 2, state_name: 'still', moving_cm: 86, moving_energy: 0, still_cm: 86, still_energy: 100,
          detect_cm: 85, avg_moving: 0, avg_still: 98.5, moving_threshold: 94, still_threshold: 52,
          zone_cm: [0, 150], prediction: 'still', status: null,
        },
        esp1: { lines_per_s: 50, garbled: 0 },
        calibration: { state: 'measuring', remaining_s: 7.2, message: 'Stay out', at: null, results: null },
      },
    });
    const d = parseHubDebug(raw);
    expect(d).not.toBeNull();
    expect(d?.links[0]).toMatchObject({ id: 'left', pps: 19, rssi: -69, score: 0.0385, calibrated: false });
    expect(d?.radar).toMatchObject({ stateName: 'still', stillCm: 86, avgStill: 98.5, zoneCm: [0, 150], prediction: 'still' });
    expect(d?.esp1).toEqual({ linesPerS: 50, garbled: 0 });
    expect(d?.calibration).toEqual({ state: 'measuring', remainingS: 7.2, message: 'Stay out', at: null });
  });

  it('returns null without a debug object or for broken JSON', () => {
    expect(parseHubDebug(JSON.stringify({ t: 1, motion: true, strength: 0.5, confidence: 0.5 }))).toBeNull();
    expect(parseHubDebug('{"debug": ')).toBeNull();
    expect(parseHubDebug(JSON.stringify([{ debug: {} }]))).toBeNull();
  });

  it('reads the settings block, side levels and radar notes', () => {
    const d = parseHubDebug(JSON.stringify({
      debug: {
        links: [{ id: 'left', online: true, evidence: 0.57, follow_scale: 0.7, calibrated_threshold: 0.1176, calibrated: true, motion: false }],
        radar: { state: 0, state_name: 'nobody', still_cm: 145, still_energy: 35, avg_still: 38, still_threshold: 20, held: true, module_nobody: true, still_beyond_front: false, zone_cm: [0, 220] },
        zone: { state: 'left_zone', entry_side: null, entry_logic: false, exit_on_crossing: true, blocked_sides: ['right', 3] },
        settings: {
          baud: 921600, baud_fixed: true, max_distance_cm: 220, default_max_distance_cm: 220, range_limits_cm: [100, 600],
          still_max_cm: 176, moving_max_cm: 187, far_entry_cm: 154, moving_threshold: 20, still_threshold: 20,
          calibrated_moving_threshold: 20, calibrated_still_threshold: 20, threshold_source: 'hub calibration at 22:43',
          radar_threshold_limits: [5, 100], link_threshold_limits: [0.02, 2],
        },
      },
    }));
    expect(d?.links[0]).toMatchObject({ evidence: 0.57, followScale: 0.7, calibratedThreshold: 0.1176 });
    expect(d?.radar).toMatchObject({ held: true, moduleNobody: true, stillBeyondFront: false });
    expect(d?.zone).toMatchObject({ state: 'left_zone', blockedSides: ['right'] });
    expect(d?.settings).toMatchObject({ baud: 921600, baudFixed: true, maxDistanceCm: 220, stillMaxCm: 176, rangeLimitsCm: [100, 600], linkThresholdLimits: [0.02, 2] });
  });

  it('gives null settings and empty flags for an older hub', () => {
    const d = parseHubDebug(JSON.stringify({ debug: { links: [{ id: 'left' }], radar: { fps: 10 }, zone: { state: 'clear' } } }));
    expect(d?.settings).toBeNull();
    expect(d?.links[0]).toMatchObject({ evidence: null, followScale: null, calibratedThreshold: null });
    expect(d?.radar).toMatchObject({ held: false, moduleNobody: false, stillBeyondFront: false });
    expect(d?.zone?.blockedSides).toEqual([]);
  });

  it('turns wrong types into null and skips bad links', () => {
    const d = parseHubDebug(JSON.stringify({
      debug: {
        links: [{ id: 'right', pps: 'fast', score: null }, { mac: 'no id' }, 7],
        radar: 'nope',
        calibration: { state: 'exploding' },
      },
    }));
    expect(d?.links).toHaveLength(1);
    expect(d?.links[0]).toMatchObject({ id: 'right', pps: null, score: null, online: false });
    expect(d?.radar).toBeNull();
    expect(d?.calibration).toBeNull();
    expect(d?.esp1).toBeNull();
  });
});
