export type AlertLevel = 'clear' | 'approach' | 'inside';

export type LinkState = {
  id: string;
  motion: boolean;
  strength: number;
  rssi: number | null;
  pps: number | null;
};

export type NodeState = {
  id: string;
  online: boolean;
};

export type Detection = {
  t: number;
  motion: boolean;
  strength: number;
  confidence: number | null;
  receivedAt: number;
  alert: AlertLevel;
  distanceM: number | null;
  links: LinkState[] | null;
  nodes: NodeState[] | null;
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

  // links: optional array of link states
  let links: LinkState[] | null = null;
  if (Array.isArray(record.links)) {
    const parsedLinks: LinkState[] = [];
    const seenIds = new Set<string>();

    for (const linkItem of record.links) {
      if (
        typeof linkItem !== 'object' ||
        linkItem === null ||
        Array.isArray(linkItem)
      ) {
        continue;
      }
      const lRec = linkItem as Record<string, unknown>;
      if (typeof lRec.id !== 'string' || lRec.id.trim().length === 0) {
        continue;
      }
      if (typeof lRec.motion !== 'boolean') {
        continue;
      }
      if (typeof lRec.strength !== 'number' || !Number.isFinite(lRec.strength)) {
        continue;
      }
      if (seenIds.has(lRec.id)) {
        continue;
      }
      seenIds.add(lRec.id);

      let rssi: number | null = null;
      if (
        typeof lRec.rssi === 'number' &&
        Number.isFinite(lRec.rssi) &&
        lRec.rssi >= -120 &&
        lRec.rssi <= 0
      ) {
        rssi = lRec.rssi;
      }

      let pps: number | null = null;
      if (
        typeof lRec.pps === 'number' &&
        Number.isFinite(lRec.pps) &&
        lRec.pps >= 0
      ) {
        pps = lRec.pps;
      }

      parsedLinks.push({
        id: lRec.id,
        motion: lRec.motion,
        strength: clamp01(lRec.strength),
        rssi,
        pps,
      });
    }

    links = parsedLinks;
  }

  // nodes: optional array of node states
  let nodes: NodeState[] | null = null;
  if (Array.isArray(record.nodes)) {
    const parsedNodes: NodeState[] = [];
    const seenNodeIds = new Set<string>();

    for (const nodeItem of record.nodes) {
      if (
        typeof nodeItem !== 'object' ||
        nodeItem === null ||
        Array.isArray(nodeItem)
      ) {
        continue;
      }
      const nRec = nodeItem as Record<string, unknown>;
      if (typeof nRec.id !== 'string' || nRec.id.trim().length === 0) {
        continue;
      }
      if (typeof nRec.online !== 'boolean') {
        continue;
      }
      if (seenNodeIds.has(nRec.id)) {
        continue;
      }
      seenNodeIds.add(nRec.id);

      parsedNodes.push({
        id: nRec.id,
        online: nRec.online,
      });
    }

    nodes = parsedNodes;
  }

  return {
    t,
    motion: rawMotion,
    strength: clamp01(rawStrength),
    confidence,
    receivedAt,
    alert,
    distanceM,
    links,
    nodes,
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
