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
  isKiosk?: boolean;
  sensorsOpen: boolean;
  settingsOpen: boolean;
  onModeChange: (mode: Mode) => void;
  onArmedChange: (armed: boolean) => void;
  onToggleSensors: () => void;
  onToggleSettings: () => void;
};

const BAR_BUTTON =
  'px-3 py-1 rounded-[6px] border text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-text';

export function TopBar({
  mode,
  status,
  retryInS,
  lastMessageAt,
  now,
  armed,
  isKiosk = false,
  sensorsOpen,
  settingsOpen,
  onModeChange,
  onArmedChange,
  onToggleSensors,
  onToggleSettings,
}: TopBarProps) {
  const toggleStyle = (on: boolean) => `${BAR_BUTTON} ${on ? 'border-line-strong bg-surface-2 text-text' : 'border-line-strong bg-surface text-text hover:bg-surface-2'}`;

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-line shrink-0">
      <div className="flex items-center gap-2.5">
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
          className="shrink-0 text-muted"
          aria-hidden="true"
        >
          <polygon points="12,4 20,18 4,18" />
          <circle cx="12" cy="4" r="2" fill="currentColor" stroke="none" />
          <circle cx="4" cy="18" r="2" fill="currentColor" stroke="none" />
          <circle cx="20" cy="18" r="2" fill="currentColor" stroke="none" />
        </svg>
        <span className="font-semibold text-[18px] text-text tracking-tight">Perrymeter</span>
        {!isKiosk && <span className="text-muted text-xs hidden md:inline font-normal">Work zone safety monitor</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {isKiosk ? (
          <>
            {mode === 'demo' && (
              <span className="font-mono text-[10px] text-warn px-2 py-0.5 rounded-[4px] border border-warn/40 uppercase tracking-wider select-none">
                Simulated data
              </span>
            )}
            <LinkStatusPill status={status} retryInS={retryInS} lastMessageAt={lastMessageAt} now={now} />
            <button type="button" onClick={onToggleSettings} aria-pressed={settingsOpen} className={toggleStyle(settingsOpen)}>
              Settings
            </button>
          </>
        ) : (
          <>
            <ModeSwitch mode={mode} onChange={onModeChange} />

            <div role="group" aria-label="Arm status" className="inline-flex rounded-[6px] border border-line bg-surface p-0.5 text-xs font-medium">
              <button
                type="button"
                aria-pressed={armed}
                onClick={() => onArmedChange(true)}
                className={`px-3 py-1 rounded-[4px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-text ${
                  armed ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
                }`}
              >
                Armed
              </button>
              <button
                type="button"
                aria-pressed={!armed}
                onClick={() => onArmedChange(false)}
                className={`px-3 py-1 rounded-[4px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-text ${
                  !armed ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
                }`}
              >
                Disarmed
              </button>
            </div>

            <LinkStatusPill status={status} retryInS={retryInS} lastMessageAt={lastMessageAt} now={now} />
            <span className="font-mono text-xs text-muted hidden md:inline tabular-nums">{formatClock(now)}</span>

            <button type="button" onClick={onToggleSensors} aria-pressed={sensorsOpen} className={toggleStyle(sensorsOpen)}>
              Sensors
            </button>
            <button type="button" onClick={onToggleSettings} aria-pressed={settingsOpen} className={toggleStyle(settingsOpen)}>
              Settings
            </button>
          </>
        )}
      </div>
    </header>
  );
}
