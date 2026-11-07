import type { Detection } from '../lib/contract';
import type { DetectionEvent } from '../hooks/useDetectionStream';

type MovementCardProps = {
  latest: Detection | null;
  events: DetectionEvent[];
  isFresh: boolean;
  now: number;
  className?: string;
};

export function MovementCard({
  latest,
  events,
  isFresh,
  now,
  className,
}: MovementCardProps) {
  const isYes = isFresh && latest !== null && latest.motion;

  let valueText = '--';
  let valueColor = 'text-faint';
  let captionText = 'No data';

  if (isFresh && latest !== null) {
    if (isYes) {
      valueText = 'YES';
      valueColor = 'text-motion';
      const ongoingEvent = events.length > 0 && events[0].endAt === null ? events[0] : null;
      if (ongoingEvent) {
        const durationSec = Math.max(0, (now - ongoingEvent.startAt) / 1000);
        captionText = `Movement detected for ${durationSec.toFixed(1)} s`;
      } else {
        captionText = 'Movement detected';
      }
    } else {
      valueText = 'NO';
      valueColor = 'text-text';
      // Find most recent completed event
      const lastCompleted = events.find((e) => e.endAt !== null);
      if (lastCompleted && lastCompleted.endAt !== null) {
        const agoSec = Math.max(0, Math.round((now - lastCompleted.endAt) / 1000));
        captionText = `No movement. Last seen ${agoSec} s ago`;
      } else {
        captionText = 'No movement yet';
      }
    }
  }

  // Card appearance
  let cardStyles = 'bg-surface border-line';
  let cardInlineStyle: React.CSSProperties = {};

  if (isYes) {
    cardStyles =
      'border-motion/60 animate-[pulse_1.6s_ease-in-out_infinite]';
    cardInlineStyle = {
      backgroundColor: 'color-mix(in srgb, var(--color-motion) 6%, var(--color-surface))',
      boxShadow: '0 0 20px rgba(255, 138, 61, 0.25)',
    };
  }

  return (
    <div
      className={`p-5 rounded-[10px] border flex flex-col justify-between transition-colors duration-200 ${cardStyles} ${className ?? ''}`}
      style={cardInlineStyle}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          MOVEMENT
        </span>
        {/* Element for screen readers updated only on YES/NO status change */}
        <span className="sr-only" aria-live="polite">
          {valueText}
        </span>
      </div>

      <div className="my-1">
        <span
          className={`font-mono font-medium leading-none ${valueColor}`}
          style={{ fontSize: 'clamp(56px, 9vh, 96px)' }}
        >
          {valueText}
        </span>
      </div>

      <div>
        <p className="text-xs text-muted font-mono">{captionText}</p>
      </div>
    </div>
  );
}
