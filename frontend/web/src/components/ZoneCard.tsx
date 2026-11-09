import type { AlertLevel, Detection } from '../lib/contract';
import type { DetectionEvent } from '../hooks/useDetectionStream';
import type { Units } from '../lib/settings';
import { formatMetres } from '../lib/units';

type ZoneCardProps = {
  latest: Detection | null;
  events: DetectionEvent[];
  alert: AlertLevel | null;
  distanceM: number | null;
  armed: boolean;
  isFresh: boolean;
  now: number;
  units: Units;
  onSelect?: () => void;
  className?: string;
};

export function ZoneCard({ latest, events, alert, distanceM, armed, isFresh, now, units, onSelect, className }: ZoneCardProps) {
  let valueText = '--';
  let valueColor = 'text-faint';
  let captionText = 'No data';
  let cardStyles = 'border-line';

  if (isFresh && alert !== null) {
    if (!armed) {
      valueText = 'DISARMED';
      valueColor = 'text-muted';
      captionText = alert === 'inside' ? 'Person in zone, logged only' : 'Entries are logged without an alarm';
    } else if (alert === 'inside') {
      valueText = 'ALERT';
      valueColor = 'text-alert';
      const ongoingEvent = events.length > 0 && events[0].endAt === null ? events[0] : null;
      const durationSec = ongoingEvent ? Math.max(0, (now - ongoingEvent.startAt) / 1000) : 0;
      const notMovingSuffix = latest?.motion === false ? ', not moving' : '';
      const side = ongoingEvent?.side ?? null;
      const fromSuffix = side === 'base' ? ', from the front' : side ? `, from the ${side} side` : '';
      const distSuffix = distanceM !== null ? `, ${formatMetres(distanceM, units)} from the hub` : '';
      captionText = ongoingEvent
        ? `Person in zone for ${durationSec.toFixed(1)} s${fromSuffix}${distSuffix}${notMovingSuffix}`
        : `Person in zone${fromSuffix}${distSuffix}${notMovingSuffix}`;
      cardStyles = 'border-alert';
    } else if (alert === 'approach') {
      valueText = 'APPROACH';
      valueColor = 'text-warn';
      const movingLinks = (latest?.links ?? []).filter((l) => l.motion);
      if (movingLinks.length > 0) {
        const bestLink = [...movingLinks].sort((a, b) => b.strength - a.strength)[0];
        captionText = `Activity at the ${bestLink.id} side`;
      } else if (distanceM !== null) {
        captionText = `Someone near the zone, ${formatMetres(distanceM, units)} from the hub`;
      } else {
        captionText = 'Someone near the zone';
      }
      cardStyles = 'border-warn';
    } else {
      valueText = 'CLEAR';
      valueColor = 'text-text';
      const lastCompleted = events.find((e) => e.endAt !== null);
      if (lastCompleted && lastCompleted.endAt !== null) {
        const agoSec = Math.max(0, Math.round((now - lastCompleted.endAt) / 1000));
        captionText = `Zone clear. Last entry ${agoSec} s ago`;
      } else {
        captionText = 'Zone clear. No entries yet';
      }
    }
  }

  const Tag = onSelect ? 'button' : 'div';
  return (
    <Tag
      type={onSelect ? 'button' : undefined}
      onClick={onSelect}
      className={`text-left w-full rounded-[10px] border bg-surface flex flex-col justify-between transition-colors duration-200 ${
        className?.includes('p-') ? '' : 'p-5'
      } ${cardStyles} ${className ?? ''} ${onSelect ? 'focus:outline-none focus-visible:ring-1 focus-visible:ring-text' : ''}`}
      aria-label={onSelect ? `Zone status ${valueText}. Click for details` : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Zone</span>
        <span className="sr-only" aria-live="polite">
          {valueText}
        </span>
      </div>

      <div className="my-1">
        <span className={`font-mono font-medium leading-none ${valueColor}`} style={{ fontSize: 'clamp(48px, 8vh, 88px)' }}>
          {valueText}
        </span>
      </div>

      <div>
        <p className="text-xs text-muted font-mono">{captionText}</p>
      </div>
    </Tag>
  );
}
