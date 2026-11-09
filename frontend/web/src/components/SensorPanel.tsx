import { useEffect } from 'react';
import type { LinkStatus } from '../hooks/useDetectionStream';
import type { HubDebug, HubLinkDebug, HubRadarDebug, HubZone } from '../lib/hubDebug';
import type { Mode, Units } from '../lib/settings';
import { formatCm } from '../lib/units';

type SensorPanelProps = {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  mode: Mode;
  status: LinkStatus;
  isFresh: boolean;
  debug: HubDebug | null;
  rawMessage: string | null;
  units: Units;
};

type Tone = 'neutral' | 'warn' | 'alert' | 'faint';

const TONE_BG: Record<Tone, string> = {
  neutral: 'bg-accent',
  warn: 'bg-warn',
  alert: 'bg-alert',
  faint: 'bg-faint',
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-text',
  warn: 'text-warn',
  alert: 'text-alert',
  faint: 'text-faint',
};

function fmt(value: number | null, digits = 0, unit = ''): string {
  if (value === null) return '--';
  return `${value.toFixed(digits)}${unit}`;
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[10px] border border-line bg-bg/40 p-3">
      <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-line">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A horizontal bar from 0 to max with a thin marker at the threshold. */
function Bar({ value, max, marker, tone, label }: { value: number | null; max: number; marker: number | null; tone: Tone; label: string }) {
  const pct = value === null || max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const markerPct = marker === null || max <= 0 ? null : Math.max(0, Math.min(100, (marker / max) * 100));
  return (
    <div className="relative h-2 rounded-full bg-surface-2 overflow-hidden" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value ?? 0}>
      <div className={`h-full rounded-full ${TONE_BG[tone]} transition-[width] duration-150`} style={{ width: `${pct}%` }} />
      {markerPct !== null && <div className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-text/80" style={{ left: `calc(${markerPct}% - 1px)` }} />}
    </div>
  );
}

function senderName(mac: string | null): string {
  const last = mac?.split(':').pop();
  const n = last ? parseInt(last, 16) : NaN;
  return Number.isFinite(n) ? `ESP${n}` : 'sender';
}

function LinkCard({ link }: { link: HubLinkDebug }) {
  const tone: Tone = !link.online ? 'faint' : link.motion ? 'warn' : 'neutral';
  const max = link.threshold !== null && link.threshold > 0 ? link.threshold * 2 : 0.3;
  return (
    <div className="py-2 first:pt-0 last:pb-0 border-b border-line/50 last:border-b-0">
      <div className="flex items-center justify-between font-mono">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${link.online ? 'bg-accent' : 'border border-muted'}`} />
          <span className="uppercase font-medium text-text">{link.id}</span>
          <span className="text-muted text-[11px]">
            {senderName(link.mac)} {link.mac ?? ''}
          </span>
        </div>
        {link.motion && link.online && <span className="px-1.5 rounded-[4px] border border-warn/60 text-warn text-[10px] tracking-wider">ACTIVE</span>}
        {!link.online && <span className="text-muted text-[11px]">offline</span>}
      </div>
      <div className="mt-1.5 flex gap-4 font-mono text-[11px] text-muted tabular-nums">
        <span>{fmt(link.pps, 0, '/s')}</span>
        <span>{fmt(link.rssi, 0, ' dBm')}</span>
        {link.evidence !== null && <span>level {fmt(link.evidence, 2)}</span>}
        {link.followScale !== null && Math.abs(link.followScale - 1) > 0.01 && <span>room x{link.followScale.toFixed(2)}</span>}
      </div>
      <div className="mt-2">
        <Bar value={link.score} max={max} marker={link.threshold} tone={tone} label={`${link.id} activity`} />
        <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums">
          <span className={TONE_TEXT[tone]}>activity {fmt(link.score, 3)}</span>
          <span className="text-muted">threshold {fmt(link.threshold, 3)}</span>
        </div>
        {link.block !== null && link.blockThreshold !== null && (
          <div className="mt-2">
            <Bar value={link.block} max={link.blockThreshold * 2} marker={link.blockThreshold} tone={tone} label={`${link.id} line blocked`} />
            <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums">
              <span className={TONE_TEXT[tone]}>line blocked {fmt(link.block, 3)}</span>
              <span className="text-muted">threshold {fmt(link.blockThreshold, 3)}</span>
            </div>
          </div>
        )}
        <div className="mt-1.5 font-mono text-[11px] text-faint tabular-nums">empty zone {fmt(link.baseline, 3)}{link.calibrated ? '' : ', default threshold (not calibrated)'}</div>
      </div>
    </div>
  );
}

function RadarCard({ radar, units }: { radar: HubRadarDebug; units: Units }) {
  const prediction = radar.prediction ?? 'nothing';
  const predTone: Tone = prediction === 'moving' ? 'alert' : prediction === 'still' ? 'warn' : 'faint';
  const moveTone: Tone = radar.avgMoving !== null && radar.movingThreshold !== null && radar.avgMoving >= radar.movingThreshold ? 'alert' : 'neutral';
  const stillTone: Tone = radar.avgStill !== null && radar.stillThreshold !== null && radar.avgStill >= radar.stillThreshold ? 'warn' : 'neutral';
  const notes: string[] = [];
  if (radar.held) notes.push('reading held');
  if (radar.stillBeyondFront) notes.push('still target past the front');
  if (radar.moduleNobody) notes.push('module says nobody');
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <span className={`font-mono text-2xl font-medium uppercase ${TONE_TEXT[predTone]}`}>{prediction}</span>
        <span className="font-mono text-[11px] text-muted">module: {radar.stateName ?? '--'}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums">
        <div>
          <div className="text-faint">moving</div>
          <div className="text-text">{formatCm(radar.movingCm, units)}</div>
        </div>
        <div>
          <div className="text-faint">still</div>
          <div className="text-text">{formatCm(radar.stillCm, units)}</div>
        </div>
        <div>
          <div className="text-faint">detect</div>
          <div className="text-text">{formatCm(radar.detectCm, units)}</div>
        </div>
      </div>
      <div>
        <Bar value={radar.avgMoving} max={100} marker={radar.movingThreshold} tone={moveTone} label="radar movement energy" />
        <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums">
          <span className={TONE_TEXT[moveTone]}>movement {fmt(radar.avgMoving, 0)}</span>
          <span className="text-muted">threshold {fmt(radar.movingThreshold, 0)}</span>
        </div>
      </div>
      <div>
        <Bar value={radar.avgStill} max={100} marker={radar.stillThreshold} tone={stillTone} label="radar stillness energy" />
        <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums">
          <span className={TONE_TEXT[stillTone]}>stillness {fmt(radar.avgStill, 0)}</span>
          <span className="text-muted">threshold {fmt(radar.stillThreshold, 0)}</span>
        </div>
      </div>
      <p className="text-[11px] text-faint font-mono">
        Counts targets {radar.zoneCm ? `${formatCm(radar.zoneCm[0], units)} to ${formatCm(radar.zoneCm[1], units)}` : '--'} away. Energy is the 1 s average.
        {notes.length > 0 ? ` Notes: ${notes.join(', ')}.` : ''}
      </p>
      {radar.status && <p className="text-[11px] text-faint font-mono">{radar.status}</p>}
    </div>
  );
}

function sideName(side: string | null): string {
  if (side === 'base') return 'the front';
  return side ? `the ${side} side` : 'an unknown side';
}

function zoneText(zone: HubZone): { text: string; tone: Tone } {
  switch (zone.state) {
    case 'inside':
      return { text: `Inside, came in through ${sideName(zone.entrySide)}`, tone: 'alert' };
    case 'seen_no_entry':
      return { text: 'Radar sees someone, but nobody crossed a side yet: APPROACH, not ALERT', tone: 'warn' };
    case 'left_zone':
      return { text: 'Crossed out through a side: not tracked until they come back in or leave the radar range', tone: 'neutral' };
    case 'clear':
      return { text: 'Nobody in the radar range', tone: 'neutral' };
    default:
      return { text: zone.state ?? '--', tone: 'faint' };
  }
}

function prettyJson(raw: string | null): string {
  if (raw === null) return 'No message yet';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Read-only live sensor numbers. Adjustments live in the Settings panel. */
export function SensorPanel({ open, onClose, onOpenSettings, mode, status, isFresh, debug, rawMessage, units }: SensorPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside aria-label="Sensor data" className="fixed inset-y-0 right-0 z-40 w-full max-w-[400px] flex flex-col bg-surface border-l border-line-strong">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-text">Sensors</span>
          <span className="font-mono text-[11px] text-muted">{mode === 'demo' ? 'demo' : isFresh ? 'live' : status}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="px-2.5 py-1 rounded-[6px] border border-line-strong bg-surface text-text text-xs hover:bg-surface-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-text"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded-[6px] border border-line-strong bg-surface text-text text-xs hover:bg-surface-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-text"
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
        {debug === null ? (
          <p className="text-muted leading-relaxed">
            {mode === 'demo'
              ? 'Waiting for the simulated hub.'
              : isFresh
                ? 'This server sends no sensor details. Only processing/hub.py does.'
                : 'Waiting for the hub. Is processing/hub.py running?'}
          </p>
        ) : (
          <div className={`space-y-3 transition-opacity ${isFresh ? '' : 'opacity-50'}`}>
            {!isFresh && <p className="text-warn font-mono text-[11px]">Data stopped. Showing the last values.</p>}

            {debug.zone && (
              <Section
                title="Zone decision"
                aside={
                  <span className="font-mono text-[11px] text-faint">
                    {debug.zone.entryLogic ? 'entry logic on' : debug.zone.exitOnCrossing ? 'radar, exit on crossing' : 'radar only'}
                  </span>
                }
              >
                <p className={`font-mono text-[11px] ${TONE_TEXT[zoneText(debug.zone).tone]}`}>{zoneText(debug.zone).text}</p>
                {debug.zone.blockedSides.length > 0 && (
                  <p className="mt-1 text-[11px] text-faint">Waiting for quiet on: {debug.zone.blockedSides.join(', ')}</p>
                )}
              </Section>
            )}

            {debug.links.length > 0 && (
              <Section title="Wi-Fi sides">
                {debug.links.map((link) => (
                  <LinkCard key={link.id} link={link} />
                ))}
                <p className="mt-2 text-[11px] text-faint leading-relaxed">
                  Walk outside the zone near a side: its activity should stay under the marker. Cross the side: it should go over. Thresholds are adjusted in Settings.
                </p>
              </Section>
            )}

            <Section title="Radar" aside={<span className="font-mono text-[11px] text-muted">{debug.radar ? fmt(debug.radar.fps, 0, ' frames/s') : 'no data'}</span>}>
              {debug.radar ? <RadarCard radar={debug.radar} units={units} /> : <p className="text-warn font-mono text-[11px]">No radar data. Check its wiring and power.</p>}
            </Section>

            <Section title="Hub">
              <div className="grid grid-cols-2 gap-y-1 font-mono text-[11px] tabular-nums">
                <span className="text-faint">source</span>
                <span className="text-text">{debug.source ?? '--'}</span>
                <span className="text-faint">running for</span>
                <span className="text-text">{fmt(debug.uptimeS, 0, ' s')}</span>
                {debug.esp1 && (
                  <>
                    <span className="text-faint">ESP1 lines</span>
                    <span className="text-text">{fmt(debug.esp1.linesPerS, 0, '/s')}</span>
                    <span className="text-faint">garbled lines</span>
                    <span className="text-text">{fmt(debug.esp1.garbled, 0)}</span>
                  </>
                )}
                {debug.settings?.baud && (
                  <>
                    <span className="text-faint">serial</span>
                    <span className="text-text">{debug.settings.baud} baud</span>
                  </>
                )}
                {debug.calibration?.at && (
                  <>
                    <span className="text-faint">calibrated</span>
                    <span className="text-text">{debug.calibration.at}</span>
                  </>
                )}
              </div>
            </Section>
          </div>
        )}

        <details className="rounded-[10px] border border-line bg-bg/40">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted select-none">Raw message</summary>
          <pre className="px-3 pb-3 max-h-[320px] overflow-auto font-mono text-[11px] leading-snug text-muted whitespace-pre">{prettyJson(rawMessage)}</pre>
        </details>
      </div>
    </aside>
  );
}
