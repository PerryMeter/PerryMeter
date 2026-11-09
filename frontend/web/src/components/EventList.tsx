import type { DetectionEvent } from '../hooks/useDetectionStream';
import { formatClock, formatDuration } from '../lib/format';

type EventListProps = {
  events: DetectionEvent[];
  onSelect?: (startAt: number) => void;
  className?: string;
};

export function EventList({ events, onSelect, className }: EventListProps) {
  const displayEvents = events.slice(0, 8);

  return (
    <div className={`p-5 rounded-[10px] border border-line bg-surface flex flex-col min-h-0 ${className ?? ''}`}>
      <div className="flex items-center justify-between pb-2 border-b border-line mb-2 shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Events</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1 font-mono text-[13px] pr-1">
        {displayEvents.length === 0 ? (
          <p className="text-faint text-xs py-4 text-center">No entries yet</p>
        ) : (
          displayEvents.map((evt, index) => {
            const isOngoing = evt.endAt === null;
            const durationText = isOngoing ? 'ongoing' : formatDuration((evt.endAt! - evt.startAt) / 1000);
            let entryLabel: string;
            if (evt.side === 'base') entryLabel = 'Entry from the front';
            else if (evt.side) entryLabel = `Entry from the ${evt.side} side`;
            else entryLabel = 'Entry';
            if (!evt.armed) entryLabel += ' (disarmed)';

            const Tag = onSelect ? 'button' : 'div';
            return (
              <Tag
                key={evt.startAt || index}
                type={onSelect ? 'button' : undefined}
                onClick={onSelect ? () => onSelect(evt.startAt) : undefined}
                className={`w-full flex items-center justify-between py-1 border-b border-line/40 last:border-0 text-left ${
                  onSelect ? 'hover:bg-surface-2 rounded-[4px] focus:outline-none focus-visible:ring-1 focus-visible:ring-text' : ''
                }`}
                aria-label={onSelect ? `${entryLabel} at ${formatClock(evt.startAt)}, click for details` : undefined}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-muted tabular-nums shrink-0">{formatClock(evt.startAt)}</span>
                  <span className="text-text truncate">{entryLabel}</span>
                </div>
                <span className={`shrink-0 ${isOngoing ? 'text-alert font-medium' : 'text-muted tabular-nums'}`}>{durationText}</span>
              </Tag>
            );
          })
        )}
      </div>
    </div>
  );
}
