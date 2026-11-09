import { useState } from 'react';
import type { HubCalibration, HubDebug } from '../lib/hubDebug';

type CalibrateControlProps = {
  debug: HubDebug | null;
  isFresh: boolean;
  sendCommand: (command: Record<string, unknown>) => boolean;
  className?: string;
};

const PRIMARY =
  'px-4 py-2 rounded-[6px] border border-line-strong bg-surface-2 text-text text-sm font-medium hover:border-text disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-line-strong focus:outline-none focus-visible:ring-1 focus-visible:ring-text';
const SECONDARY =
  'px-4 py-2 rounded-[6px] border border-line-strong bg-surface text-text text-sm hover:bg-surface-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-text';

/** "2026-11-08 22:43" -> "22:43" */
function clockPart(at: string | null): string | null {
  const m = at?.match(/(\d{1,2}:\d{2})$/);
  return m ? m[1] : null;
}

function describe(cal: HubCalibration | null, connected: boolean): { text: string; detail: string | null } {
  if (!connected || cal === null) return { text: 'Hub not connected', detail: 'Calibration needs the hub' };
  const at = clockPart(cal.at);
  switch (cal.state) {
    case 'countdown':
      return { text: `Leave the zone: ${Math.max(0, Math.ceil(cal.remainingS ?? 0))} s`, detail: 'Measuring starts after the countdown' };
    case 'measuring':
      return { text: 'Measuring the empty zone', detail: `Stay out for ${Math.max(0, Math.ceil(cal.remainingS ?? 0))} s` };
    case 'done':
      // The hub adds its problems after "Calibrated." (for example someone was in the radar's range)
      if (cal.message && cal.message !== 'Calibrated' && cal.message.startsWith('Calibrated.')) {
        return { text: 'Partly calibrated', detail: 'Keep everyone out of the zone and calibrate again' };
      }
      return { text: 'Calibrated', detail: at ? `At ${at}` : null };
    case 'failed':
      return { text: 'Calibration failed', detail: 'Keep everyone out of the zone and try again' };
    default:
      if (cal.message === 'Calibration cancelled') return { text: 'Calibration cancelled', detail: null };
      if (cal.at) return { text: 'Calibrated', detail: at ? `At ${at}` : null };
      return { text: 'Not calibrated', detail: 'Calibrate with the zone empty' };
  }
}

/** The Simple view's one action: calibrate the empty zone, with its progress in plain words. */
export function CalibrateControl({ debug, isFresh, sendCommand, className }: CalibrateControlProps) {
  const [sendError, setSendError] = useState<string | null>(null);
  const cal = debug?.calibration ?? null;
  const connected = debug !== null && isFresh;
  const running = cal?.state === 'countdown' || cal?.state === 'measuring';
  const { text, detail } = describe(cal, connected);

  const send = (type: string) => {
    setSendError(sendCommand({ type }) ? null : 'Not connected to the hub');
  };

  return (
    <div className={`rounded-[10px] border border-line bg-surface px-4 py-3 flex items-center justify-between gap-3 ${className ?? ''}`}>
      <div className="min-w-0">
        <div className="text-sm text-text" aria-live="polite">
          {text}
        </div>
        {(sendError ?? detail) && <div className="text-xs text-muted truncate">{sendError ?? detail}</div>}
      </div>
      {running ? (
        <button type="button" className={SECONDARY} onClick={() => send('cancel_calibration')}>
          Cancel
        </button>
      ) : (
        <button type="button" className={PRIMARY} disabled={!connected} onClick={() => send('calibrate')}>
          Calibrate
        </button>
      )}
    </div>
  );
}
