import type { Mode } from '../lib/settings';

type StatusFooterProps = {
  mode: Mode;
  wsUrl: string;
  messagesPerSecond: number;
  lastMessageAt: number | null;
  invalidCount: number;
  now: number;
};

export function StatusFooter({
  mode,
  wsUrl,
  messagesPerSecond,
  lastMessageAt,
  invalidCount,
  now,
}: StatusFooterProps) {
  const sourceText = mode === 'demo' ? 'Source: Demo' : `Source: ${wsUrl}`;
  const rateText = `${messagesPerSecond.toFixed(1)} msg/s`;

  let lastMessageText = 'No messages yet';
  if (lastMessageAt !== null) {
    const elapsedSeconds = Math.max(0, (now - lastMessageAt) / 1000);
    lastMessageText = `Last message ${elapsedSeconds.toFixed(1)} s ago`;
  }

  const invalidText = `Invalid messages: ${invalidCount}`;
  const invalidColor = invalidCount > 0 ? 'text-warn' : 'text-faint';

  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 pt-2 border-t border-line font-mono text-xs text-faint shrink-0">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-1">
        <span>{sourceText}</span>
        <span className="tabular-nums">{rateText}</span>
        <span className="tabular-nums">{lastMessageText}</span>
      </div>
      <div>
        <span className={`${invalidColor} tabular-nums`}>{invalidText}</span>
      </div>
    </footer>
  );
}
