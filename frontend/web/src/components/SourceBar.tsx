import { useState } from 'react';
import type { Mode } from '../lib/settings';

type SourceBarProps = {
  mode: Mode;
  wsUrl: string;
  isPaused: boolean;
  retryInS: number | null;
  onSimulateMovement: () => void;
  onTogglePause: () => void;
  onApplyWsUrl: (url: string) => void;
};

export function SourceBar({
  mode,
  wsUrl,
  isPaused,
  retryInS,
  onSimulateMovement,
  onTogglePause,
  onApplyWsUrl,
}: SourceBarProps) {
  const [inputUrl, setInputUrl] = useState(wsUrl);
  const [urlError, setUrlError] = useState<string | null>(null);

  const handleApply = () => {
    const trimmed = inputUrl.trim();
    let valid = false;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
        valid = true;
      }
    } catch {
      valid = false;
    }

    if (!valid) {
      setUrlError('Must start with ws:// or wss://');
      return;
    }

    setUrlError(null);
    onApplyWsUrl(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleApply();
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs">
      {mode === 'demo' ? (
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="px-2 py-0.5 rounded-[6px] border border-warn/50 font-mono text-[11px] text-warn tracking-wider uppercase"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, rgba(232, 193, 78, 0.08), rgba(232, 193, 78, 0.08) 4px, transparent 4px, transparent 8px)',
            }}
          >
            SIMULATED DATA
          </span>
          <button
            type="button"
            onClick={onSimulateMovement}
            className="px-3 py-1 rounded-[6px] border border-line-strong bg-surface text-text text-[13px] hover:bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
          >
            Simulate movement
          </button>
          <button
            type="button"
            onClick={onTogglePause}
            className="px-3 py-1 rounded-[6px] border border-line-strong bg-surface text-text text-[13px] hover:bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
          >
            {isPaused ? 'Resume feed' : 'Pause feed'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1 w-full max-w-lg">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted tracking-wider uppercase shrink-0">
              ENDPOINT
            </span>
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => {
                setInputUrl(e.target.value);
                if (urlError) setUrlError(null);
              }}
              onKeyDown={handleKeyDown}
              className="flex-1 px-2.5 py-1 rounded-[6px] border border-line bg-surface-2 text-text font-mono text-xs focus:outline-none focus:border-accent"
              placeholder="ws://localhost:8765"
            />
            <button
              type="button"
              onClick={handleApply}
              className="px-3 py-1 rounded-[6px] border border-line-strong bg-surface text-text text-[13px] hover:bg-surface-2 focus:outline-none focus:ring-1 focus:ring-accent transition-colors shrink-0"
            >
              Apply
            </button>
            {retryInS !== null && (
              <span className="font-mono text-xs text-muted shrink-0 tabular-nums">
                retrying in {retryInS} s
              </span>
            )}
          </div>
          {urlError && (
            <span className="text-error font-mono text-xs">{urlError}</span>
          )}
        </div>
      )}
    </div>
  );
}
