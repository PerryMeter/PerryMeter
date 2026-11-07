import { useCallback, useEffect, useRef, useState } from 'react';
import type { Detection } from '../lib/contract';
import { parseDetections } from '../lib/contract';
import { DemoSource } from '../lib/demoSource';
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
};

export type HistoryPoint = {
  at: number;
  strength: number;
  motion: boolean;
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
};

export type SignalRefValue = {
  strength: number;
  motion: boolean;
  isFresh: boolean;
};

export function useDetectionStream(mode: Mode, url: string) {
  // Underlying state kept in refs for performance (sources may emit 100 Hz)
  const latestRef = useRef<Detection | null>(null);
  const historyRef = useRef<HistoryPoint[]>([]);
  const eventsRef = useRef<DetectionEvent[]>([]);
  const prevMotionRef = useRef(false);
  const lastMessageAtRef = useRef<number | null>(null);
  const messageTimestampsRef = useRef<number[]>([]);
  const invalidCountRef = useRef(0);
  const retryInSRef = useRef<number | null>(null);
  const liveStatusRef = useRef<LiveSourceStatus>('disconnected');
  const isDemoPausedRef = useRef(false);

  // Direct ref for radar canvas 60fps reads
  const signalRef = useRef<SignalRefValue>({
    strength: 0,
    motion: false,
    isFresh: false,
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
  }));

  // Effect to manage data source: depends ONLY on [mode, url]
  useEffect(() => {
    // Reset data on mode/url switch
    latestRef.current = null;
    historyRef.current = [];
    eventsRef.current = [];
    prevMotionRef.current = false;
    lastMessageAtRef.current = null;
    messageTimestampsRef.current = [];
    invalidCountRef.current = 0;
    retryInSRef.current = null;
    isDemoPausedRef.current = false;
    signalRef.current = { strength: 0, motion: false, isFresh: false };

    const processRawMessage = (raw: string) => {
      const receivedAt = Date.now();
      const result = parseDetections(raw, receivedAt);
      invalidCountRef.current += result.invalid;

      for (const detection of result.detections) {
        lastMessageAtRef.current = receivedAt;
        messageTimestampsRef.current.push(receivedAt);
        latestRef.current = detection;

        historyRef.current.push({
          at: detection.receivedAt,
          strength: detection.strength,
          motion: detection.motion,
        });

        // Event tracking: new event when motion becomes true, end when false
        if (detection.motion && !prevMotionRef.current) {
          eventsRef.current = [
            {
              startAt: detection.receivedAt,
              endAt: null,
              peak: detection.strength,
            },
            ...eventsRef.current,
          ].slice(0, 8);
        } else if (detection.motion && prevMotionRef.current) {
          if (eventsRef.current.length > 0 && eventsRef.current[0].endAt === null) {
            eventsRef.current[0].peak = Math.max(
              eventsRef.current[0].peak,
              detection.strength,
            );
          }
        } else if (!detection.motion && prevMotionRef.current) {
          if (eventsRef.current.length > 0 && eventsRef.current[0].endAt === null) {
            eventsRef.current[0].endAt = detection.receivedAt;
            eventsRef.current[0].peak = Math.max(
              eventsRef.current[0].peak,
              detection.strength,
            );
          }
        }
        prevMotionRef.current = detection.motion;

        // Update signal ref immediately for radar
        signalRef.current.strength = detection.strength;
        signalRef.current.motion = detection.motion;
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
      const isFresh = lastAt !== null && now - lastAt <= 2000;

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
      }

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

  const setPaused = useCallback((paused: boolean) => {
    if (mode === 'demo') {
      isDemoPausedRef.current = paused;
      demoSourceRef.current?.setPaused(paused);
    }
  }, [mode]);

  return {
    ...streamState,
    signalRef,
    triggerMovement,
    setPaused,
  };
}
