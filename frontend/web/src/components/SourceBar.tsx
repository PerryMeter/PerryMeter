import type { Mode } from '../lib/settings';

type SourceBarProps = {
  mode: Mode;
  wsUrl: string;
  isPaused: boolean;
  retryInS: number | null;
  onSimulateEntry: () => void;
  onTogglePause: () => void;
  onOpenConnection: () => void;
};

const BUTTON =
  'px-3 py-1 rounded-[6px] border border-line-strong bg-surface text-text text-[13px] hover:bg-surface-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-text transition-colors';

/** One line under the top bar: the data source, and the demo controls in Demo mode. */
export function SourceBar({ mode, wsUrl, isPaused, retryInS, onSimulateEntry, onTogglePause, onOpenConnection }: SourceBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs">
      {mode === 'demo' ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="px-2 py-0.5 rounded-[6px] border border-warn/50 font-mono text-[11px] text-warn tracking-wider uppercase">Simulated data</span>
          <button type="button" onClick={onSimulateEntry} className={BUTTON}>
            Simulate entry
          </button>
          <button type="button" onClick={onTogglePause} className={BUTTON}>
            {isPaused ? 'Resume feed' : 'Pause feed'}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted">
          <span className="tracking-wider uppercase">Hub</span>
          <span className="text-text">{wsUrl}</span>
          {retryInS !== null && <span className="tabular-nums">retrying in {retryInS} s</span>}
          <button type="button" onClick={onOpenConnection} className="text-text underline underline-offset-2 hover:text-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-text">
            Change
          </button>
        </div>
      )}
    </div>
  );
}
