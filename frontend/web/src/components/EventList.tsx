import type { DetectionEvent } from '../hooks/useDetectionStream';
import { formatClock, formatDuration } from '../lib/format';

type EventListProps = {
  events: DetectionEvent[];
  className?: string;
};

export function EventList({ events, className }: EventListProps) {
  const displayEvents = events.slice(0, 8);

  return (
    <div
      className={`p-5 rounded-[10px] border border-line bg-surface flex flex-col min-h-0 ${
        className ?? ''
      }`}
    >
      <div className="flex items-center justify-between pb-2 border-b border-line mb-2 shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          EVENTS
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 font-mono text-[13px] pr-1">
        {displayEvents.length === 0 ? (
          <p className="text-faint text-xs py-4 text-center">No movement yet</p>
        ) : (
          displayEvents.map((evt, index) => {
            const isOngoing = evt.endAt === null;
            const durationText = isOngoing
              ? 'ongoing'
              : formatDuration((evt.endAt! - evt.startAt) / 1000);
            const peakText = `peak ${Math.round(evt.peak * 100)}%`;

            return (
              <div
                key={evt.startAt || index}
                className="flex items-center justify-between py-1 border-b border-line/40 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span className="text-muted tabular-nums">
                    {formatClock(evt.startAt)}
                  </span>
                  <span className="text-text">Movement</span>
                </div>
                <div className="flex items-center gap-4">
                  <span
                    className={isOngoing ? 'text-motion font-medium' : 'text-muted tabular-nums'}
                  >
                    {durationText}
                  </span>
                  <span className="text-muted tabular-nums">{peakText}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
