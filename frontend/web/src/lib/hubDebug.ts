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
  /** Experimental "line blocked" value and threshold (null unless the hub runs with --line-blocked). */
  block: number | null;
  blockThreshold: number | null;
  calibrated: boolean;
  motion: boolean;
  /** Side level: 0 at the quiet level, 1.0 at the threshold, capped at 2 (null from older hubs). */
  evidence: number | null;
  /** Room-following scale applied to the calibrated threshold (1 = as calibrated). */
  followScale: number | null;
  /** What the last calibration set, for "reset to calibrated" (null if never calibrated). */
  calibratedThreshold: number | null;
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
  /** The reading is a still target past the front line (ignored unless already tracked). */
  stillBeyondFront: boolean;
  /** The LD2410C itself says nobody while the energy is over the threshold. */
  moduleNobody: boolean;
  /** The reading was kept from the previous second through a dropout or a distance jump. */
  held: boolean;
};

/** The numbers the Settings panel shows and adjusts (hub.py debug.settings). */
export type HubSettings = {
  baud: number | null;
  baudFixed: boolean;
  maxDistanceCm: number | null;
  defaultMaxDistanceCm: number | null;
  rangeLimitsCm: [number, number] | null;
  stillMaxCm: number | null;
  movingMaxCm: number | null;
  farEntryCm: number | null;
  movingThreshold: number | null;
  stillThreshold: number | null;
  calibratedMovingThreshold: number | null;
  calibratedStillThreshold: number | null;
  thresholdSource: string | null;
  radarThresholdLimits: [number, number] | null;
  linkThresholdLimits: [number, number] | null;
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
  /** Sides someone just left through; they must go quiet before counting as an entry again. */
  blockedSides: string[];
};

export type HubDebug = {
  source: string | null;
  uptimeS: number | null;
  links: HubLinkDebug[];
  radar: HubRadarDebug | null;
  esp1: { linesPerS: number | null; garbled: number | null } | null;
  calibration: HubCalibration | null;
  zone: HubZone | null;
  settings: HubSettings | null;
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
    block: num(v.block),
    blockThreshold: num(v.block_threshold),
    calibrated: v.calibrated === true,
    motion: v.motion === true,
    evidence: num(v.evidence),
    followScale: num(v.follow_scale),
    calibratedThreshold: num(v.calibrated_threshold),
  };
}

function pair(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const lo = num(v[0]);
  const hi = num(v[1]);
  return lo !== null && hi !== null ? [lo, hi] : null;
}

function parseRadar(v: unknown): HubRadarDebug | null {
  if (!isObj(v)) return null;
  const zoneCm = pair(v.zone_cm);
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
    stillBeyondFront: v.still_beyond_front === true,
    moduleNobody: v.module_nobody === true,
    held: v.held === true,
  };
}

function parseSettings(v: unknown): HubSettings | null {
  if (!isObj(v)) return null;
  return {
    baud: num(v.baud),
    baudFixed: v.baud_fixed !== false,
    maxDistanceCm: num(v.max_distance_cm),
    defaultMaxDistanceCm: num(v.default_max_distance_cm),
    rangeLimitsCm: pair(v.range_limits_cm),
    stillMaxCm: num(v.still_max_cm),
    movingMaxCm: num(v.moving_max_cm),
    farEntryCm: num(v.far_entry_cm),
    movingThreshold: num(v.moving_threshold),
    stillThreshold: num(v.still_threshold),
    calibratedMovingThreshold: num(v.calibrated_moving_threshold),
    calibratedStillThreshold: num(v.calibrated_still_threshold),
    thresholdSource: str(v.threshold_source),
    radarThresholdLimits: pair(v.radar_threshold_limits),
    linkThresholdLimits: pair(v.link_threshold_limits),
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
          blockedSides: Array.isArray(d.zone.blocked_sides)
            ? d.zone.blocked_sides.filter((s): s is string => typeof s === 'string')
            : [],
        }
      : null,
    settings: parseSettings(d.settings),
  };
}
