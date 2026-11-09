import { useCallback, useRef, useState } from 'react';
import type { DetectionEvent, HistoryPoint, LinkStatus, SignalRefValue } from '../hooks/useDetectionStream';
import type { AlertLevel, Detection, NodeState } from '../lib/contract';
import { formatClock } from '../lib/format';
import type { HubDebug } from '../lib/hubDebug';
import type { Mode, Units } from '../lib/settings';
import { formatMetres } from '../lib/units';
import { ActivityGraph } from './ActivityGraph';
import { CalibrateControl } from './CalibrateControl';
import { LinkStatusPill } from './LinkStatusPill';
import { LogDrawer } from './LogDrawer';
import { ZoneMap } from './ZoneMap';

type SimpleViewProps = {
  mode: Mode;
  status: LinkStatus;
  retryInS: number | null;
  lastMessageAt: number | null;
  now: number;
  isKiosk: boolean;
  isFresh: boolean;
  alert: AlertLevel | null;
  distanceM: number | null;
  armed: boolean;
  latest: Detection | null;
  events: DetectionEvent[];
  history: HistoryPoint[];
  nodes: NodeState[] | null;
  signalRef: React.RefObject<SignalRefValue>;
  themeKey: string;
  units: Units;
  debug: HubDebug | null;
  sendCommand: (command: Record<string, unknown>) => boolean;
  onSwitchToAdmin: () => void;
};

const QUIET =
  'px-2 py-1 rounded-[6px] text-xs text-muted hover:text-text focus:outline-none focus-visible:ring-1 focus-visible:ring-text';

function noDataLine(status: LinkStatus, retryInS: number | null, lastMessageAt: number | null, now: number): string {
  switch (status) {
    case 'connecting':
      return 'Connecting to the hub';
    case 'waiting':
      return 'Connected, waiting for data';
    case 'stale':
      return `No data from the hub for ${lastMessageAt === null ? 0 : Math.max(0, Math.round((now - lastMessageAt) / 1000))} s`;
    case 'disconnected':
      return retryInS !== null ? `Hub not reachable, retrying in ${retryInS} s` : 'Hub not reachable';
    case 'invalid-url':
      return 'The hub address is not valid';
    case 'demo-paused':
      return 'Simulated feed paused';
    default:
      return 'Waiting for data';
  }
}

function ZoneStatus({
  alert,
  isFresh,
  armed,
  distanceM,
  latest,
  status,
  retryInS,
  lastMessageAt,
  now,
  units,
  className,
}: {
  alert: AlertLevel | null;
  isFresh: boolean;
  armed: boolean;
  distanceM: number | null;
  latest: Detection | null;
  status: LinkStatus;
  retryInS: number | null;
  lastMessageAt: number | null;
  now: number;
  units: Units;
  className?: string;
}) {
  let word = 'NO DATA';
  let wordColor = 'text-faint';
  let border = 'border-line';
  let line = noDataLine(status, retryInS, lastMessageAt, now);

  if (isFresh && alert !== null) {
    if (!armed) {
      word = 'DISARMED';
      wordColor = 'text-muted';
      line = alert === 'inside' ? 'Person in zone. The alarm is off' : 'The alarm is off. Entries are still logged';
    } else if (alert === 'inside') {
      word = 'ALERT';
      wordColor = 'text-alert';
      border = 'border-alert';
      line = distanceM !== null ? `Person in zone, ${formatMetres(distanceM, units)} from the hub` : 'Person in zone';
    } else if (alert === 'approach') {
      word = 'APPROACH';
      wordColor = 'text-warn';
      border = 'border-warn';
      const active = (latest?.links ?? []).filter((l) => l.motion).sort((a, b) => b.strength - a.strength)[0];
      line = active ? `Someone at the ${active.id} side` : 'Someone near the zone';
    } else {
      word = 'CLEAR';
      wordColor = 'text-text';
      line = 'Nobody in the zone';
    }
  }

  return (
    <section aria-label="Zone status" className={`rounded-[10px] border bg-surface px-5 py-4 flex flex-col justify-center ${border} ${className ?? ''}`}>
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Zone</span>
      <span
        className={`mt-1 font-mono font-medium leading-none ${wordColor}`}
        style={{ fontSize: 'clamp(44px, min(13vh, 10vw), 132px)' }}
        aria-live="polite"
      >
        {word}
      </span>
      <span className="mt-3 text-sm md:text-base text-muted">{line}</span>
    </section>
  );
}

const DEVICES: [id: string, label: string][] = [
  ['hub', 'Hub'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['radar', 'Radar'],
];

function Devices({ nodes, isFresh, className }: { nodes: NodeState[] | null; isFresh: boolean; className?: string }) {
  const connected = (id: string): boolean => {
    if (!isFresh) return false;
    const node = nodes?.find((n) => n.id === id);
    // Fresh data means the hub itself is sending, even from a server that reports no nodes
    if (id === 'hub') return node?.online ?? true;
    return node?.online ?? false;
  };
  return (
    <section aria-label="Devices" className={`rounded-[10px] border border-line bg-surface px-4 py-3 ${className ?? ''}`}>
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Devices</span>
      <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {DEVICES.map(([id, label]) => {
          const on = connected(id);
          return (
            <li key={id} className="flex items-center justify-between gap-2 min-w-0">
              <span className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${on ? 'bg-accent' : 'border border-muted'}`} aria-hidden="true" />
                <span className="text-text">{label}</span>
              </span>
              <span className={`text-xs shrink-0 ${on ? 'text-muted' : 'text-faint'}`}>{on ? 'Connected' : 'Not connected'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The everyday view: a big map, the zone status, calibrate, devices, activity, and a log drawer. */
export function SimpleView(props: SimpleViewProps) {
  const { mode, status, retryInS, lastMessageAt, now, isKiosk, isFresh, events, history, nodes, signalRef, themeKey, units, debug, sendCommand } = props;
  const [logOpen, setLogOpen] = useState(false);
  const [logSeenAt, setLogSeenAt] = useState(() => Date.now());
  const logButtonRef = useRef<HTMLButtonElement | null>(null);

  // Entries that started since the log was last open (the stream keeps the last 8)
  const newCount = logOpen ? 0 : events.filter((e) => e.startAt > logSeenAt).length;
  const openLog = () => {
    setLogSeenAt(Date.now());
    setLogOpen(true);
  };
  const closeLog = useCallback(() => {
    setLogSeenAt(Date.now());
    setLogOpen(false);
    // The drawer becomes inert, so keyboard focus goes back to the button that opened it
    logButtonRef.current?.focus();
  }, []);

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-line shrink-0">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" className="shrink-0 text-muted" aria-hidden="true">
            <polygon points="12,4 20,18 4,18" />
            <circle cx="12" cy="4" r="2" fill="currentColor" stroke="none" />
            <circle cx="4" cy="18" r="2" fill="currentColor" stroke="none" />
            <circle cx="20" cy="18" r="2" fill="currentColor" stroke="none" />
          </svg>
          <span className="font-semibold text-[18px] text-text tracking-tight">Perrymeter</span>
          {mode === 'demo' && (
            <span className="font-mono text-[10px] text-warn px-1.5 py-0.5 rounded-[4px] border border-warn/40 uppercase tracking-wider select-none">Simulated</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <LinkStatusPill status={status} retryInS={retryInS} lastMessageAt={lastMessageAt} now={now} />
          {!isKiosk && <span className="font-mono text-xs text-muted hidden md:inline tabular-nums">{formatClock(now)}</span>}
          <button
            ref={logButtonRef}
            type="button"
            onClick={openLog}
            aria-label={newCount > 0 ? `Log, ${newCount >= 8 ? 'at least 8' : newCount} new` : 'Log'}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[6px] border border-line-strong bg-surface text-text text-xs font-medium hover:bg-surface-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-text"
          >
            Log
            {newCount > 0 && <span className="min-w-[18px] px-1 rounded-[4px] bg-surface-2 text-text font-mono text-[11px] tabular-nums leading-[18px]">{newCount >= 8 ? '8+' : newCount}</span>}
          </button>
          <button type="button" onClick={props.onSwitchToAdmin} className={QUIET}>
            Admin
          </button>
        </div>
      </header>

      <main className={`flex-1 w-full ${isKiosk ? 'mt-2' : 'mt-3'} min-[900px]:min-h-0 min-[900px]:[container-type:size]`}>
        <div
          className={`flex flex-col ${isKiosk ? 'gap-2' : 'gap-3'} min-[900px]:grid min-[900px]:grid-cols-[min(100cqh,62cqw)_minmax(0,1fr)] min-[900px]:grid-rows-[minmax(0,1fr)] min-[900px]:h-full ${
            isKiosk ? 'min-[900px]:gap-3' : 'min-[900px]:gap-4'
          }`}
        >
          <div className="order-2 min-[900px]:order-none min-w-0 min-h-0 flex items-center justify-center">
            <ZoneMap
              signalRef={signalRef}
              mode={mode}
              armed={props.armed}
              themeKey={themeKey}
              units={units}
              className={`${isKiosk ? 'p-3' : 'p-4'} w-full max-w-[640px] min-[900px]:max-w-none min-[900px]:max-h-full`}
            />
          </div>

          <div className={`contents min-[900px]:flex min-[900px]:flex-col min-[900px]:min-h-0 min-[900px]:min-w-0 ${isKiosk ? 'min-[900px]:gap-2' : 'min-[900px]:gap-3'}`}>
            <ZoneStatus
              alert={props.alert}
              isFresh={isFresh}
              armed={props.armed}
              distanceM={props.distanceM}
              latest={props.latest}
              status={status}
              retryInS={retryInS}
              lastMessageAt={lastMessageAt}
              now={now}
              units={units}
              className="order-1 min-[900px]:order-none min-[900px]:flex-1 min-[900px]:min-h-0"
            />
            <CalibrateControl debug={debug} isFresh={isFresh} sendCommand={sendCommand} className="order-3 min-[900px]:order-none shrink-0" />
            <Devices nodes={nodes} isFresh={isFresh} className="order-3 min-[900px]:order-none shrink-0" />
            <div className="order-3 min-[900px]:order-none shrink-0 min-w-0">
              <ActivityGraph
                history={history}
                now={now}
                isFresh={isFresh}
                themeKey={themeKey}
                className={isKiosk ? 'p-3 h-[150px]' : 'p-4 h-[150px] min-[900px]:h-[clamp(130px,22vh,200px)]'}
              />
            </div>
          </div>
        </div>
      </main>

      <LogDrawer open={logOpen} onClose={closeLog} events={events} />
    </>
  );
}
