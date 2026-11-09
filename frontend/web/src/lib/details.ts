// Builds the small detail view that opens when something on the dashboard is clicked: a title, the
// live numbers behind it (from msg.debug when the hub sends it) and one plain sentence.

import type { DetectionEvent } from '../hooks/useDetectionStream';
import type { ConfidenceResult } from './confidence';
import type { AlertLevel, Detection, LinkState, NodeState } from './contract';
import { formatClock, formatDuration } from './format';
import type { HubDebug } from './hubDebug';
import type { Units } from './settings';
import { formatCm, formatMetres } from './units';

export type Selection =
  | { kind: 'side'; id: string }
  | { kind: 'front' }
  | { kind: 'hub' }
  | { kind: 'node'; id: string }
  | { kind: 'event'; startAt: number }
  | { kind: 'status' }
  | { kind: 'confidence' };

export type DetailContext = {
  debug: HubDebug | null;
  latest: Detection | null;
  alert: AlertLevel | null;
  distanceM: number | null;
  events: DetectionEvent[];
  links: LinkState[] | null;
  nodes: NodeState[] | null;
  confidence: ConfidenceResult;
  units: Units;
  isFresh: boolean;
  now: number;
  armed: boolean;
};

export type DetailRow = [label: string, value: string];

export type DetailContent = {
  title: string;
  subtitle: string | null;
  rows: DetailRow[];
  sentence: string;
  /** Which settings section helps with this item, if any. */
  settingsSection: 'sensitivity' | 'hub' | null;
};

function cap(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function fmt(v: number | null, digits = 0): string {
  return v === null ? '--' : v.toFixed(digits);
}

function boardName(mac: string | null): string {
  const last = mac?.split(':').pop();
  const n = last ? parseInt(last, 16) : NaN;
  return Number.isFinite(n) ? `ESP${n}` : 'board';
}

function sideWord(side: string | null): string {
  if (side === null) return 'an unknown side';
  if (side === 'base') return 'the front';
  return `the ${side} side`;
}

function sideDetail(id: string, ctx: DetailContext): DetailContent {
  const dbg = ctx.debug?.links.find((l) => l.id === id) ?? null;
  const link = ctx.links?.find((l) => l.id === id) ?? ctx.latest?.links?.find((l) => l.id === id) ?? null;
  const node = ctx.nodes?.find((n) => n.id === id) ?? ctx.latest?.nodes?.find((n) => n.id === id) ?? null;
  const online = dbg ? dbg.online : node ? node.online : link !== null;
  const rows: DetailRow[] = [];
  rows.push(['Status', !ctx.isFresh ? 'no data' : online ? 'online' : 'offline']);
  if (dbg?.mac) rows.push(['Board', `${boardName(dbg.mac)} ${dbg.mac}`]);
  const rssi = dbg?.rssi ?? link?.rssi ?? null;
  const pps = dbg?.pps ?? link?.pps ?? null;
  if (rssi !== null) rows.push(['Signal', `${rssi} dBm`]);
  if (pps !== null) rows.push(['Packets', `${pps}/s`]);
  if (dbg) {
    rows.push(['Activity score', fmt(dbg.score, 3)]);
    const scale = dbg.followScale !== null && Math.abs(dbg.followScale - 1) > 0.01 ? ` (x${dbg.followScale.toFixed(2)} room scale)` : '';
    rows.push(['Threshold', `${fmt(dbg.threshold, 3)}${scale}`]);
    if (dbg.evidence !== null) rows.push(['Level', `${dbg.evidence.toFixed(2)} (1.0 = crossing)`]);
    rows.push(['Calibrated', dbg.calibrated ? 'yes' : 'no, default threshold']);
  } else if (link) {
    rows.push(['Strength', `${Math.round(link.strength * 100)}%`]);
  }

  let sentence: string;
  if (!ctx.isFresh) {
    sentence = 'No fresh data from the hub, so this side cannot be judged right now.';
  } else if (!online) {
    sentence = `The ${id} board is not sending, so the hub cannot see crossings on this side.`;
  } else if (link?.motion || dbg?.motion) {
    sentence = `Someone is at the ${id} side: the Wi-Fi signal between this corner and the hub is disturbed past its threshold.`;
  } else if ((dbg?.evidence ?? 0) >= 0.6) {
    sentence = `The ${id} side's signal is stirring but still under its threshold; nobody has crossed it.`;
  } else {
    sentence = `The ${id} side is quiet: its Wi-Fi signal looks like the empty zone.`;
  }
  if (ctx.debug?.zone?.blockedSides.includes(id)) {
    sentence += ' Someone just left through it, so it must go quiet before it counts as an entry again.';
  }
  return { title: `${cap(id)} side`, subtitle: 'Wi-Fi tripwire to the hub', rows, sentence, settingsSection: 'sensitivity' };
}

function frontDetail(ctx: DetailContext): DetailContent {
  const s = ctx.debug?.settings ?? null;
  const radarOnline = Boolean((ctx.nodes ?? ctx.latest?.nodes)?.some((n) => n.id === 'radar' && n.online));
  const rows: DetailRow[] = [['Wi-Fi link', 'none']];
  rows.push(['Covered by', radarOnline ? 'the radar at the hub' : 'nothing (radar offline)']);
  if (s) {
    rows.push(['Radar range', formatCm(s.maxDistanceCm, ctx.units)]);
    rows.push(['Still targets count to', formatCm(s.stillMaxCm, ctx.units)]);
    rows.push(['Moving targets count to', formatCm(s.movingMaxCm, ctx.units)]);
    rows.push(['Front entry when first seen past', formatCm(s.farEntryCm, ctx.units)]);
  }
  const sentence = radarOnline
    ? `There is no Wi-Fi link along the front. The radar covers it: a still target counts up to ${formatCm(s?.stillMaxCm ?? null, ctx.units)} from the hub and a moving one up to ${formatCm(s?.movingMaxCm ?? null, ctx.units)}, so someone standing just past the front line is ignored.`
    : 'There is no Wi-Fi link along the front, and the radar is offline, so nothing watches this side right now.';
  return { title: 'Front', subtitle: 'The open side, facing the radar', rows, sentence, settingsSection: 'hub' };
}

function hubDetail(ctx: DetailContext): DetailContent {
  const r = ctx.debug?.radar ?? null;
  const s = ctx.debug?.settings ?? null;
  const rows: DetailRow[] = [];
  if (!ctx.isFresh) {
    rows.push(['Status', 'no data']);
  } else if (r) {
    rows.push(['Radar frames', `${fmt(r.fps)}/s`]);
    rows.push(['Module reports', r.stateName ?? '--']);
    rows.push(['Hub reads', r.prediction === 'nothing' || r.prediction === null ? 'nothing' : `${r.prediction} at ${formatCm(r.prediction === 'moving' ? r.movingCm : r.stillCm, ctx.units)}`]);
    rows.push(['Movement energy', `${fmt(r.avgMoving)} of ${fmt(r.movingThreshold)}`]);
    rows.push(['Stillness energy', `${fmt(r.avgStill)} of ${fmt(r.stillThreshold)}`]);
    if (r.zoneCm) rows.push(['Counts targets to', formatCm(r.zoneCm[1], ctx.units)]);
    const flags: string[] = [];
    if (r.held) flags.push('reading held');
    if (r.stillBeyondFront) flags.push('still target past the front');
    if (r.moduleNobody) flags.push('module says nobody');
    if (flags.length) rows.push(['Notes', flags.join(', ')]);
  } else {
    rows.push(['Radar', 'no frames']);
  }
  if (ctx.debug?.esp1) rows.push(['ESP1 lines', `${fmt(ctx.debug.esp1.linesPerS)}/s, ${fmt(ctx.debug.esp1.garbled)} garbled`]);
  if (s?.baud) rows.push(['Serial', `${s.baud} baud`]);

  let sentence: string;
  if (!ctx.isFresh) sentence = 'No fresh data from the hub.';
  else if (!r) sentence = 'The hub is running but gets no radar frames. Check the radar wiring and power.';
  else if (r.prediction === 'moving') sentence = `The radar sees someone moving ${formatCm(r.movingCm, ctx.units)} from the hub.`;
  else if (r.prediction === 'still') sentence = `The radar sees someone standing still ${formatCm(r.stillCm, ctx.units)} from the hub.`;
  else sentence = 'The radar sees nobody within its range.';
  if (r?.held) sentence += ' The last good reading is being kept through a short dropout.';
  if (r?.stillBeyondFront) sentence += ' The still target is past the front line, so it does not count on its own.';
  return { title: 'Hub and radar', subtitle: 'ESP1 receiver with the LD2410C', rows, sentence, settingsSection: 'hub' };
}

function nodeDetail(id: string, ctx: DetailContext): DetailContent {
  if (id === 'left' || id === 'right') {
    const d = sideDetail(id, ctx);
    return { ...d, title: `${cap(id)} corner`, subtitle: `${boardName(ctx.debug?.links.find((l) => l.id === id)?.mac ?? null)}, Wi-Fi sender on a power bank` };
  }
  if (id === 'radar') return hubDetail(ctx);
  const node = (ctx.nodes ?? ctx.latest?.nodes)?.find((n) => n.id === id) ?? null;
  const rows: DetailRow[] = [['Status', !ctx.isFresh ? 'no data' : node?.online ? 'online' : 'offline']];
  if (ctx.debug) {
    rows.push(['Source', ctx.debug.source ?? '--']);
    rows.push(['Running for', `${fmt(ctx.debug.uptimeS)} s`]);
    if (ctx.debug.esp1) rows.push(['ESP1 lines', `${fmt(ctx.debug.esp1.linesPerS)}/s`]);
  }
  return {
    title: cap(id),
    subtitle: 'Receiver for both Wi-Fi sides, with the radar attached',
    rows,
    sentence: ctx.isFresh ? 'The hub board is sending Wi-Fi and radar data to the processing server.' : 'No fresh data from the hub.',
    settingsSection: 'hub',
  };
}

function eventDetail(startAt: number, ctx: DetailContext): DetailContent {
  const evt = ctx.events.find((e) => e.startAt === startAt) ?? null;
  if (!evt) {
    return { title: 'Entry', subtitle: null, rows: [], sentence: 'This entry is no longer in the list.', settingsSection: null };
  }
  const ongoing = evt.endAt === null;
  const endAt = evt.endAt ?? ctx.now;
  const rows: DetailRow[] = [
    ['Started', formatClock(evt.startAt)],
    ['Ended', ongoing ? 'ongoing' : formatClock(endAt)],
    ['Duration', formatDuration((endAt - evt.startAt) / 1000)],
    ['Entry side', evt.side === null ? 'unknown' : evt.side === 'base' ? 'front' : evt.side],
    ['Peak strength', `${Math.round(evt.peak * 100)}%`],
    ['Zone was', evt.armed ? 'armed' : 'disarmed'],
  ];
  const who = `Someone came in through ${sideWord(evt.side)} at ${formatClock(evt.startAt)}`;
  const sentence = ongoing
    ? `${who} and is still inside.`
    : `${who} and stayed ${formatDuration((endAt - evt.startAt) / 1000)}${evt.armed ? '.' : '; the zone was disarmed, so it was logged without an alarm.'}`;
  return { title: 'Entry', subtitle: null, rows, sentence, settingsSection: null };
}

function zoneWords(state: string | null): string {
  switch (state) {
    case 'inside':
      return 'someone inside';
    case 'left_zone':
      return 'crossed out, not tracked';
    case 'seen_no_entry':
      return 'seen by the radar, no entry';
    case 'clear':
      return 'nobody in range';
    default:
      return state ?? '--';
  }
}

function statusDetail(ctx: DetailContext): DetailContent {
  const zone = ctx.debug?.zone ?? null;
  const rows: DetailRow[] = [];
  rows.push(['Alert', !ctx.isFresh || ctx.alert === null ? 'no data' : ctx.alert === 'inside' ? 'ALERT' : ctx.alert.toUpperCase()]);
  rows.push(['Zone', ctx.armed ? 'armed' : 'disarmed']);
  if (zone) {
    rows.push(['Hub state', zoneWords(zone.state)]);
    if (zone.entrySide) rows.push(['Entry side', zone.entrySide === 'base' ? 'front' : zone.entrySide]);
  }
  if (ctx.distanceM !== null) rows.push(['Distance from hub', formatMetres(ctx.distanceM, ctx.units)]);
  if (ctx.confidence.value !== null) rows.push(['Confidence', `${Math.round(ctx.confidence.value * 100)}%`]);
  const ongoing = ctx.events[0]?.endAt === null ? ctx.events[0] : null;
  if (ongoing) rows.push(['Inside for', formatDuration((ctx.now - ongoing.startAt) / 1000)]);

  let sentence: string;
  if (!ctx.isFresh || ctx.alert === null) sentence = 'No fresh data: the hub is not sending, so the zone cannot be judged.';
  else if (ctx.alert === 'inside') {
    sentence = `The radar sees a person in the zone${zone?.entrySide ? `, who came in through ${sideWord(zone.entrySide)}` : ''}.${ctx.armed ? '' : ' The zone is disarmed, so this is logged without an alarm.'}`;
  } else if (ctx.alert === 'approach') {
    sentence = zone?.state === 'left_zone'
      ? 'Someone crossed out through a side and is still near it; they are not counted as inside.'
      : 'A Wi-Fi side is disturbed: someone is at the edge of the zone but has not been seen inside.';
  } else {
    sentence = zone?.state === 'left_zone'
      ? 'The radar still sees the person who just crossed out, so they are deliberately not counted.'
      : 'Nobody is in the zone: the radar sees no one in range and both Wi-Fi sides are quiet.';
  }
  return { title: 'Zone status', subtitle: null, rows, sentence, settingsSection: null };
}

function confidenceDetail(ctx: DetailContext): DetailContent {
  const c = ctx.confidence;
  const rows: DetailRow[] = [['Confidence', c.value === null ? '--' : `${Math.round(c.value * 100)}%`]];
  rows.push(['Computed by', c.source === 'dashboard' ? 'the dashboard, from msg.debug' : c.source === 'hub' ? 'the hub (radar energy only)' : '--']);
  c.basis.forEach((b, i) => rows.push([i === 0 ? 'Based on' : '', b]));
  const sentence = c.source === 'dashboard'
    ? 'Confidence is how far the radar energies are past their thresholds and how the Wi-Fi side levels agree with the verdict. It is a heuristic for the operator, not a probability.'
    : 'The hub\'s own confidence is only the radar movement energy against its threshold; the dashboard shows it because the hub sends no raw numbers.';
  return { title: 'Confidence', subtitle: null, rows, sentence, settingsSection: 'sensitivity' };
}

export function buildDetail(sel: Selection, ctx: DetailContext): DetailContent {
  switch (sel.kind) {
    case 'side':
      return sideDetail(sel.id, ctx);
    case 'front':
      return frontDetail(ctx);
    case 'hub':
      return hubDetail(ctx);
    case 'node':
      return nodeDetail(sel.id, ctx);
    case 'event':
      return eventDetail(sel.startAt, ctx);
    case 'status':
      return statusDetail(ctx);
    case 'confidence':
      return confidenceDetail(ctx);
  }
}
