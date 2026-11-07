import { useState } from 'react';
import { EventList } from './components/EventList';
import { MetricCard } from './components/MetricCard';
import { MovementCard } from './components/MovementCard';
import { SourceBar } from './components/SourceBar';
import { StatusFooter } from './components/StatusFooter';
import { TopBar } from './components/TopBar';
import { useDetectionStream } from './hooks/useDetectionStream';
import type { Mode } from './lib/settings';
import { getInitialMode, getInitialWsUrl, saveMode, saveWsUrl } from './lib/settings';

export default function App() {
  const [mode, setModeState] = useState<Mode>(() => getInitialMode());
  const [wsUrl, setWsUrlState] = useState<string>(() => getInitialWsUrl());
  const [isPaused, setIsPaused] = useState(false);

  const {
    status,
    latest,
    isFresh,
    messagesPerSecond,
    events,
    invalidCount,
    retryInS,
    lastMessageAt,
    now,
    triggerMovement,
    setPaused,
  } = useDetectionStream(mode, wsUrl);

  const handleModeChange = (newMode: Mode) => {
    setModeState(newMode);
    saveMode(newMode);
    setIsPaused(false);
  };

  const handleApplyWsUrl = (newUrl: string) => {
    setWsUrlState(newUrl);
    saveWsUrl(newUrl);
  };

  const handleTogglePause = () => {
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    setPaused(nextPaused);
  };

  return (
    <div className="min-h-[100dvh] min-[1100px]:h-[100dvh] flex flex-col p-4 md:p-6 overflow-x-hidden overflow-y-auto min-[1100px]:overflow-hidden bg-bg text-text selection:bg-accent selection:text-bg">
      <TopBar
        mode={mode}
        status={status}
        retryInS={retryInS}
        lastMessageAt={lastMessageAt}
        now={now}
        onModeChange={handleModeChange}
      />

      <SourceBar
        mode={mode}
        wsUrl={wsUrl}
        isPaused={isPaused}
        retryInS={retryInS}
        onSimulateMovement={triggerMovement}
        onTogglePause={handleTogglePause}
        onApplyWsUrl={handleApplyWsUrl}
      />

      {/* Main Content Area (Wide: 3 columns; Mobile/Tablet: vertical flow) */}
      <div className="flex-1 min-h-0 w-full my-2 min-[1100px]:[container-type:size]">
        <div className="flex flex-col gap-4 min-[1100px]:grid min-[1100px]:grid-cols-[min(100cqh,40cqw)_minmax(0,1.4fr)_minmax(0,1fr)] min-[1100px]:grid-rows-[minmax(0,1fr)] min-[1100px]:gap-4 min-[1100px]:h-full min-[1100px]:w-full min-[1100px]:items-stretch">
          {/* Column 1: Radar Scope Placeholder */}
          <div className="order-2 md:order-1 min-[1100px]:order-none relative flex items-center justify-center p-4 rounded-[10px] border border-line bg-surface aspect-square w-full h-full max-h-full max-w-[520px] min-[1100px]:max-w-none mx-auto min-[1100px]:m-0 min-h-0">
            {mode === 'demo' && (
              <span className="absolute top-3 right-3 font-mono text-[11px] text-warn uppercase tracking-wider">
                SIMULATED
              </span>
            )}
            <div className="text-center">
              <span className="font-mono text-sm tracking-widest text-faint">
                RADAR
              </span>
            </div>
          </div>

          {/* Column 2: Middle column - Movement Card + Metrics Row */}
          <div className="order-1 md:order-2 min-[1100px]:order-none flex flex-col gap-4 self-start w-full">
            <MovementCard
              latest={latest}
              events={events}
              isFresh={isFresh}
              now={now}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <MetricCard
                type="strength"
                value={latest?.strength ?? null}
                motion={isFresh && (latest?.motion ?? false)}
                isFresh={isFresh}
                lastMessageAt={lastMessageAt}
                now={now}
              />
              <MetricCard
                type="confidence"
                value={latest?.confidence ?? null}
                motion={isFresh && (latest?.motion ?? false)}
                isFresh={isFresh}
                lastMessageAt={lastMessageAt}
                now={now}
              />
            </div>
          </div>

          {/* Column 3: Event List - Full height of row, scrolls inside itself */}
          <div className="order-5 md:order-5 min-[1100px]:order-none h-full min-h-[160px] min-[1100px]:min-h-0 flex flex-col">
            <EventList events={events} className="h-full" />
          </div>
        </div>
      </div>

      {/* Activity Graph Placeholder */}
      <div className="rounded-[10px] border border-line bg-surface p-4 flex flex-col justify-between shrink-0 my-2 h-[140px] md:h-[160px] min-[1100px]:h-[clamp(140px,22vh,200px)]">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            ACTIVITY
          </span>
          <span className="text-xs text-muted font-mono">Last 60 s</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="font-mono text-xs text-faint">Waiting for data</span>
        </div>
      </div>

      <StatusFooter
        mode={mode}
        wsUrl={wsUrl}
        messagesPerSecond={messagesPerSecond}
        lastMessageAt={lastMessageAt}
        invalidCount={invalidCount}
        now={now}
      />
    </div>
  );
}
