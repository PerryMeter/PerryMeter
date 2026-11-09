import type { HubArm } from '../lib/hubDebug';

type ArmControlProps = {
  arm: HubArm | null;
  isFresh: boolean;
  /** Opens the PIN dialog for the state being asked for. */
  onRequest: (armed: boolean) => void;
  className?: string;
};

const PRIMARY =
  'px-4 py-2 rounded-[6px] border border-line-strong bg-surface-2 text-text text-sm font-medium hover:border-text disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-line-strong focus:outline-none focus-visible:ring-1 focus-visible:ring-text';

function describe(arm: HubArm | null, isFresh: boolean): { text: string; detail: string } {
  if (!isFresh) return { text: 'Hub not connected', detail: 'Arming needs the hub' };
  if (arm === null) return { text: 'Cannot arm', detail: 'Update the hub' };
  if (!arm.armed) return { text: 'Disarmed', detail: 'No alarm, still logged' };
  const ringer = arm.ringer;
  if (ringer?.sounding) return { text: 'Armed', detail: 'Ringing' };
  if (ringer && ringer.state !== 'ready') return { text: 'Armed', detail: 'Ringer not connected' };
  return { text: 'Armed', detail: 'Rings on ALERT' };
}

/** Armed or disarmed, with the button that asks for the PIN to change it. */
export function ArmControl({ arm, isFresh, onRequest, className }: ArmControlProps) {
  const { text, detail } = describe(arm, isFresh);
  const usable = isFresh && arm !== null;
  const armed = arm?.armed ?? false;

  return (
    <div className={`rounded-[10px] border border-line bg-surface px-4 py-3 flex items-center justify-between gap-3 ${className ?? ''}`}>
      <div className="min-w-0">
        <div className={`text-sm ${usable && !armed ? 'text-muted' : 'text-text'}`} aria-live="polite">
          {text}
        </div>
        <div className="text-xs text-muted truncate">{detail}</div>
      </div>
      <button type="button" className={PRIMARY} disabled={!usable} onClick={() => onRequest(!armed)}>
        {armed ? 'Disarm' : 'Arm'}
      </button>
    </div>
  );
}
