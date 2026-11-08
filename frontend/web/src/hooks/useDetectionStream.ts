import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertLevel, Detection, LinkState, NodeState } from '../lib/contract';
import { parseDetections } from '../lib/contract';
import { DemoSource } from '../lib/demoSource';
import type { HubDebug } from '../lib/hubDebug';
import { parseHubDebug } from '../lib/hubDebug';
import type { LiveSourceStatus } from '../lib/liveSource';
import { LiveSource } from '../lib/liveSource';
import type { Mode } from '../lib/settings';

export type LinkStatus =
  | 'demo'
  | 'demo-paused'
  | 'connecting'
  | 'waiting'
  | 'live'
  | 'stale'
  | 'disconnected'
  | 'invalid-url';

export type DetectionEvent = {
  startAt: number;
  endAt: number | null;
  peak: number;
  armed: boolean;
  side: string | null;
};

export type HistoryPoint = {
  at: number;
  strength: number;
  motion: boolean;
  alert: AlertLevel;
};

export type StreamState = {
  latest: Detection | null;
  history: HistoryPoint[];
  events: DetectionEvent[];
  status: LinkStatus;
  retryInS: number | null;
  lastMessageAt: number | null;
  messagesPerSecond: number;
  invalidCount: number;
  isFresh: boolean;
  now: number;
  alert: AlertLevel | null;
  distanceM: number | null;
  armed: boolean;
  links: LinkState[] | null;
  nodes: NodeState[] | null;
  /** The hub's raw sensor numbers from the latest message (kept when data goes stale). */
  debug: HubDebug | null;
  /** The latest message exactly as received, for the Sensors panel. */
  rawMessage: string | null;
};

export type SignalRefValue = {
  strength: number;
  motion: boolean;
  alert: AlertLevel;
  distanceM: number | null;
  isFresh: boolean;
  links: LinkState[] | null;
  nodes: NodeState[] | null;
};

export function useDetectionStream(mode: Mode, url: string, armed: boolean) {
  // Keep armed in a ref so changes do not restart sources
  const armedRef = useRef(armed);
  useEffect(() => {
    armedRef.current = armed;
  }, [armed]);

  // Underlying state kept in refs for performance
  const latestRef = useRef<Detection | null>(null);
  const historyRef = useRef<HistoryPoint[]>([]);
  const eventsRef = useRef<DetectionEvent[]>([]);
  const prevAlertRef = useRef<AlertLevel>('clear');
  const lastMessageAtRef = useRef<number | null>(null);
  const messageTimestampsRef = useRef<number[]>([]);
  const invalidCountRef = useRef(0);
  const retryInSRef = useRef<number | null>(null);
  const liveStatusRef = useRef<LiveSourceStatus>('disconnected');
  const isDemoPausedRef = useRef(false);
  const lastActiveSideRef = useRef<{ id: string; at: number } | null>(null);
  const debugRef = useRef<HubDebug | null>(null);
  const rawMessageRef = useRef<string | null>(null);

  // Direct ref for radar canvas 60fps reads
  const signalRef = useRef<SignalRefValue>({
    strength: 0,
    motion: false,
    alert: 'clear',
    distanceM: null,
    isFresh: false,
    links: null,
    nodes: null,
  });

  // Source instances
  const demoSourceRef = useRef<DemoSource | null>(null);
  const liveSourceRef = useRef<LiveSource | null>(null);

  // Published React state
  const [streamState, setStreamState] = useState<StreamState>(() => ({
    latest: null,
    history: [],
    events: [],
    status: mode === 'demo' ? 'demo' : 'connecting',
    retryInS: null,
    lastMessageAt: null,
    messagesPerSecond: 0,
    invalidCount: 0,
    isFresh: false,
    now: Date.now(),
    alert: null,
    distanceM: null,
    armed,
    links: null,
    nodes: null,
    debug: null,
    rawMessage: null,
  }));

  // Effect to manage data source: depends ONLY on [mode, url]
  useEffect(() => {
    // Reset data on mode/url switch
    latestRef.current = null;
    historyRef.current = [];
    eventsRef.current = [];
    prevAlertRef.current = 'clear';
    lastMessageAtRef.current = null;
    messageTimestampsRef.current = [];
    invalidCountRef.current = 0;
    retryInSRef.current = null;
    isDemoPausedRef.current = false;
    lastActiveSideRef.current = null;
    debugRef.current = null;
    rawMessageRef.current = null;
    signalRef.current = {
      strength: 0,
      motion: false,
      alert: 'clear',
      distanceM: null,
      isFresh: false,
      links: null,
      nodes: null,
    };

    const processRawMessage = (raw: string) => {
      const receivedAt = Date.now();
      const result = parseDetections(raw, receivedAt);
      invalidCountRef.current += result.invalid;
      if (result.detections.length > 0) {
        rawMessageRef.current = raw;
        debugRef.current = parseHubDebug(raw);
      }

      for (const detection of result.detections) {
        lastMessageAtRef.current = receivedAt;
        messageTimestampsRef.current.push(receivedAt);
        latestRef.current = detection;

        historyRef.current.push({
          at: detection.receivedAt,
          strength: detection.strength,
          motion: detection.motion,
          alert: detection.alert,
        });

        // Update memory of last active link
        if (detection.links !== null) {
          const movingLinks = detection.links.filter((l) => l.motion);
          if (movingLinks.length > 0) {
            const bestMoving = [...movingLinks].sort((a, b) => b.strength - a.strength)[0];
            lastActiveSideRef.current = {
              id: bestMoving.id,
              at: detection.receivedAt,
            };
          }
        }

        // Event tracking: starts when alert becomes 'inside', ends when it leaves 'inside'
        const isInside = detection.alert === 'inside';
        const wasInside = prevAlertRef.current === 'inside';

        if (isInside && !wasInside) {
          let side: string | null = null;
          if (
            lastActiveSideRef.current !== null &&
            detection.receivedAt - lastActiveSideRef.current.at <= 5000
          ) {
            side = lastActiveSideRef.current.id;
          }

          eventsRef.current = [
            {
              startAt: detection.receivedAt,
              endAt: null,
              peak: detection.strength,
              armed: armedRef.current,
              side,
            },
            ...eventsRef.current,
          ].slice(0, 8);
        } else if (isInside && wasInside) {
          if (eventsRef.current.length > 0 && eventsRef.current[0].endAt === null) {
            const first = eventsRef.current[0];
            const newPeak = Math.max(first.peak, detection.strength);
            if (newPeak !== first.peak) {
              eventsRef.current = [
                { ...first, peak: newPeak },
                ...eventsRef.current.slice(1),
              ];
            }
          }
        } else if (!isInside && wasInside) {
          if (eventsRef.current.length > 0 && eventsRef.current[0].endAt === null) {
            const first = eventsRef.current[0];
            eventsRef.current = [
              {
                ...first,
                endAt: detection.receivedAt,
                peak: Math.max(first.peak, detection.strength),
              },
              ...eventsRef.current.slice(1),
            ];
          }
        }
        prevAlertRef.current = detection.alert;

        // Update signal ref immediately for radar
        signalRef.current.strength = detection.strength;
        signalRef.current.motion = detection.motion;
        signalRef.current.alert = detection.alert;
        signalRef.current.distanceM = detection.distanceM;
        signalRef.current.links = detection.links;
        signalRef.current.nodes = detection.nodes;
        signalRef.current.isFresh = true;
      }
    };

    const processInvalidMessage = () => {
      invalidCountRef.current += 1;
    };

    let demo: DemoSource | null = null;
    let live: LiveSource | null = null;

    if (mode === 'demo') {
      demo = new DemoSource();
      demoSourceRef.current = demo;
      liveSourceRef.current = null;
      demo.start(processRawMessage);
    } else {
      live = new LiveSource();
      liveSourceRef.current = live;
      demoSourceRef.current = null;
      liveStatusRef.current = 'connecting';
      live.start(url, {
        onMessage: processRawMessage,
        onInvalidMessage: processInvalidMessage,
        onStatusChange: (status) => {
          liveStatusRef.current = status;
        },
        onRetryCountdown: (seconds) => {
          retryInSRef.current = seconds;
        },
      });
    }

    return () => {
      demo?.stop();
      live?.stop();
      demoSourceRef.current = null;
      liveSourceRef.current = null;
    };
  }, [mode, url]);

  // Periodic publish effect (every 100 ms)
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const lastAt = lastMessageAtRef.current;
      const isSocketOpen = liveStatusRef.current === 'open';
      const isFresh =
        mode === 'demo'
          ? lastAt !== null && now - lastAt <= 2000
          : isSocketOpen && lastAt !== null && now - lastAt <= 2000;

      // When data is no longer fresh, close any ongoing event immutably
      if (!isFresh) {
        if (eventsRef.current.length > 0 && eventsRef.current[0].endAt === null) {
          const first = eventsRef.current[0];
          eventsRef.current = [
            {
              ...first,
              endAt: lastAt ?? now,
            },
            ...eventsRef.current.slice(1),
          ];
        }
        prevAlertRef.current = 'clear';
      }

      // Prune message timestamps to last 5s and calculate rate
      const cutoff5s = now - 5000;
      messageTimestampsRef.current = messageTimestampsRef.current.filter(
        (t) => t >= cutoff5s,
      );
      const count = messageTimestampsRef.current.length;
      let mps = 0;
      if (count > 0) {
        const oldest = messageTimestampsRef.current[0];
        const span = Math.min(5, Math.max(1, (now - oldest) / 1000));
        mps = count / span;
      }

      // Prune history to last 60s, max 2000 points
      const cutoff60s = now - 60000;
      historyRef.current = historyRef.current
        .filter((point) => point.at >= cutoff60s)
        .slice(-2000);

      // Determine LinkStatus
      let currentStatus: LinkStatus;
      if (mode === 'demo') {
        currentStatus = isDemoPausedRef.current ? 'demo-paused' : 'demo';
      } else {
        const liveStatus = liveStatusRef.current;
        if (liveStatus === 'invalid-url') {
          currentStatus = 'invalid-url';
        } else if (liveStatus === 'disconnected') {
          currentStatus = 'disconnected';
        } else if (liveStatus === 'connecting') {
          currentStatus = 'connecting';
        } else if (lastAt === null) {
          currentStatus = 'waiting';
        } else if (isFresh) {
          currentStatus = 'live';
        } else {
          currentStatus = 'stale';
        }
      }

      // Sync signalRef freshness
      signalRef.current.isFresh = isFresh;
      if (!isFresh) {
        signalRef.current.motion = false;
        signalRef.current.alert = 'clear';
        signalRef.current.distanceM = null;
        signalRef.current.links = null;
        signalRef.current.nodes = null;
      }

      const activeAlert = isFresh && latestRef.current ? latestRef.current.alert : null;
      const activeDist = isFresh && latestRef.current ? latestRef.current.distanceM : null;
      const activeLinks = isFresh && latestRef.current ? latestRef.current.links : null;
      const activeNodes = isFresh && latestRef.current ? latestRef.current.nodes : null;

      setStreamState({
        latest: latestRef.current,
        history: [...historyRef.current],
        events: [...eventsRef.current],
        status: currentStatus,
        retryInS: retryInSRef.current,
        lastMessageAt: lastAt,
        messagesPerSecond: mps,
        invalidCount: invalidCountRef.current,
        isFresh,
        now,
        alert: activeAlert,
        distanceM: activeDist,
        armed: armedRef.current,
        links: activeLinks,
        nodes: activeNodes,
        debug: debugRef.current,
        rawMessage: rawMessageRef.current,
      });
    }, 100);

    return () => {
      clearInterval(timer);
    };
  }, [mode]);

  const triggerMovement = useCallback(() => {
    if (mode === 'demo') {
      demoSourceRef.current?.triggerMovement();
    }
  }, [mode]);

  const simulateEntry = useCallback(() => {
    if (mode === 'demo') {
      demoSourceRef.current?.simulateEntry();
    }
  }, [mode]);

  const setPaused = useCallback((paused: boolean) => {
    if (mode === 'demo') {
      isDemoPausedRef.current = paused;
      demoSourceRef.current?.setPaused(paused);
    }
  }, [mode]);

  /** Sends a command to the hub in Live mode (for example {type: 'calibrate'}). False if not sent. */
  const sendCommand = useCallback((command: Record<string, unknown>): boolean => {
    return liveSourceRef.current?.send(JSON.stringify(command)) ?? false;
  }, []);

  return {
    ...streamState,
    signalRef,
    triggerMovement,
    simulateEntry,
    setPaused,
    sendCommand,
  };
}
