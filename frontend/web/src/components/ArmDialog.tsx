import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubArm } from '../lib/hubDebug';

const PIN_LENGTH = 4;
/** How long to wait for the hub to show the new state before giving up. */
const ANSWER_TIMEOUT_MS = 3000;

type ArmDialogProps = {
  /** The state being asked for: true = arm, false = disarm. Mount it only while open. */
  target: boolean;
  arm: HubArm | null;
  isFresh: boolean;
  sendCommand: (command: Record<string, unknown>) => boolean;
  onClose: () => void;
};

const KEY =
  'h-14 rounded-[8px] border border-line-strong bg-surface-2 text-text text-xl font-medium tabular-nums hover:border-text active:bg-surface disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-text';
const KEY_QUIET =
  'h-14 rounded-[8px] border border-line bg-surface text-muted text-sm hover:text-text active:bg-surface-2 disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-text';

/** One PIN sent to the hub: its answer is the next messages (the new state, or one more rejection). */
type Attempt = { rejections: number; sentAt: number; timedOut: boolean };

/** Asks for the PIN, then waits for the hub to arm or disarm (the hub checks the PIN). */
export function ArmDialog({ target, arm, isFresh, sendCommand, onClose }: ArmDialogProps) {
  const [digits, setDigits] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const rejected = attempt !== null && arm !== null && arm.rejections > attempt.rejections;
  const succeeded = attempt !== null && !rejected && arm !== null && arm.armed === target;
  const timedOut = attempt !== null && attempt.timedOut && !rejected && !succeeded;
  const pending = attempt !== null && !rejected && !succeeded && !timedOut;

  useEffect(() => {
    if (succeeded) onClose();
  }, [succeeded, onClose]);

  useEffect(() => {
    if (!pending || attempt === null) return;
    const timer = setTimeout(
      () => setAttempt((a) => (a === null ? a : { ...a, timedOut: true })),
      Math.max(0, attempt.sentAt + ANSWER_TIMEOUT_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pending, attempt]);

  const submit = (pin: string) => {
    if (!isFresh) {
      setLocalError('Not connected to the hub');
    } else if (arm === null) {
      setLocalError('This hub cannot arm or disarm. Update the hub');
    } else if (arm.lockedS > 0) {
      setLocalError(`Too many wrong PINs. Try again in ${Math.ceil(arm.lockedS)} s`);
    } else if (!sendCommand({ type: 'set_armed', armed: target, pin })) {
      setLocalError('Not connected to the hub');
    } else {
      setAttempt({ rejections: arm.rejections, sentAt: Date.now(), timedOut: false });
      return;
    }
    setDigits('');
  };

  // After a refused or unanswered PIN, the next key starts over
  const press = (d: string) => {
    if (pending) return;
    const current = attempt !== null ? '' : digits;
    if (current.length >= PIN_LENGTH) return;
    setAttempt(null);
    setLocalError(null);
    const next = current + d;
    setDigits(next);
    if (next.length === PIN_LENGTH) submit(next);
  };

  const erase = (all: boolean) => {
    if (pending) return;
    if (attempt !== null) {
      setAttempt(null);
      setDigits('');
      return;
    }
    setDigits((cur) => (all ? '' : cur.slice(0, -1)));
  };

  const pressRef = useRef(press);
  const eraseRef = useRef(erase);
  useEffect(() => {
    pressRef.current = press;
    eraseRef.current = erase;
  });
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (/^[0-9]$/.test(e.key)) pressRef.current(e.key);
      else if (e.key === 'Backspace') eraseRef.current(false);
      else return;
      e.preventDefault();
    },
    [onClose],
  );
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  let message = localError ?? 'Enter the PIN';
  if (pending) message = target ? 'Arming' : 'Disarming';
  else if (rejected) message = arm !== null && arm.lockedS > 0 ? `Wrong PIN. Too many tries: wait ${Math.ceil(arm.lockedS)} s` : 'Wrong PIN';
  else if (timedOut) message = 'No answer from the hub. Try again';
  const isError = rejected || timedOut || localError !== null;
  const shown = rejected || timedOut ? 0 : digits.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="arm-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-[min(340px,100%)] rounded-[10px] border border-line-strong bg-surface p-5 focus:outline-none"
      >
        <h2 id="arm-dialog-title" className="text-base font-semibold text-text">
          {target ? 'Arm the zone' : 'Disarm the zone'}
        </h2>
        <p className="mt-1 text-xs text-muted">
          {target ? 'The ringer will sound when someone enters' : 'Entries are still logged, without the alarm'}
        </p>

        <div className="mt-4 flex items-center justify-center gap-3" role="img" aria-label={`PIN, ${shown} of ${PIN_LENGTH} digits`}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span key={i} className={`w-3.5 h-3.5 rounded-full border ${i < shown ? 'bg-text border-text' : 'border-line-strong'}`} />
          ))}
        </div>
        <p className={`mt-2 h-4 text-center text-xs ${isError ? 'text-alert' : 'text-muted'}`} aria-live="polite">
          {message}
        </p>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" className={KEY} disabled={pending} onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <button type="button" className={KEY_QUIET} disabled={pending} onClick={() => erase(true)}>
            Clear
          </button>
          <button type="button" className={KEY} disabled={pending} onClick={() => press('0')}>
            0
          </button>
          <button type="button" className={KEY_QUIET} disabled={pending} onClick={() => erase(false)}>
            Delete
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full px-4 py-2 rounded-[6px] border border-line-strong bg-surface text-text text-sm hover:bg-surface-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-text"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
