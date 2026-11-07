import type { AlertLevel, Detection } from '../lib/contract';
import type { DetectionEvent } from '../hooks/useDetectionStream';

type ZoneCardProps = {
  latest: Detection | null;
  events: DetectionEvent[];
  alert: AlertLevel | null;
  distanceM: number | null;
  armed: boolean;
  isFresh: boolean;
  now: number;
  className?: string;
};

export function ZoneCard({
  events,
  alert,
  distanceM,
  armed,
  isFresh,
  now,
  className,
}: ZoneCardProps) {
  let valueText = '--';
  let valueColor = 'text-faint';
  let captionText = 'No data';
  let cardStyles = 'bg-surface border-line';
  let cardInlineStyle: React.CSSProperties = {};

  if (isFresh && alert !== null) {
    if (!armed) {
      // Disarmed state
      valueText = 'DISARMED';
      valueColor = 'text-muted';
      captionText =
        alert === 'inside'
          ? 'Person in zone, logged only'
          : 'Crossings are logged without an alarm';
      cardStyles = 'bg-surface border-line';
    } else if (alert === 'inside') {
      // ALERT state
      valueText = 'ALERT';
      valueColor = 'text-motion';
      const ongoingEvent =
        events.length > 0 && events[0].endAt === null ? events[0] : null;
      if (ongoingEvent) {
        const durationSec = Math.max(0, (now - ongoingEvent.startAt) / 1000);
        captionText = `Person in zone for ${durationSec.toFixed(1)} s`;
      } else {
        captionText = 'Person in zone';
      }
      cardStyles = 'border-motion/60 animate-alert-glow';
      cardInlineStyle = {
        backgroundColor:
          'color-mix(in srgb, var(--color-motion) 6%, var(--color-surface))',
      };
    } else if (alert === 'approach') {
      // APPROACH state
      valueText = 'APPROACH';
      valueColor = 'text-warn';
      if (distanceM !== null) {
        captionText = `Someone approaching, ${distanceM.toFixed(1)} m from the fence`;
      } else {
        captionText = 'Someone approaching';
      }
      cardStyles = 'bg-surface border-warn/50';
    } else {
      // CLEAR state
      valueText = 'CLEAR';
      valueColor = 'text-accent';
      const lastCompleted = events.find((e) => e.endAt !== null);
      if (lastCompleted && lastCompleted.endAt !== null) {
        const agoSec = Math.max(0, Math.round((now - lastCompleted.endAt) / 1000));
        captionText = `Zone clear. Last entry ${agoSec} s ago`;
      } else {
        captionText = 'Zone clear. No entries yet';
      }
      cardStyles = 'bg-surface border-line';
    }
  }

  return (
    <div
      className={`p-5 rounded-[10px] border flex flex-col justify-between transition-colors duration-200 ${cardStyles} ${
        className ?? ''
      }`}
      style={cardInlineStyle}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          ZONE
        </span>
        {/* Element for screen readers updated only on value text change */}
        <span className="sr-only" aria-live="polite">
          {valueText}
        </span>
      </div>

      <div className="my-1">
        <span
          className={`font-mono font-medium leading-none ${valueColor}`}
          style={{ fontSize: 'clamp(48px, 8vh, 88px)' }}
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
