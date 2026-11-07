import type { LinkStatus } from '../hooks/useDetectionStream';
import { formatClock } from '../lib/format';
import type { Mode } from '../lib/settings';
import { LinkStatusPill } from './LinkStatusPill';
import { ModeSwitch } from './ModeSwitch';

type TopBarProps = {
  mode: Mode;
  status: LinkStatus;
  retryInS: number | null;
  lastMessageAt: number | null;
  now: number;
  armed: boolean;
  soundOn: boolean;
  isKiosk?: boolean;
  onModeChange: (mode: Mode) => void;
  onArmedChange: (armed: boolean) => void;
  onToggleSound: () => void;
};

export function TopBar({
  mode,
  status,
  retryInS,
  lastMessageAt,
  now,
  armed,
  soundOn,
  isKiosk = false,
  onModeChange,
  onArmedChange,
  onToggleSound,
}: TopBarProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-line shrink-0">
      {/* Brand logo & title */}
      <div className="flex items-center gap-2.5">
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="#3DD6B0"
          strokeWidth="1.75"
          strokeLinejoin="round"
          className="shrink-0"
          aria-hidden="true"
        >
          <polygon points="12,4 20,18 4,18" />
          <circle cx="12" cy="4" r="2" fill="#3DD6B0" stroke="none" />
          <circle cx="4" cy="18" r="2" fill="#3DD6B0" stroke="none" />
          <circle cx="20" cy="18" r="2" fill="#3DD6B0" stroke="none" />
        </svg>
        <span className="font-semibold text-[18px] text-text tracking-tight">
          Perrymeter
        </span>
        {!isKiosk && (
          <span className="text-muted text-xs hidden md:inline font-normal">
            Work zone safety monitor
          </span>
        )}
      </div>

      {/* Controls & Status */}
      <div className="flex flex-wrap items-center gap-3">
        {isKiosk ? (
          <>
            {mode === 'demo' && (
              <span className="font-mono text-[10px] text-warn px-2 py-0.5 rounded-[4px] border border-warn/40 bg-warn/10 uppercase tracking-wider select-none">
                SIMULATED DATA
              </span>
            )}
            <LinkStatusPill
              status={status}
              retryInS={retryInS}
              lastMessageAt={lastMessageAt}
              now={now}
            />
          </>
        ) : (
          <>
            <ModeSwitch mode={mode} onChange={onModeChange} />

            {/* Armed / Disarmed switch */}
            <div
              role="group"
              aria-label="Arm status"
              className="inline-flex rounded-[6px] border border-line bg-surface p-0.5 text-xs font-medium"
            >
              <button
                type="button"
                aria-pressed={armed}
                onClick={() => onArmedChange(true)}
                className={`px-3 py-1 rounded-[4px] transition-colors ${
                  armed ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
                }`}
              >
                Armed
              </button>
              <button
                type="button"
                aria-pressed={!armed}
                onClick={() => onArmedChange(false)}
                className={`px-3 py-1 rounded-[4px] transition-colors ${
                  !armed ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
                }`}
              >
                Disarmed
              </button>
            </div>

            {/* Sound button */}
            <button
              type="button"
              onClick={onToggleSound}
              className={`px-3 py-1 rounded-[6px] border border-line-strong text-xs font-medium transition-colors ${
                soundOn
                  ? 'bg-surface-2 text-text border-accent'
                  : 'bg-surface text-text hover:bg-surface-2'
              }`}
            >
              {soundOn ? 'Sound off' : 'Sound on'}
            </button>

            <LinkStatusPill
              status={status}
              retryInS={retryInS}
              lastMessageAt={lastMessageAt}
              now={now}
            />
            <span className="font-mono text-xs text-muted hidden md:inline tabular-nums">
              {formatClock(now)}
            </span>
          </>
        )}
      </div>
    </header>
  );
}
