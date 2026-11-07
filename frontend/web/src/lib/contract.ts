export type AlertLevel = 'clear' | 'approach' | 'inside';

export type Detection = {
  t: number;
  motion: boolean;
  strength: number;
  confidence: number | null;
  receivedAt: number;
  alert: AlertLevel;
  distanceM: number | null;
};

export type ParseResult = {
  detections: Detection[];
  invalid: number;
};

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseItem(item: unknown, receivedAt: number): Detection | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;

  // motion: new name 'motion' wins over alias 'detected'
  let rawMotion: unknown;
  if ('motion' in record) {
    rawMotion = record.motion;
  } else if ('detected' in record) {
    rawMotion = record.detected;
  }

  if (typeof rawMotion !== 'boolean') {
    return null;
  }

  // strength: new name 'strength' wins over alias 'motion_score'
  let rawStrength: unknown;
  if ('strength' in record) {
    rawStrength = record.strength;
  } else if ('motion_score' in record) {
    rawStrength = record.motion_score;
  }

  if (typeof rawStrength !== 'number' || !Number.isFinite(rawStrength)) {
    return null;
  }

  // t: new name 't' wins over alias 'timestamp'
  let rawT: unknown;
  if ('t' in record) {
    rawT = record.t;
  } else if ('timestamp' in record) {
    rawT = record.timestamp;
  }

  const t =
    typeof rawT === 'number' && Number.isFinite(rawT)
      ? rawT
      : receivedAt / 1000;

  // confidence: optional, finite number clamped to [0, 1] or null
  const rawConfidence = record.confidence;
  const confidence =
    typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
      ? clamp01(rawConfidence)
      : null;

  // alert: exactly 'clear' | 'approach' | 'inside', otherwise derive from motion
  let alert: AlertLevel;
  if (
    record.alert === 'clear' ||
    record.alert === 'approach' ||
    record.alert === 'inside'
  ) {
    alert = record.alert;
  } else {
    alert = rawMotion ? 'inside' : 'clear';
  }

  // distance_m: finite number 0..20, otherwise null
  let distanceM: number | null = null;
  const rawDistance = record.distance_m;
  if (
    typeof rawDistance === 'number' &&
    Number.isFinite(rawDistance) &&
    rawDistance >= 0 &&
    rawDistance <= 20
  ) {
    distanceM = rawDistance;
  }

  return {
    t,
    motion: rawMotion,
    strength: clamp01(rawStrength),
    confidence,
    receivedAt,
    alert,
    distanceM,
  };
}

export function parseDetections(raw: string, receivedAt: number): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { detections: [], invalid: 1 };
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  const detections: Detection[] = [];
  let invalid = 0;

  for (const item of items) {
    const detection = parseItem(item, receivedAt);
    if (detection !== null) {
      detections.push(detection);
    } else {
      invalid += 1;
    }
  }

  return { detections, invalid };
}
