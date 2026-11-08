import { describe, expect, it } from 'vitest';
import { parseDetections } from './contract';

describe('parseDetections', () => {
  const receiveTime = 1762450000000; // ms

  it('parses a valid message', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: true,
      strength: 0.74,
      confidence: 0.88,
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections).toEqual([
      {
        t: 1762450000.12,
        motion: true,
        strength: 0.74,
        confidence: 0.88,
        receivedAt: receiveTime,
        alert: 'inside',
        distanceM: null,
        links: null,
        nodes: null,
        entrySide: null,
      },
    ]);
  });

  it('parses an array of two messages', () => {
    const raw = JSON.stringify([
      {
        t: 1762450000.1,
        motion: false,
        strength: 0.1,
        confidence: 0.9,
      },
      {
        t: 1762450000.2,
        motion: true,
        strength: 0.8,
        confidence: 0.85,
      },
    ]);
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections).toHaveLength(2);
    expect(result.detections[0].motion).toBe(false);
    expect(result.detections[0].alert).toBe('clear');
    expect(result.detections[1].motion).toBe(true);
    expect(result.detections[1].alert).toBe('inside');
  });

  it('accepts each alias: timestamp for t, detected for motion, motion_score for strength', () => {
    const raw = JSON.stringify({
      timestamp: 1762450001.5,
      detected: true,
      motion_score: 0.65,
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]).toEqual({
      t: 1762450001.5,
      motion: true,
      strength: 0.65,
      confidence: null,
      receivedAt: receiveTime,
      alert: 'inside',
      distanceM: null,
      links: null,
      nodes: null,
      entrySide: null,
    });
  });

  it('prefers new field names over aliases when both are present', () => {
    const raw = JSON.stringify({
      t: 100,
      timestamp: 200,
      motion: false,
      detected: true,
      strength: 0.2,
      motion_score: 0.8,
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].t).toBe(100);
    expect(result.detections[0].motion).toBe(false);
    expect(result.detections[0].strength).toBe(0.2);
  });

  it('marks message as invalid when strength is missing', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: true,
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(1);
    expect(result.detections).toHaveLength(0);
  });

  it('marks message as invalid when motion is string "true"', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: 'true',
      strength: 0.5,
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(1);
    expect(result.detections).toHaveLength(0);
  });

  it('clamps strength greater than 1 to 1', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: true,
      strength: 1.7,
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].strength).toBe(1);
  });

  it('clamps negative confidence to 0', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: true,
      strength: 0.5,
      confidence: -0.2,
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].confidence).toBe(0);
  });

  it('sets missing confidence to null', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: false,
      strength: 0.15,
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].confidence).toBeNull();
  });

  it('handles malformed JSON without throwing and counts 1 invalid', () => {
    const raw = '{"motion": tru';
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(1);
    expect(result.detections).toHaveLength(0);
  });

  it('ignores extra unknown fields', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: true,
      strength: 0.6,
      confidence: 0.75,
      extra_feature: 'ignored',
      z_score: 4.2,
      subcarriers: [1, 2, 3],
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections).toEqual([
      {
        t: 1762450000.12,
        motion: true,
        strength: 0.6,
        confidence: 0.75,
        receivedAt: receiveTime,
        alert: 'inside',
        distanceM: null,
        links: null,
        nodes: null,
        entrySide: null,
      },
    ]);
  });

  it('falls back to receivedAt in seconds when t is missing or not finite', () => {
    const raw = JSON.stringify({
      motion: false,
      strength: 0.05,
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].t).toBe(receiveTime / 1000);
  });

  // Section 17.1 new test cases
  it('parses valid alert: "approach" with distance_m: 2.3', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: false,
      strength: 0.08,
      alert: 'approach',
      distance_m: 2.3,
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].alert).toBe('approach');
    expect(result.detections[0].distanceM).toBe(2.3);
  });

  it('derives alert when given alert: "INSIDE"', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: false,
      strength: 0.1,
      alert: 'INSIDE',
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].alert).toBe('clear');
  });

  it('derives alert from motion when alert is missing', () => {
    const rawMotionTrue = JSON.stringify({
      t: 1762450000.12,
      motion: true,
      strength: 0.8,
    });
    const resTrue = parseDetections(rawMotionTrue, receiveTime);
    expect(resTrue.invalid).toBe(0);
    expect(resTrue.detections[0].alert).toBe('inside');

    const rawMotionFalse = JSON.stringify({
      t: 1762450000.12,
      motion: false,
      strength: 0.1,
    });
    const resFalse = parseDetections(rawMotionFalse, receiveTime);
    expect(resFalse.invalid).toBe(0);
    expect(resFalse.detections[0].alert).toBe('clear');
  });

  it('sets distanceM to null for -1, "2", and 25', () => {
    for (const badDist of [-1, '2', 25]) {
      const raw = JSON.stringify({
        t: 1762450000.12,
        motion: false,
        strength: 0.1,
        distance_m: badDist,
      });
      const result = parseDetections(raw, receiveTime);
      expect(result.invalid).toBe(0);
      expect(result.detections[0].distanceM).toBeNull();
    }
  });

  it('parses an older-format message giving derived alert and distanceM: null', () => {
    const raw = JSON.stringify({
      type: 'detection',
      timestamp: 1762450000.5,
      detected: true,
      motion_score: 0.82,
      confidence: 0.9,
      source: 'rx1',
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0]).toEqual({
      t: 1762450000.5,
      motion: true,
      strength: 0.82,
      confidence: 0.9,
      receivedAt: receiveTime,
      alert: 'inside',
      distanceM: null,
      links: null,
      nodes: null,
      entrySide: null,
    });
  });

  // Section 18.2 Phase 11 test cases
  it('parses valid links and nodes', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: true,
      strength: 0.81,
      links: [
        { id: 'left', motion: true, strength: 0.81, rssi: -58, pps: 27 },
        { id: 'right', motion: false, strength: 0.05, rssi: -61, pps: 28 },
      ],
      nodes: [
        { id: 'hub', online: true },
        { id: 'left', online: true },
        { id: 'right', online: false },
        { id: 'radar', online: true },
      ],
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].links).toEqual([
      { id: 'left', motion: true, strength: 0.81, rssi: -58, pps: 27 },
      { id: 'right', motion: false, strength: 0.05, rssi: -61, pps: 28 },
    ]);
    expect(result.detections[0].nodes).toEqual([
      { id: 'hub', online: true },
      { id: 'left', online: true },
      { id: 'right', online: false },
      { id: 'radar', online: true },
    ]);
  });

  it('skips a link without strength while other links stay', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: false,
      strength: 0.1,
      links: [
        { id: 'left', motion: false },
        { id: 'right', motion: false, strength: 0.05 },
      ],
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].links).toEqual([
      { id: 'right', motion: false, strength: 0.05, rssi: null, pps: null },
    ]);
  });

  it('sets rssi to null when value is -150', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: false,
      strength: 0.1,
      links: [{ id: 'left', motion: false, strength: 0.05, rssi: -150 }],
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].links?.[0].rssi).toBeNull();
  });

  it('sets pps to null when value is -1', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: false,
      strength: 0.1,
      links: [{ id: 'left', motion: false, strength: 0.05, pps: -1 }],
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].links?.[0].pps).toBeNull();
  });

  it('skips a node with online: "yes"', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: false,
      strength: 0.1,
      nodes: [
        { id: 'left', online: 'yes' },
        { id: 'hub', online: true },
      ],
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].nodes).toEqual([{ id: 'hub', online: true }]);
  });

  it('sets links to null when links is "left"', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: false,
      strength: 0.1,
      links: 'left',
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].links).toBeNull();
  });

  it('keeps the first when duplicate link id is present', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: false,
      strength: 0.1,
      links: [
        { id: 'left', motion: false, strength: 0.1 },
        { id: 'left', motion: true, strength: 0.9 },
      ],
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].links).toHaveLength(1);
    expect(result.detections[0].links?.[0].strength).toBe(0.1);
    expect(result.detections[0].links?.[0].motion).toBe(false);
  });

  it('gives links: null and nodes: null for an older-format message', () => {
    const raw = JSON.stringify({
      t: 1762450000.12,
      motion: false,
      strength: 0.1,
    });
    const result = parseDetections(raw, receiveTime);
    expect(result.invalid).toBe(0);
    expect(result.detections[0].links).toBeNull();
    expect(result.detections[0].nodes).toBeNull();
  });

  it('reads entry_side and ignores bad values', () => {
    const base = { t: 1762450000.12, motion: true, strength: 0.5, confidence: 0.8, alert: 'inside' };
    expect(parseDetections(JSON.stringify({ ...base, entry_side: 'left' }), receiveTime).detections[0].entrySide).toBe('left');
    expect(parseDetections(JSON.stringify({ ...base, entry_side: 'base' }), receiveTime).detections[0].entrySide).toBe('base');
    for (const bad of [null, 3, '', '   ', 'x'.repeat(17)]) {
      const result = parseDetections(JSON.stringify({ ...base, entry_side: bad }), receiveTime);
      expect(result.invalid).toBe(0);
      expect(result.detections[0].entrySide).toBeNull();
    }
  });
});
