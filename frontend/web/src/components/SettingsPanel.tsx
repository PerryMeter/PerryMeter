import { useEffect, useRef, useState } from 'react';
import type { LinkStatus } from '../hooks/useDetectionStream';
import type { HubCalibration, HubDebug, HubLinkDebug } from '../lib/hubDebug';
import type { DashboardSettings, Mode, ThemeSetting, Units } from '../lib/settings';
import { cmToSmall, distanceUnitLabel, formatCm, smallToCm } from '../lib/units';

export type SettingsSection = 'display' | 'alarm' | 'connection' | 'hub' | 'sensitivity';

type SettingsPanelProps = {
  open: boolean;
  /** Scroll this section into view when opening. */
  section: SettingsSection | null;
  onClose: () => void;
  settings: DashboardSettings;
  onChangeSettings: (next: DashboardSettings) => void;
  mode: Mode;
  status: LinkStatus;
  wsUrl: string;
  onApplyWsUrl: (url: string) => void;
  isFresh: boolean;
  debug: HubDebug | null;
  sendCommand: (command: Record<string, unknown>) => boolean;
  compact?: boolean;
};

const BUTTON =
  'px-2.5 py-1 rounded-[6px] border border-line-strong bg-surface text-text text-xs hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-text';
const INPUT =
  'px-2 py-1 rounded-[6px] border border-line bg-surface-2 text-text font-mono text-xs tabular-nums focus:outline-none focus:border-line-strong disabled:opacity-40';

function Section({ id, title, children }: { id: SettingsSection; title: string; children: React.ReactNode }) {
  return (
    <section id={`settings-${id}`} className="rounded-[10px] border border-line bg-bg/40 p-3 scroll-mt-3">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted pb-1.5 mb-2.5 border-b border-line">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 pt-0.5">
        <div className="text-xs text-text">{label}</div>
        {hint && <div className="text-[11px] text-faint leading-snug">{hint}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-1.5">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex rounded-[6px] border border-line bg-surface p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-0.5 rounded-[4px] focus:outline-none focus-visible:ring-1 focus-visible:ring-text ${
            value === o.value ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-9 h-5 rounded-full border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-text ${
        on ? 'bg-text border-text' : 'bg-surface-2 border-line-strong'
      }`}
    >
      <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full transition-[left] ${on ? 'left-[18px] bg-bg' : 'left-[2px] bg-muted'}`} />
    </button>
  );
}

/**
 * A number the hub owns: the slider and the box follow the hub's value until the user touches
 * them, then the new value is sent (debounced) and the controls follow the hub again.
 */
function HubNumber({
  label,
  hint,
  value,
  min,
  max,
  step,
  digits,
  unit,
  disabled,
  resetTo,
  onCommit,
  onReset,
  readout,
}: {
  label: string;
  hint?: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  digits: number;
  unit?: string;
  disabled: boolean;
  resetTo: number | null;
  onCommit: (v: number) => void;
  onReset?: () => void;
  /** Live reading shown next to the value, for example "now 0.067". */
  readout?: string;
}) {
  const [local, setLocal] = useState<number | null>(value);
  const [editing, setEditing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const change = (v: number) => {
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(max, Math.max(min, v));
    setLocal(clamped);
    setEditing(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onCommit(clamped);
      timer.current = setTimeout(() => setEditing(false), 700);
    }, 250);
  };

  // While the user is editing, show their value; otherwise follow the hub
  const shown = editing ? local : value;
  const canReset = resetTo !== null && onReset !== undefined && value !== null && Math.abs(resetTo - value) > step / 2;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs text-text">{label}</span>
          {readout && <span className="ml-2 font-mono text-[11px] text-muted tabular-nums">{readout}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            className={`${INPUT} w-[84px] text-right`}
            value={shown === null ? '' : shown.toFixed(digits)}
            min={min}
            max={max}
            step={step}
            disabled={disabled || value === null}
            onChange={(e) => change(parseFloat(e.target.value))}
            aria-label={`${label} value`}
          />
          {unit && <span className="text-[11px] text-muted">{unit}</span>}
          {onReset && (
            <button type="button" className={BUTTON} disabled={disabled || !canReset} onClick={onReset} title={resetTo === null ? 'No calibrated value' : `Back to ${resetTo.toFixed(digits)}`}>
              Reset
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        className="w-full mt-1"
        min={min}
        max={max}
        step={step}
        value={shown ?? min}
        disabled={disabled || value === null}
        onChange={(e) => change(parseFloat(e.target.value))}
        aria-label={label}
      />
      {hint && <div className="text-[11px] text-faint leading-snug">{hint}</div>}
    </div>
  );
}

function calibrationLabel(cal: HubCalibration | null): string {
  if (!cal) return 'Unknown';
  switch (cal.state) {
    case 'countdown':
      return `Leave the zone: ${cal.remainingS === null ? '--' : Math.ceil(cal.remainingS)} s`;
    case 'measuring':
      return `Measuring: ${cal.remainingS === null ? '--' : Math.ceil(cal.remainingS)} s left`;
    case 'done':
      return 'Calibrated';
    case 'failed':
      return 'Failed';
    default:
      return 'Idle';
  }
}

function SideThreshold({ link, disabled, limits, send }: {
  link: HubLinkDebug;
  disabled: boolean;
  limits: [number, number];
  send: (cmd: Record<string, unknown>) => boolean;
}) {
  const lo = Math.max(limits[0], (link.baseline ?? 0) * 1.2);
  const hi = Math.min(limits[1], Math.max(0.4, (link.threshold ?? 0.15) * 2.5));
  const level = link.evidence !== null ? `level ${link.evidence.toFixed(2)}` : `now ${link.score === null ? '--' : link.score.toFixed(3)}`;
  return (
    <HubNumber
      label={`${link.id[0].toUpperCase()}${link.id.slice(1)} side threshold`}
      readout={`${level}${link.online ? '' : ', offline'}`}
      value={link.threshold}
      min={Number(lo.toFixed(3))}
      max={Number(hi.toFixed(3))}
      step={0.001}
      digits={3}
      disabled={disabled}
      resetTo={link.calibratedThreshold}
      onCommit={(v) => send({ type: 'set_threshold', side: link.id, value: v })}
      onReset={() => send({ type: 'reset_threshold', side: link.id })}
      hint={link.calibrated ? undefined : 'Default value: calibrate with the zone empty.'}
    />
  );
}

export function SettingsPanel({
  open,
  section,
  onClose,
  settings,
  onChangeSettings,
  mode,
  status,
  wsUrl,
  onApplyWsUrl,
  isFresh,
  debug,
  sendCommand,
  compact = false,
}: SettingsPanelProps) {
  const [inputUrl, setInputUrl] = useState(wsUrl);
  const [lastWsUrl, setLastWsUrl] = useState(wsUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // The applied address changed (for example from the URL bar): show it in the box
  if (wsUrl !== lastWsUrl) {
    setLastWsUrl(wsUrl);
    setInputUrl(wsUrl);
  }

  useEffect(() => {
    if (!open || !section) return;
    const el = document.getElementById(`settings-${section}`);
    el?.scrollIntoView({ block: 'start' });
  }, [open, section]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = <K extends keyof DashboardSettings>(key: K, value: DashboardSettings[K]) =>
    onChangeSettings({ ...settings, [key]: value });

  const send = (cmd: Record<string, unknown>): boolean => {
    const ok = sendCommand(cmd);
    setSendError(ok ? null : 'Not connected to the hub');
    return ok;
  };

  const hubSettings = debug?.settings ?? null;
  const cal = debug?.calibration ?? null;
  const running = cal?.state === 'countdown' || cal?.state === 'measuring';
  const hubReady = debug !== null && isFresh && !running;
  const units: Units = settings.units;
  const rangeLimits = hubSettings?.rangeLimitsCm ?? [100, 600];
  const radarLimits = hubSettings?.radarThresholdLimits ?? [5, 100];
  const linkLimits = hubSettings?.linkThresholdLimits ?? [0.02, 2];

  const applyUrl = () => {
    const trimmed = inputUrl.trim();
    let valid = false;
    try {
      const parsed = new URL(trimmed);
      valid = parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
    } catch {
      valid = false;
    }
    if (!valid) {
      setUrlError('Must start with ws:// or wss://');
      return;
    }
    setUrlError(null);
    onApplyWsUrl(trimmed);
  };

  return (
    <aside
      aria-label="Settings"
      className={`fixed inset-y-0 right-0 z-40 w-full flex flex-col bg-surface border-l border-line-strong ${compact ? 'max-w-[380px]' : 'max-w-[420px]'}`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-text">Settings</span>
          <span className="font-mono text-[11px] text-muted">{mode === 'demo' ? 'demo hub' : isFresh ? 'hub connected' : status}</span>
        </div>
        <button type="button" onClick={onClose} className={BUTTON}>
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        <Section id="display" title="Display">
          <Row label="Theme">
            <Segmented<ThemeSetting>
              ariaLabel="Theme"
              value={settings.theme}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'system', label: 'System' },
              ]}
              onChange={(v) => set('theme', v)}
            />
          </Row>
          <Row label="Units">
            <Segmented<Units>
              ariaLabel="Units"
              value={settings.units}
              options={[
                { value: 'metric', label: 'm, cm' },
                { value: 'imperial', label: 'ft, in' },
              ]}
              onChange={(v) => set('units', v)}
            />
          </Row>
          <Row label="Activity graph" hint="Last 60 s of strength">
            <Toggle on={settings.showActivity} onChange={(v) => set('showActivity', v)} label="Show the activity graph" />
          </Row>
          <Row label="Events list">
            <Toggle on={settings.showEvents} onChange={(v) => set('showEvents', v)} label="Show the events list" />
          </Row>
          <Row label="Nodes panel">
            <Toggle on={settings.showNodes} onChange={(v) => set('showNodes', v)} label="Show the nodes panel" />
          </Row>
          <p className="text-[11px] text-faint">Saved in this browser only. The kiosk layout always shows its fixed set of panels.</p>
        </Section>

        <Section id="alarm" title="Alarm">
          <Row label="Sound" hint="Plays while the zone is armed and shows ALERT">
            <Toggle on={settings.soundOn} onChange={(v) => set('soundOn', v)} label="Alarm sound" />
          </Row>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-text">Volume</span>
              <span className="font-mono text-[11px] text-muted tabular-nums">{Math.round(settings.volume * 100)}%</span>
            </div>
            <input
              type="range"
              className="w-full mt-1"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) => set('volume', parseFloat(e.target.value))}
              aria-label="Alarm volume"
            />
          </div>
        </Section>

        <Section id="connection" title="Connection">
          {mode === 'demo' ? (
            <p className="text-muted leading-relaxed">Demo mode uses simulated data and a simulated hub. Switch to Live in the top bar to connect to processing/hub.py.</p>
          ) : (
            <>
              <label className="block">
                <span className="text-xs text-text">Hub address</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={inputUrl}
                    onChange={(e) => {
                      setInputUrl(e.target.value);
                      if (urlError) setUrlError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyUrl();
                    }}
                    className={`${INPUT} flex-1 min-w-0`}
                    placeholder="ws://localhost:8765"
                  />
                  <button type="button" onClick={applyUrl} className={BUTTON}>
                    Apply
                  </button>
                </div>
              </label>
              {urlError && <p className="text-warn font-mono text-[11px]">{urlError}</p>}
              <p className="text-[11px] text-faint">Also set by ?ws=ws://host:8765 in the address bar.</p>
            </>
          )}
        </Section>

        <Section id="hub" title="Hub">
          <Row label="Serial speed" hint="Fixed in ESP1's firmware; changing it would break the link">
            <span className="font-mono text-xs text-text tabular-nums">{hubSettings?.baud ?? 921600} baud</span>
          </Row>
          {debug === null ? (
            <p className="text-muted leading-relaxed">
              {mode === 'demo' ? 'Waiting for the simulated hub.' : isFresh ? 'This server sends no settings. Only processing/hub.py does.' : 'Waiting for the hub. Is processing/hub.py running?'}
            </p>
          ) : (
            <>
              <HubNumber
                label="Detection range"
                readout={hubSettings ? `front limits ${formatCm(hubSettings.stillMaxCm, units)} still, ${formatCm(hubSettings.movingMaxCm, units)} moving` : undefined}
                value={hubSettings?.maxDistanceCm === null || hubSettings?.maxDistanceCm === undefined ? null : cmToSmall(hubSettings.maxDistanceCm, units)}
                min={cmToSmall(rangeLimits[0], units)}
                max={cmToSmall(rangeLimits[1], units)}
                step={1}
                digits={0}
                unit={distanceUnitLabel(units, true)}
                disabled={!hubReady || hubSettings === null}
                resetTo={hubSettings?.defaultMaxDistanceCm === null || hubSettings?.defaultMaxDistanceCm === undefined ? null : cmToSmall(hubSettings.defaultMaxDistanceCm, units)}
                onCommit={(v) => send({ type: 'set_range', max_cm: smallToCm(v, units) })}
                onReset={() => send({ type: 'set_range' })}
                hint="How far from the hub the radar counts a person. The front-line limits are fixed fractions of it (80% still, 85% moving). Default 220 cm for 2 m sides."
              />
            </>
          )}
        </Section>

        <Section id="sensitivity" title="Sensitivity">
          <Row label="Calibration" hint="Measures the empty zone and sets every threshold">
            <span className="font-mono text-[11px] text-muted" aria-live="polite">{calibrationLabel(cal)}</span>
          </Row>
          <div className="flex items-center gap-2">
            <button type="button" className={BUTTON} disabled={!hubReady} onClick={() => send({ type: 'calibrate' })}>
              Calibrate empty zone
            </button>
            {running && (
              <button type="button" className={BUTTON} onClick={() => send({ type: 'cancel_calibration' })}>
                Cancel
              </button>
            )}
            <button type="button" className={BUTTON} disabled={!hubReady || (debug?.links.length ?? 0) < 2} onClick={() => send({ type: 'swap_sides' })}>
              Swap left/right
            </button>
          </div>
          {cal?.message && <p className="font-mono text-[11px] text-muted">{cal.message}</p>}
          {cal?.at && !running && <p className="font-mono text-[11px] text-faint">Last calibration {cal.at}</p>}

          {debug && debug.links.length > 0 && (
            <div className="pt-2 border-t border-line space-y-3">
              {debug.links.map((link) => (
                <SideThreshold key={link.id} link={link} disabled={!hubReady} limits={linkLimits} send={send} />
              ))}
              <p className="text-[11px] text-faint leading-snug">
                Wi-Fi side threshold on the activity score. Lower is more sensitive. Walking just outside a side should stay under it; crossing it should go over.
              </p>
            </div>
          )}

          {debug && hubSettings && (
            <div className="pt-2 border-t border-line space-y-3">
              <HubNumber
                label="Radar movement threshold"
                readout={debug.radar ? `now ${Math.round(debug.radar.avgMoving ?? 0)}` : 'radar offline'}
                value={hubSettings.movingThreshold}
                min={radarLimits[0]}
                max={radarLimits[1]}
                step={1}
                digits={0}
                disabled={!hubReady}
                resetTo={hubSettings.calibratedMovingThreshold}
                onCommit={(v) => send({ type: 'set_radar_thresholds', moving: v })}
                onReset={() => send({ type: 'reset_radar_thresholds' })}
              />
              <HubNumber
                label="Radar stillness threshold"
                readout={debug.radar ? `now ${Math.round(debug.radar.avgStill ?? 0)}` : 'radar offline'}
                value={hubSettings.stillThreshold}
                min={radarLimits[0]}
                max={radarLimits[1]}
                step={1}
                digits={0}
                disabled={!hubReady}
                resetTo={hubSettings.calibratedStillThreshold}
                onCommit={(v) => send({ type: 'set_radar_thresholds', still: v })}
                onReset={() => send({ type: 'reset_radar_thresholds' })}
              />
              <p className="text-[11px] text-faint leading-snug">
                Energy 0 to 100, averaged over 1 s. A person counts when movement or stillness energy is at or above its threshold. An empty room reads about 2 to 5.
                {hubSettings.thresholdSource ? ` Source: ${hubSettings.thresholdSource}.` : ''}
              </p>
            </div>
          )}
          {sendError && <p className="text-warn font-mono text-[11px]">{sendError}</p>}
        </Section>
      </div>
    </aside>
  );
}
