import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityGraph } from './components/ActivityGraph';
import { ArmDialog } from './components/ArmDialog';
import { DetailPanel } from './components/DetailPanel';
import { EventList } from './components/EventList';
import { ConfidenceCard } from './components/MetricCard';
import { NodesPanel } from './components/NodesPanel';
import { SensorPanel } from './components/SensorPanel';
import type { SettingsSection } from './components/SettingsPanel';
import { SettingsPanel } from './components/SettingsPanel';
import type { MapTarget } from './components/ZoneMap';
import { ZoneMap } from './components/ZoneMap';
import { SimpleView } from './components/SimpleView';
import { SourceBar } from './components/SourceBar';
import { StatusFooter } from './components/StatusFooter';
import { TopBar } from './components/TopBar';
import { ZoneCard } from './components/ZoneCard';
import { useDetectionStream } from './hooks/useDetectionStream';
import { ZoneAlarm } from './lib/alarm';
import type { Selection } from './lib/details';
import { buildDetail } from './lib/details';
import type { DashboardSettings, Mode, View } from './lib/settings';
import {
  getInitialArmed,
  getInitialMode,
  getInitialSensorsOpen,
  getInitialWsUrl,
  getViewOverride,
  applyThemeAttribute,
  isKioskMode,
  loadSettings,
  resolveTheme,
  saveMode,
  saveSensorsOpen,
  saveSettings,
  saveWsUrl,
} from './lib/settings';

export default function App() {
  const [isKiosk] = useState(() => isKioskMode());
  const [mode, setModeState] = useState<Mode>(() => getInitialMode());
  const [wsUrl, setWsUrlState] = useState<string>(() => getInitialWsUrl());
  // This browser's old saved arm state: only used with a hub that cannot arm (no debug.arm)
  const [localArmed] = useState<boolean>(() => getInitialArmed());
  // The PIN dialog: the state being asked for, or null when closed
  const [armTarget, setArmTarget] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<DashboardSettings>(() => {
    const loaded = loadSettings();
    applyThemeAttribute(resolveTheme(loaded.theme));
    return loaded;
  });
  const [isPaused, setIsPaused] = useState(false);
  const [sensorsOpen, setSensorsOpen] = useState<boolean>(() => getInitialSensorsOpen());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() => resolveTheme('system'));
  // ?view=simple|admin wins until the user switches; the saved choice is settings.view (default Simple)
  const [viewOverride, setViewOverride] = useState<View | null>(() => getViewOverride());
  const view: View = viewOverride ?? settings.view;

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
    links,
    nodes,
    signalRef,
    simulateEntry,
    setPaused,
    debug,
    rawMessage,
    sendCommand,
    confidence,
  } = useDetectionStream(mode, wsUrl, localArmed);

  // The hub keeps the arm state (changed only with the PIN), so every screen and the ringer agree
  const armed = debug?.arm ? debug.arm.armed : localArmed;

  // Theme: data-theme on <html> is set before the components read their colours; "system" follows the OS
  const resolvedTheme = settings.theme === 'system' ? systemTheme : settings.theme;
  applyThemeAttribute(resolvedTheme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSystemTheme(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Alarm instance, volume, and playback rule: only while sound is on, armed, fresh and ALERT
  useEffect(() => {
    const alarm = new ZoneAlarm();
    alarmRef.current = alarm;
    return () => {
      alarm.destroy();
      alarmRef.current = null;
    };
  }, []);
  useEffect(() => {
    alarmRef.current?.setVolume(settings.volume);
  }, [settings.volume]);
  useEffect(() => {
    if (!alarmRef.current) return;
    if (settings.soundOn && armed && isFresh && alert === 'inside') {
      alarmRef.current.start();
    } else {
      alarmRef.current.stop();
    }
  }, [settings.soundOn, armed, isFresh, alert]);
  // Browsers only allow audio after a user gesture: if sound was saved on, unlock it on the first one
  useEffect(() => {
    if (!settings.soundOn) return;
    const unlock = () => alarmRef.current?.init();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [settings.soundOn]);

  // In kiosk mode, hide the mouse cursor after 3 s without movement
  useEffect(() => {
    if (!isKiosk) return;
    let timer: ReturnType<typeof setTimeout>;
    const handleMouseMove = () => {
      document.documentElement.classList.remove('cursor-none');
      clearTimeout(timer);
      timer = setTimeout(() => document.documentElement.classList.add('cursor-none'), 3000);
    };
    timer = setTimeout(() => document.documentElement.classList.add('cursor-none'), 3000);
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

  const requestArm = (nextArmed: boolean) => {
    if (nextArmed !== armed) setArmTarget(nextArmed);
  };
  const closeArmDialog = useCallback(() => setArmTarget(null), []);

  const handleChangeSettings = (next: DashboardSettings) => {
    if (next.soundOn && !settings.soundOn) alarmRef.current?.init();
    setSettings(next);
    saveSettings(next);
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

  const handleToggleSensors = () => {
    const next = !sensorsOpen;
    setSensorsOpen(next);
    saveSensorsOpen(next);
    if (next) setSettingsOpen(false);
  };

  const openSettings = useCallback((section: SettingsSection | null = null) => {
    setSettingsSection(section);
    setSettingsOpen(true);
    setSensorsOpen(false);
    saveSensorsOpen(false);
    setSelection(null);
  }, []);

  const handleToggleSettings = () => {
    if (settingsOpen) {
      setSettingsOpen(false);
    } else {
      openSettings(null);
    }
  };

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeDetail = useCallback(() => setSelection(null), []);

  const switchView = (next: View) => {
    setViewOverride(null);
    handleChangeSettings({ ...settings, view: next });
    if (next === 'simple') {
      setSettingsOpen(false);
      setSelection(null);
      // Simple has no demo controls, so a paused demo feed would stay stuck
      if (isPaused) {
        setIsPaused(false);
        setPaused(false);
      }
    }
  };

  const handleMapSelect = (target: MapTarget) => {
    switch (target.kind) {
      case 'side':
        setSelection({ kind: 'side', id: target.id });
        break;
      case 'node':
        setSelection({ kind: 'node', id: target.id });
        break;
      case 'front':
        setSelection({ kind: 'front' });
        break;
      case 'hub':
        setSelection({ kind: 'hub' });
        break;
      case 'zone':
        setSelection({ kind: 'status' });
        break;
    }
  };

  const detailContent = useMemo(
    () =>
      selection
        ? buildDetail(selection, {
            debug,
            latest,
            alert,
            distanceM,
            events,
            links,
            nodes,
            confidence,
            units: settings.units,
            isFresh,
            now,
            armed,
          })
        : null,
    [selection, debug, latest, alert, distanceM, events, links, nodes, confidence, settings.units, isFresh, now, armed],
  );

  const themeKey = resolvedTheme;
  const units = settings.units;

  const rootLayout = isKiosk
    ? 'p-3 overflow-hidden justify-between'
    : view === 'simple'
      ? 'p-4 md:p-6 overflow-x-hidden overflow-y-auto min-[900px]:overflow-hidden'
      : 'p-4 md:p-6 overflow-x-hidden overflow-y-auto min-[1100px]:overflow-hidden';

  return (
    <div className={`min-h-[100dvh] h-[100dvh] flex flex-col ${rootLayout} bg-bg text-text`}>
      {view === 'simple' ? (
        <SimpleView
          mode={mode}
          status={status}
          retryInS={retryInS}
          lastMessageAt={lastMessageAt}
          now={now}
          isKiosk={isKiosk}
          isFresh={isFresh}
          alert={alert}
          distanceM={distanceM}
          armed={armed}
          latest={latest}
          events={events}
          history={history}
          nodes={nodes}
          signalRef={signalRef}
          themeKey={themeKey}
          units={units}
          debug={debug}
          sendCommand={sendCommand}
          onRequestArm={requestArm}
          onSwitchToAdmin={() => switchView('admin')}
        />
      ) : (
      <>
      <TopBar
        mode={mode}
        status={status}
        retryInS={retryInS}
        lastMessageAt={lastMessageAt}
        now={now}
        armed={armed}
        isKiosk={isKiosk}
        sensorsOpen={sensorsOpen}
        settingsOpen={settingsOpen}
        onModeChange={handleModeChange}
        onArmedChange={requestArm}
        onToggleSensors={handleToggleSensors}
        onToggleSettings={handleToggleSettings}
        onSwitchToSimple={() => switchView('simple')}
      />

      {!isKiosk && (
        <SourceBar
          mode={mode}
          wsUrl={wsUrl}
          isPaused={isPaused}
          retryInS={retryInS}
          onSimulateEntry={simulateEntry}
          onTogglePause={handleTogglePause}
          onOpenConnection={() => openSettings('connection')}
        />
      )}

      {!isKiosk && (
        <SensorPanel
          open={sensorsOpen}
          onClose={handleToggleSensors}
          onOpenSettings={() => openSettings('sensitivity')}
          mode={mode}
          status={status}
          isFresh={isFresh}
          debug={debug}
          rawMessage={rawMessage}
          units={units}
        />
      )}

      <SettingsPanel
        open={settingsOpen}
        section={settingsSection}
        onClose={closeSettings}
        settings={settings}
        onChangeSettings={handleChangeSettings}
        mode={mode}
        status={status}
        wsUrl={wsUrl}
        onApplyWsUrl={handleApplyWsUrl}
        isFresh={isFresh}
        debug={debug}
        sendCommand={sendCommand}
        compact={isKiosk}
      />

      <DetailPanel content={detailContent} onClose={closeDetail} onOpenSettings={openSettings} compact={isKiosk} />

      {isKiosk ? (
        /* KIOSK LAYOUT: the Pi's 7 inch screen (1024x600), no scrolling */
        <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-2 my-1">
          <div className="flex-1 min-h-0 min-w-0 flex items-stretch gap-3">
            <div className="h-full aspect-square shrink-0">
              <ZoneMap signalRef={signalRef} mode={mode} armed={armed} themeKey={themeKey} units={units} onSelect={handleMapSelect} className="p-3 w-full h-full" />
            </div>

            <div className="flex-1 min-w-0 h-full flex flex-col gap-2">
              <ZoneCard
                latest={latest}
                events={events}
                alert={alert}
                distanceM={distanceM}
                armed={armed}
                isFresh={isFresh}
                now={now}
                units={units}
                onSelect={() => setSelection({ kind: 'status' })}
                className="p-3 shrink-0"
              />
              <div className="shrink-0">
                <ConfidenceCard
                  confidence={confidence}
                  isFresh={isFresh}
                  lastMessageAt={lastMessageAt}
                  now={now}
                  compact
                  onSelect={() => setSelection({ kind: 'confidence' })}
                  className="p-3"
                />
              </div>
              <EventList events={events} onSelect={(startAt) => setSelection({ kind: 'event', startAt })} className="flex-1 min-h-0" />
            </div>
          </div>

          <ActivityGraph history={history} now={now} isFresh={isFresh} isKiosk themeKey={themeKey} className="h-[110px] min-w-0 my-0 shrink-0" />
        </div>
      ) : (
        /* REGULAR LAYOUT (wide 3 columns, narrow 1 column) */
        <>
          <div className="flex-1 w-full my-2 min-[1100px]:min-h-0 min-[1100px]:[container-type:size]">
            <div className="flex flex-col gap-4 min-[1100px]:grid min-[1100px]:grid-cols-[min(100cqh,40cqw)_minmax(0,1.4fr)_minmax(0,1fr)] min-[1100px]:grid-rows-[minmax(0,1fr)] min-[1100px]:gap-4 min-[1100px]:h-full min-[1100px]:w-full min-[1100px]:items-stretch">
              <ZoneMap signalRef={signalRef} mode={mode} armed={armed} themeKey={themeKey} units={units} onSelect={handleMapSelect} />

              <div className="order-1 md:order-2 min-[1100px]:order-none flex flex-col gap-4 self-start w-full">
                <ZoneCard
                  latest={latest}
                  events={events}
                  alert={alert}
                  distanceM={distanceM}
                  armed={armed}
                  isFresh={isFresh}
                  now={now}
                  units={units}
                  onSelect={() => setSelection({ kind: 'status' })}
                />
                <ConfidenceCard
                  confidence={confidence}
                  isFresh={isFresh}
                  lastMessageAt={lastMessageAt}
                  now={now}
                  onSelect={() => setSelection({ kind: 'confidence' })}
                />
              </div>

              <div className="order-5 md:order-5 min-[1100px]:order-none h-full min-h-[300px] min-[1100px]:min-h-0 flex flex-col gap-3">
                {settings.showNodes && (
                  /* When data stops, keep showing the last known nodes (dimmed by the panel) */
                  <NodesPanel
                    nodes={isFresh ? nodes : (latest?.nodes ?? null)}
                    links={isFresh ? links : (latest?.links ?? null)}
                    isFresh={isFresh}
                    onSelect={(id) => setSelection({ kind: 'node', id })}
                  />
                )}
                {settings.showEvents && (
                  <EventList events={events} onSelect={(startAt) => setSelection({ kind: 'event', startAt })} className="flex-1 min-h-[180px]" />
                )}
              </div>
            </div>
          </div>

          {settings.showActivity && (
            <div className="w-full min-w-0 shrink-0">
              <ActivityGraph history={history} now={now} isFresh={isFresh} themeKey={themeKey} />
            </div>
          )}

          <StatusFooter mode={mode} wsUrl={wsUrl} messagesPerSecond={messagesPerSecond} lastMessageAt={lastMessageAt} invalidCount={invalidCount} now={now} />
        </>
      )}
      </>
      )}

      {armTarget !== null && (
        <ArmDialog key={String(armTarget)} target={armTarget} arm={debug?.arm ?? null} isFresh={isFresh} sendCommand={sendCommand} onClose={closeArmDialog} />
      )}
    </div>
  );
}
