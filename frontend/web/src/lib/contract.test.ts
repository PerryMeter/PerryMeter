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
    expect(result.detections[1].motion).toBe(true);
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
});
