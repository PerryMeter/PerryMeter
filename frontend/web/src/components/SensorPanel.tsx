import { useState } from 'react';
import type { LinkStatus } from '../hooks/useDetectionStream';
import type { HubCalibration, HubDebug, HubLinkDebug, HubRadarDebug, HubZone } from '../lib/hubDebug';
import type { Mode } from '../lib/settings';

type SensorPanelProps = {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  status: LinkStatus;
  isFresh: boolean;
  debug: HubDebug | null;
  rawMessage: string | null;
  onCalibrate: () => boolean;
  onCancelCalibration: () => boolean;
  /** Multiply one side's threshold by factor (for example 1.25 to make it harder to trigger). */
  onAdjustThreshold: (side: string, factor: number) => boolean;
};

type Tone = 'accent' | 'warn' | 'motion' | 'faint';

const TONE_BG: Record<Tone, string> = {
  accent: 'bg-accent',
  warn: 'bg-warn',
  motion: 'bg-motion',
  faint: 'bg-faint',
};

const TONE_TEXT: Record<Tone, string> = {
  accent: 'text-accent',
  warn: 'text-warn',
  motion: 'text-motion',
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
    <div
      className="relative h-2 rounded-full bg-surface-2 overflow-hidden"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value ?? 0}
    >
      <div className={`h-full rounded-full ${TONE_BG[tone]} transition-[width] duration-150`} style={{ width: `${pct}%` }} />
      {markerPct !== null && (
        <div className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-text/80" style={{ left: `calc(${markerPct}% - 1px)` }} />
      )}
    </div>
  );
}

function Dot({ on }: { on: boolean }) {
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${on ? 'bg-accent' : 'bg-error'}`} />;
}

function senderName(mac: string | null): string {
  const last = mac?.split(':').pop();
  const n = last ? parseInt(last, 16) : NaN;
  return Number.isFinite(n) ? `ESP${n}` : 'sender';
}

const STEP_BUTTON =
  'px-2 py-0.5 rounded-[6px] border border-line-strong bg-surface text-text font-mono text-[11px] hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-accent';

function LinkCard({
  link,
  canAdjust,
  onAdjust,
}: {
  link: HubLinkDebug;
  canAdjust: boolean;
  onAdjust: (side: string, factor: number) => void;
}) {
  const tone: Tone = !link.online ? 'faint' : link.motion ? 'warn' : 'accent';
  const max = link.threshold !== null && link.threshold > 0 ? link.threshold * 2 : 0.3;
  return (
    <div className="py-2 first:pt-0 last:pb-0 border-b border-line/50 last:border-b-0">
      <div className="flex items-center justify-between font-mono">
        <div className="flex items-center gap-2">
          <Dot on={link.online} />
          <span className="uppercase font-medium text-text">{link.id}</span>
          <span className="text-muted text-[11px]">
            {senderName(link.mac)} {link.mac ?? ''}
          </span>
        </div>
        {link.motion && link.online && (
          <span className="px-1.5 rounded-[4px] border border-warn/60 text-warn text-[10px] tracking-wider">ACTIVE</span>
        )}
        {!link.online && <span className="text-error text-[11px]">offline</span>}
      </div>
      <div className="mt-1.5 flex gap-4 font-mono text-[11px] text-muted tabular-nums">
        <span>{fmt(link.pps, 0, '/s')}</span>
        <span>{fmt(link.rssi, 0, ' dBm')}</span>
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
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-faint tabular-nums">empty zone {fmt(link.baseline, 3)}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted">Threshold</span>
            <button
              type="button"
              onClick={() => onAdjust(link.id, 0.8)}
              disabled={!canAdjust}
              aria-label={`Lower the ${link.id} threshold (more sensitive)`}
              className={STEP_BUTTON}
            >
              -
            </button>
            <button
              type="button"
              onClick={() => onAdjust(link.id, 1.25)}
              disabled={!canAdjust}
              aria-label={`Raise the ${link.id} threshold (less sensitive)`}
              className={STEP_BUTTON}
            >
              +
            </button>
          </div>
        </div>
        {!link.calibrated && (
          <p className="mt-1 text-[11px] text-faint">Default threshold. Press Calibrate with the zone empty.</p>
        )}
      </div>
    </div>
  );
}

function RadarCard({ radar }: { radar: HubRadarDebug }) {
  const prediction = radar.prediction ?? 'nothing';
  const predTone: Tone = prediction === 'moving' ? 'motion' : prediction === 'still' ? 'warn' : 'faint';
  const moveTone: Tone =
    radar.avgMoving !== null && radar.movingThreshold !== null && radar.avgMoving >= radar.movingThreshold ? 'motion' : 'accent';
  const stillTone: Tone =
    radar.avgStill !== null && radar.stillThreshold !== null && radar.avgStill >= radar.stillThreshold ? 'warn' : 'accent';
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <span className={`font-mono text-2xl font-medium uppercase ${TONE_TEXT[predTone]}`}>{prediction}</span>
        <span className="font-mono text-[11px] text-muted">raw: {radar.stateName ?? '--'}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums">
        <div>
          <div className="text-faint">moving</div>
          <div className="text-text">{fmt(radar.movingCm, 0, ' cm')}</div>
        </div>
        <div>
          <div className="text-faint">still</div>
          <div className="text-text">{fmt(radar.stillCm, 0, ' cm')}</div>
        </div>
        <div>
          <div className="text-faint">detect</div>
          <div className="text-text">{fmt(radar.detectCm, 0, ' cm')}</div>
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
        Counts targets {radar.zoneCm ? `${radar.zoneCm[0]} to ${radar.zoneCm[1]} cm` : '--'} away. Energy is the 1 s average.
      </p>
      {radar.status && <p className="text-[11px] text-faint font-mono">{radar.status}</p>}
    </div>
  );
}

function calibrationText(cal: HubCalibration | null): { label: string; tone: Tone } {
  if (!cal) return { label: 'Unknown', tone: 'faint' };
  switch (cal.state) {
    case 'countdown':
      return { label: `Leave the zone: ${fmt(cal.remainingS, 0)} s`, tone: 'warn' };
    case 'measuring':
      return { label: `Measuring: ${fmt(cal.remainingS, 0)} s left`, tone: 'warn' };
    case 'done':
      return { label: 'Calibrated', tone: 'accent' };
    case 'failed':
      return { label: 'Failed', tone: 'motion' };
    default:
      return { label: 'Idle', tone: 'faint' };
  }
}

function sideName(side: string | null): string {
  if (side === 'base') return 'the radar side';
  return side ? `the ${side} side` : 'an unknown side';
}

function zoneText(zone: HubZone): { text: string; tone: Tone } {
  switch (zone.state) {
    case 'inside':
      return { text: `Inside, came in from ${sideName(zone.entrySide)}`, tone: 'motion' };
    case 'seen_no_entry':
      return { text: 'Radar sees someone, but nobody crossed a side yet: APPROACH, not ALERT', tone: 'warn' };
    case 'left_zone':
      return { text: 'Crossed back out. APPROACH until the radar stops seeing them', tone: 'warn' };
    case 'clear':
      return { text: 'Nobody in the radar range', tone: 'accent' };
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

export function SensorPanel({
  open,
  onClose,
  mode,
  status,
  isFresh,
  debug,
  rawMessage,
  onCalibrate,
  onCancelCalibration,
  onAdjustThreshold,
}: SensorPanelProps) {
  const [sendError, setSendError] = useState<string | null>(null);

  if (!open) return null;

  const cal = debug?.calibration ?? null;
  const running = cal?.state === 'countdown' || cal?.state === 'measuring';
  const canCalibrate = mode === 'live' && isFresh && debug !== null && !running;
  const calText = calibrationText(cal);

  const handleCalibrate = () => {
    setSendError(onCalibrate() ? null : 'Not connected to the hub');
  };
  const handleCancel = () => {
    setSendError(onCancelCalibration() ? null : 'Not connected to the hub');
  };
  const handleAdjust = (side: string, factor: number) => {
    setSendError(onAdjustThreshold(side, factor) ? null : 'Not connected to the hub');
  };

  return (
    <aside
      aria-label="Sensor data"
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[400px] flex flex-col bg-surface border-l border-line-strong shadow-[-12px_0_32px_rgba(0,0,0,0.45)]"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-text">Sensors</span>
          <span className="font-mono text-[11px] text-muted">
            {mode === 'demo' ? 'demo' : isFresh ? 'live' : status}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-1 rounded-[6px] border border-line-strong bg-surface text-text text-xs hover:bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
        {mode === 'demo' ? (
          <p className="text-muted leading-relaxed">
            Sensor details come from the hub. Switch to Live and run <span className="font-mono text-text">python processing/hub.py --esp1 COM6</span>.
          </p>
        ) : debug === null ? (
          <p className="text-muted leading-relaxed">
            {isFresh
              ? 'This server sends no sensor details. Only processing/hub.py does.'
              : 'Waiting for the hub. Is processing/hub.py running?'}
          </p>
        ) : (
          <div className={`space-y-3 transition-opacity ${isFresh ? '' : 'opacity-50'}`}>
            {!isFresh && <p className="text-error font-mono text-[11px]">Data stopped. Showing the last values.</p>}

            <Section title="Calibration" aside={<span className={`font-mono text-[11px] ${TONE_TEXT[calText.tone]}`} aria-live="polite">{calText.label}</span>}>
              <p className="text-muted leading-relaxed">
                Press Calibrate, then leave the zone. The hub waits a few seconds, measures the empty zone, then sets the Wi-Fi and radar thresholds.
              </p>
              {cal?.message && <p className="mt-1.5 font-mono text-[11px] text-text">{cal.message}</p>}
              {cal?.at && cal.state !== 'countdown' && cal.state !== 'measuring' && (
                <p className="mt-1 font-mono text-[11px] text-faint">Last calibration {cal.at}</p>
              )}
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={handleCalibrate}
                  disabled={!canCalibrate}
                  className="px-3 py-1.5 rounded-[6px] border border-accent/60 bg-accent/10 text-accent text-[13px] font-medium hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  Calibrate empty zone
                </button>
                {running && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-3 py-1.5 rounded-[6px] border border-line-strong bg-surface text-text text-[13px] hover:bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    Cancel
                  </button>
                )}
              </div>
              {sendError && <p className="mt-1.5 text-error font-mono text-[11px]">{sendError}</p>}
            </Section>

            {debug.zone && (
              <Section
                title="Zone decision"
                aside={
                  <span className="font-mono text-[11px] text-faint">
                    {debug.zone.entryLogic ? 'entry logic on' : 'radar only'}
                  </span>
                }
              >
                <p className={`font-mono text-[11px] ${TONE_TEXT[zoneText(debug.zone).tone]}`}>{zoneText(debug.zone).text}</p>
                {debug.zone.entryLogic && (
                  <p className="mt-1 text-[11px] text-faint leading-relaxed">
                    ALERT needs an entry: a Wi-Fi side fires just before the radar sees them, or the radar first sees them far away (the radar side).
                  </p>
                )}
              </Section>
            )}

            {debug.links.length > 0 && (
              <Section title="Wi-Fi sides">
                {debug.links.map((link) => (
                  <LinkCard
                    key={link.id}
                    link={link}
                    canAdjust={mode === 'live' && isFresh && !running}
                    onAdjust={handleAdjust}
                  />
                ))}
                <p className="mt-2 text-[11px] text-faint leading-relaxed">
                  Walk outside the zone near a side: its activity should stay under the marker. If it goes over, press + on that side. Cross the side: it should go over.
                </p>
              </Section>
            )}

            <Section
              title="Radar"
              aside={<span className="font-mono text-[11px] text-muted">{debug.radar ? fmt(debug.radar.fps, 0, ' frames/s') : 'no data'}</span>}
            >
              {debug.radar ? (
                <RadarCard radar={debug.radar} />
              ) : (
                <p className="text-error font-mono text-[11px]">No radar data. Check its wiring and power.</p>
              )}
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
              </div>
            </Section>
          </div>
        )}

        {mode === 'live' && (
          <details className="rounded-[10px] border border-line bg-bg/40">
            <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted select-none">
              Raw message
            </summary>
            <pre className="px-3 pb-3 max-h-[320px] overflow-auto font-mono text-[11px] leading-snug text-muted whitespace-pre">
              {prettyJson(rawMessage)}
            </pre>
          </details>
        )}
      </div>
    </aside>
  );
}
