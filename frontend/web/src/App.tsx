import { useState } from 'react';
import { useDetectionStream } from './hooks/useDetectionStream';
import type { Mode } from './lib/settings';
import { getInitialMode, getInitialWsUrl, saveMode } from './lib/settings';

export default function App() {
  const [mode, setModeState] = useState<Mode>(() => getInitialMode());
  const [wsUrl] = useState<string>(() => getInitialWsUrl());
  const [isPaused, setIsPaused] = useState(false);

  const {
    status,
    latest,
    isFresh,
    messagesPerSecond,
    history,
    events,
    invalidCount,
    retryInS,
    triggerMovement,
    setPaused,
  } = useDetectionStream(mode, wsUrl);

  const handleSelectMode = (newMode: Mode) => {
    setModeState(newMode);
    saveMode(newMode);
    setIsPaused(false);
  };

  const handleTogglePause = () => {
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    setPaused(nextPaused);
  };

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold">RadarPing Debug View</h1>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleSelectMode('demo')}
          className={`px-3 py-1.5 rounded border text-sm ${
            mode === 'demo'
              ? 'bg-surface-2 border-accent text-text'
              : 'border-line text-muted'
          }`}
        >
          Demo
        </button>
        <button
          type="button"
          onClick={() => handleSelectMode('live')}
          className={`px-3 py-1.5 rounded border text-sm ${
            mode === 'live'
              ? 'bg-surface-2 border-accent text-text'
              : 'border-line text-muted'
          }`}
        >
          Live
        </button>
        <button
          type="button"
          onClick={triggerMovement}
          disabled={mode !== 'demo'}
          className="px-3 py-1.5 rounded border border-line-strong text-sm disabled:opacity-40"
        >
          Simulate movement
        </button>
        <button
          type="button"
          onClick={handleTogglePause}
          disabled={mode !== 'demo'}
          className="px-3 py-1.5 rounded border border-line-strong text-sm disabled:opacity-40"
        >
          {isPaused ? 'Resume feed' : 'Pause feed'}
        </button>
      </div>

      <pre className="p-4 rounded border border-line bg-surface font-mono text-xs overflow-auto leading-relaxed">
{JSON.stringify(
  {
    status,
    retryInS,
    isFresh,
    messagesPerSecond: Number(messagesPerSecond.toFixed(1)),
    historyLength: history.length,
    invalidCount,
    latest,
    events,
  },
  null,
  2,
)}
      </pre>
    </main>
  );
}
