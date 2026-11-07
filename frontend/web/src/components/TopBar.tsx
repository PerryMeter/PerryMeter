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
  onModeChange: (mode: Mode) => void;
};

export function TopBar({
  mode,
  status,
  retryInS,
  lastMessageAt,
  now,
  onModeChange,
}: TopBarProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line">
      {/* Brand logo & title */}
      <div className="flex items-center gap-2.5">
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="#3DD6B0"
          strokeWidth="2"
          strokeLinecap="round"
          className="shrink-0"
          aria-hidden="true"
        >
          <path d="M 4 16 A 5 5 0 0 1 9 21" />
          <path d="M 4 11 A 10 10 0 0 1 14 21" />
          <path d="M 4 6 A 15 15 0 0 1 19 21" />
        </svg>
        <span className="font-semibold text-[18px] text-text tracking-tight">
          RadarPing
        </span>
        <span className="text-muted text-xs hidden md:inline font-normal">
          Wi-Fi CSI motion monitor
        </span>
      </div>

      {/* Controls & Status */}
      <div className="flex flex-wrap items-center gap-4">
        <ModeSwitch mode={mode} onChange={onModeChange} />
        <LinkStatusPill
          status={status}
          retryInS={retryInS}
          lastMessageAt={lastMessageAt}
          now={now}
        />
        <span className="font-mono text-xs text-muted hidden md:inline tabular-nums">
          {formatClock(now)}
        </span>
      </div>
    </header>
  );
}
