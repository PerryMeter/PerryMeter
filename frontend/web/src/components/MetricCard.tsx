import type { ConfidenceResult } from '../lib/confidence';

type ConfidenceCardProps = {
  confidence: ConfidenceResult;
  isFresh: boolean;
  lastMessageAt: number | null;
  now: number;
  onSelect?: () => void;
  compact?: boolean;
  className?: string;
};

/** Confidence in the current verdict, as a number, a 10-step bar and what it rests on. */
export function ConfidenceCard({ confidence, isFresh, lastMessageAt, now, onSelect, compact = false, className }: ConfidenceCardProps) {
  const value = confidence.value;
  const displayValue = value === null ? '--' : `${Math.round(value * 100)}%`;
  const normalized = value === null ? 0 : Math.max(0, Math.min(1, value));

  let caption: string;
  if (!isFresh) {
    caption = lastMessageAt !== null ? `Last seen ${Math.max(0, Math.round((now - lastMessageAt) / 1000))} s ago` : 'No data yet';
  } else if (confidence.basis.length > 0) {
    caption = compact ? confidence.basis[0] : confidence.basis.slice(0, 2).join('. ');
  } else {
    caption = 'Waiting for sensor numbers';
  }

  const Tag = onSelect ? 'button' : 'div';
  return (
    <Tag
      type={onSelect ? 'button' : undefined}
      onClick={onSelect}
      className={`text-left w-full rounded-[10px] border border-line bg-surface flex flex-col justify-between transition-opacity duration-200 ${
        className ?? 'p-5'
      } ${!isFresh ? 'opacity-40' : 'opacity-100'} ${onSelect ? 'hover:border-line-strong focus:outline-none focus-visible:ring-1 focus-visible:ring-text' : ''}`}
      aria-label={onSelect ? `Confidence ${displayValue}. Click for details` : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Confidence</span>
        <span className="text-[11px] text-faint font-mono">{confidence.source === 'dashboard' ? 'from sensor numbers' : confidence.source === 'hub' ? 'hub estimate' : ''}</span>
      </div>

      <div className="my-1">
        <span className="font-mono font-medium leading-none text-text tabular-nums" style={{ fontSize: compact ? 'clamp(28px, 5vh, 44px)' : 'clamp(32px, 5.5vh, 56px)' }}>
          {displayValue}
        </span>
      </div>

      <div className={`${compact ? 'mt-1 space-y-1' : 'mt-2 space-y-2'}`}>
        <div className="flex w-full h-2 gap-[3px]" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, i) => {
            const lit = value !== null && normalized >= (i + 1) / 10 - 0.05;
            return <div key={i} className={`flex-1 rounded-[2px] ${lit ? 'bg-text/70' : 'bg-surface-2'}`} />;
          })}
        </div>
        <p className={`text-muted font-mono leading-tight ${compact ? 'text-[11px] truncate' : 'text-xs'}`}>{caption}</p>
      </div>
    </Tag>
  );
}
