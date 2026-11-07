import { useEffect, useRef, useState } from 'react';
import { ActivityGraph } from './components/ActivityGraph';
import { EventList } from './components/EventList';
import { MetricCard } from './components/MetricCard';
import { RadarScope } from './components/RadarScope';
import { SourceBar } from './components/SourceBar';
import { StatusFooter } from './components/StatusFooter';
import { TopBar } from './components/TopBar';
import { ZoneCard } from './components/ZoneCard';
import { useDetectionStream } from './hooks/useDetectionStream';
import { ZoneAlarm } from './lib/alarm';
import type { Mode } from './lib/settings';
import {
  getInitialArmed,
  getInitialMode,
  getInitialWsUrl,
  isKioskMode,
  saveArmed,
  saveMode,
  saveWsUrl,
} from './lib/settings';

export default function App() {
  const [isKiosk] = useState(() => isKioskMode());
  const [mode, setModeState] = useState<Mode>(() => getInitialMode());
  const [wsUrl, setWsUrlState] = useState<string>(() => getInitialWsUrl());
  const [armed, setArmedState] = useState<boolean>(() => getInitialArmed());
  const [soundOn, setSoundOn] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const alarmRef = useRef<ZoneAlarm | null>(null);

  const {
    status,
    latest,
    history,
    isFresh,
    messagesPerSecond,
    events,
    invalidCount,
    retryInS,
    lastMessageAt,
    now,
    alert,
    distanceM,
    signalRef,
    simulateEntry,
    setPaused,
  } = useDetectionStream(mode, wsUrl, armed);

  // Initialize and clean up alarm instance
  useEffect(() => {
    const alarm = new ZoneAlarm();
    alarmRef.current = alarm;
    return () => {
      alarm.destroy();
      alarmRef.current = null;
    };
  }, []);

  // Alarm playback rule: plays only while soundOn && armed && isFresh && alert === 'inside'
  useEffect(() => {
    if (!alarmRef.current) return;
    if (soundOn && armed && isFresh && alert === 'inside') {
      alarmRef.current.start();
    } else {
      alarmRef.current.stop();
    }
  }, [soundOn, armed, isFresh, alert]);

  // In kiosk mode, hide mouse cursor after 3 s of no movement
  useEffect(() => {
    if (!isKiosk) return;

    let timer: ReturnType<typeof setTimeout>;

    const handleMouseMove = () => {
      document.documentElement.classList.remove('cursor-none');
      clearTimeout(timer);
      timer = setTimeout(() => {
        document.documentElement.classList.add('cursor-none');
      }, 3000);
    };

    timer = setTimeout(() => {
      document.documentElement.classList.add('cursor-none');
    }, 3000);

    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', handleMouseMove);
      document.documentElement.classList.remove('cursor-none');
    };
  }, [isKiosk]);

  const handleModeChange = (newMode: Mode) => {
    setModeState(newMode);
    saveMode(newMode);
    setIsPaused(false);
  };

  const handleArmedChange = (nextArmed: boolean) => {
    setArmedState(nextArmed);
    saveArmed(nextArmed);
  };

  const handleToggleSound = () => {
    const nextSound = !soundOn;
    setSoundOn(nextSound);
    if (nextSound && alarmRef.current) {
      alarmRef.current.init();
    } else {
      alarmRef.current?.stop();
    }
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
    <div
      className={`min-h-[100dvh] h-[100dvh] flex flex-col ${
        isKiosk
          ? 'p-3 overflow-hidden justify-between'
          : 'p-4 md:p-6 overflow-x-hidden overflow-y-auto min-[1100px]:overflow-hidden'
      } bg-bg text-text selection:bg-accent selection:text-bg`}
    >
      <TopBar
        mode={mode}
        status={status}
        retryInS={retryInS}
        lastMessageAt={lastMessageAt}
        now={now}
        armed={armed}
        soundOn={soundOn}
        isKiosk={isKiosk}
        onModeChange={handleModeChange}
        onArmedChange={handleArmedChange}
        onToggleSound={handleToggleSound}
      />

      {!isKiosk && (
        <SourceBar
          mode={mode}
          wsUrl={wsUrl}
          isPaused={isPaused}
          retryInS={retryInS}
          onSimulateEntry={simulateEntry}
          onTogglePause={handleTogglePause}
          onApplyWsUrl={handleApplyWsUrl}
        />
      )}

      {isKiosk ? (
        /* KIOSK LAYOUT: 800x480 fit with no scrolling */
        <div className="flex-1 min-h-0 flex flex-col justify-between my-2">
          {/* Middle row: Radar on left, Cards on right */}
          <div className="flex-1 min-h-0 flex items-stretch gap-3">
            {/* Radar on left, sized to available height, stays square */}
            <div className="h-full aspect-square shrink-0">
              <RadarScope
                signalRef={signalRef}
                mode={mode}
                armed={armed}
                className="p-3 w-full h-full"
              />
            </div>

            {/* Right side: ZoneCard on top, Strength and Confidence side by side below */}
            <div className="flex-1 min-w-0 h-full flex flex-col justify-between gap-2">
              <ZoneCard
                latest={latest}
                events={events}
                alert={alert}
                distanceM={distanceM}
                armed={armed}
                isFresh={isFresh}
                now={now}
                className="p-3"
              />
              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  type="strength"
                  value={latest?.strength ?? null}
                  motion={isFresh && (latest?.motion ?? false)}
                  isFresh={isFresh}
                  lastMessageAt={lastMessageAt}
                  now={now}
                  className="p-3"
                />
                <MetricCard
                  type="confidence"
                  value={latest?.confidence ?? null}
                  motion={isFresh && (latest?.motion ?? false)}
                  isFresh={isFresh}
                  lastMessageAt={lastMessageAt}
                  now={now}
                  className="p-3"
                />
              </div>
            </div>
          </div>

          {/* Graph across bottom: 100px tall */}
          <ActivityGraph
            history={history}
            now={now}
            isFresh={isFresh}
            className="h-[100px] my-0 p-3 shrink-0"
          />
        </div>
      ) : (
        /* REGULAR LAYOUT (Wide 3-col, Tablet/Mobile 1-col) */
        <>
          {/* Main Content Area */}
          <div className="flex-1 min-h-0 w-full my-2 min-[1100px]:[container-type:size]">
            <div className="flex flex-col gap-4 min-[1100px]:grid min-[1100px]:grid-cols-[min(100cqh,40cqw)_minmax(0,1.4fr)_minmax(0,1fr)] min-[1100px]:grid-rows-[minmax(0,1fr)] min-[1100px]:gap-4 min-[1100px]:h-full min-[1100px]:w-full min-[1100px]:items-stretch">
              {/* Column 1: Radar Scope */}
              <RadarScope signalRef={signalRef} mode={mode} armed={armed} />

              {/* Column 2: Middle column - Zone Card + Metrics Row */}
              <div className="order-1 md:order-2 min-[1100px]:order-none flex flex-col gap-4 self-start w-full">
                <ZoneCard
                  latest={latest}
                  events={events}
                  alert={alert}
                  distanceM={distanceM}
                  armed={armed}
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

          {/* Activity Graph */}
          <ActivityGraph history={history} now={now} isFresh={isFresh} />

          <StatusFooter
            mode={mode}
            wsUrl={wsUrl}
            messagesPerSecond={messagesPerSecond}
            lastMessageAt={lastMessageAt}
            invalidCount={invalidCount}
            now={now}
          />
        </>
      )}
    </div>
  );
}
