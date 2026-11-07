type MetricCardProps = {
  type: 'strength' | 'confidence';
  value: number | null;
  motion: boolean;
  isFresh: boolean;
  lastMessageAt: number | null;
  now: number;
  className?: string;
};

export function MetricCard({
  type,
  value,
  motion,
  isFresh,
  lastMessageAt,
  now,
  className,
}: MetricCardProps) {
  const isStrength = type === 'strength';
  const label = isStrength ? 'STRENGTH' : 'CONFIDENCE';

  // Value display
  let displayValue = '--';
  if (value !== null && Number.isFinite(value)) {
    displayValue = `${Math.round(value * 100)}%`;
  }

  // Caption display
  let caption = isStrength
    ? 'Movement intensity'
    : "Detector's estimate, not a validated probability";

  if (!isFresh) {
    if (lastMessageAt !== null) {
      const agoSec = Math.max(0, Math.round((now - lastMessageAt) / 1000));
      caption = `last seen ${agoSec} s ago`;
    } else {
      caption = 'No data yet';
    }
  }

  // Bar calculations
  const normalized = value !== null && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const percentWidth = Math.round(normalized * 100);

  return (
    <div
      className={`rounded-[10px] border border-line bg-surface flex flex-col justify-between transition-opacity duration-200 ${
        className ?? 'p-5'
      } ${!isFresh ? 'opacity-40' : 'opacity-100'}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          {label}
        </span>
      </div>

      <div className="my-1">
        <span
          className="font-mono font-medium leading-none text-text tabular-nums"
          style={{ fontSize: 'clamp(32px, 5.5vh, 56px)' }}
        >
          {displayValue}
        </span>
      </div>

      <div className="mt-2 space-y-2">
        {isStrength ? (
          /* Continuous fill bar with tick marks at 25, 50, 75% */
          <div className="relative w-full h-2 rounded-[4px] bg-surface-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-150 ease-linear ${
                motion ? 'bg-motion' : 'bg-accent'
              }`}
              style={{ width: `${percentWidth}%` }}
            />
            {/* Ticks at 25, 50, 75% */}
            <div className="absolute inset-0 pointer-events-none flex justify-between px-[25%]">
              <span className="w-px h-full bg-line" />
              <span className="w-px h-full bg-line" />
            </div>
          </div>
        ) : (
          /* 10 separate segments with 3px gaps */
          <div className="flex w-full h-2 gap-[3px]">
            {Array.from({ length: 10 }).map((_, i) => {
              const segmentThreshold = (i + 1) / 10;
              const isLit = value !== null && normalized >= segmentThreshold - 0.05;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-[2px] transition-colors duration-150 ${
                    isLit ? 'bg-text/70' : 'bg-surface-2'
                  }`}
                />
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted font-mono leading-tight">
          {caption}
        </p>
      </div>
    </div>
  );
}
