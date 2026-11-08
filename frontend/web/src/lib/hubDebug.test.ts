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
