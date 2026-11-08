// The hub server (processing/hub.py) adds a `debug` object to every message with the raw sensor
// numbers. Only the Sensors panel uses it; the main dashboard reads the contract fields.
// Anything missing or of the wrong type becomes null, so a partial or older hub never breaks the page.

export type CalibrationState = 'idle' | 'countdown' | 'measuring' | 'done' | 'failed';

export type HubLinkDebug = {
  id: string;
  mac: string | null;
  online: boolean;
  pps: number | null;
  rssi: number | null;
  score: number | null;
  threshold: number | null;
  /** Typical empty-zone score from the last calibration. */
  baseline: number | null;
  calibrated: boolean;
  motion: boolean;
};

export type HubRadarDebug = {
  fps: number | null;
  stateName: string | null;
  movingCm: number | null;
  movingEnergy: number | null;
  stillCm: number | null;
  stillEnergy: number | null;
  detectCm: number | null;
  avgMoving: number | null;
  avgStill: number | null;
  movingThreshold: number | null;
  stillThreshold: number | null;
  zoneCm: [number, number] | null;
  prediction: string | null;
  status: string | null;
};

export type HubCalibration = {
  state: CalibrationState;
  remainingS: number | null;
  message: string | null;
  at: string | null;
};

export type HubZone = {
  /** clear | inside | seen_no_entry | left_zone */
  state: string | null;
  entrySide: string | null;
  entryLogic: boolean;
  exitOnCrossing: boolean;
};

export type HubDebug = {
  source: string | null;
  uptimeS: number | null;
  links: HubLinkDebug[];
  radar: HubRadarDebug | null;
  esp1: { linesPerS: number | null; garbled: number | null } | null;
  calibration: HubCalibration | null;
  zone: HubZone | null;
};

type Obj = Record<string, unknown>;

const CALIBRATION_STATES: readonly string[] = ['idle', 'countdown', 'measuring', 'done', 'failed'];

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function parseLink(v: unknown): HubLinkDebug | null {
  if (!isObj(v) || typeof v.id !== 'string' || v.id.length === 0) return null;
  return {
    id: v.id,
    mac: str(v.mac),
    online: v.online === true,
    pps: num(v.pps),
    rssi: num(v.rssi),
    score: num(v.score),
    threshold: num(v.threshold),
    baseline: num(v.baseline),
    calibrated: v.calibrated === true,
    motion: v.motion === true,
  };
}

function parseRadar(v: unknown): HubRadarDebug | null {
  if (!isObj(v)) return null;
  let zoneCm: [number, number] | null = null;
  if (Array.isArray(v.zone_cm) && v.zone_cm.length === 2) {
    const lo = num(v.zone_cm[0]);
    const hi = num(v.zone_cm[1]);
    if (lo !== null && hi !== null) zoneCm = [lo, hi];
  }
  return {
    fps: num(v.fps),
    stateName: str(v.state_name),
    movingCm: num(v.moving_cm),
    movingEnergy: num(v.moving_energy),
    stillCm: num(v.still_cm),
    stillEnergy: num(v.still_energy),
    detectCm: num(v.detect_cm),
    avgMoving: num(v.avg_moving),
    avgStill: num(v.avg_still),
    movingThreshold: num(v.moving_threshold),
    stillThreshold: num(v.still_threshold),
    zoneCm,
    prediction: str(v.prediction),
    status: str(v.status),
  };
}

function parseCalibration(v: unknown): HubCalibration | null {
  if (!isObj(v) || typeof v.state !== 'string' || !CALIBRATION_STATES.includes(v.state)) return null;
  return {
    state: v.state as CalibrationState,
    remainingS: num(v.remaining_s),
    message: str(v.message),
    at: str(v.at),
  };
}

/** Returns the hub's debug section from one raw message, or null if there is none. */
export function parseHubDebug(raw: string): HubDebug | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data) || !isObj(data.debug)) return null;
  const d = data.debug;
  const links = Array.isArray(d.links)
    ? d.links.map(parseLink).filter((l): l is HubLinkDebug => l !== null)
    : [];
  return {
    source: str(d.source),
    uptimeS: num(d.uptime_s),
    links,
    radar: parseRadar(d.radar),
    esp1: isObj(d.esp1) ? { linesPerS: num(d.esp1.lines_per_s), garbled: num(d.esp1.garbled) } : null,
    calibration: parseCalibration(d.calibration),
    zone: isObj(d.zone)
      ? {
          state: str(d.zone.state),
          entrySide: str(d.zone.entry_side),
          entryLogic: d.zone.entry_logic === true,
          exitOnCrossing: d.zone.exit_on_crossing === true,
        }
      : null,
  };
}
