import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import type { HistoryPoint } from '../hooks/useDetectionStream';
import { theme } from '../theme';

type ActivityGraphProps = {
  history: HistoryPoint[];
  now: number;
  isFresh: boolean;
  isKiosk?: boolean;
  className?: string;
};

type AlertRun = {
  alert: 'approach' | 'inside';
  startAt: number;
  endAt: number;
  x1: number;
  x2: number;
};

function getAlertRuns(
  history: HistoryPoint[],
  now: number,
  isFresh: boolean
): AlertRun[] {
  if (history.length === 0) return [];
  const runs: { alert: 'approach' | 'inside'; startAt: number; lastAt: number }[] = [];
  let current: { alert: 'approach' | 'inside'; startAt: number; lastAt: number } | null = null;

  for (let i = 0; i < history.length; i++) {
    const pt = history[i];
    if (pt.alert === 'approach' || pt.alert === 'inside') {
      if (!current) {
        current = { alert: pt.alert, startAt: pt.at, lastAt: pt.at };
      } else if (current.alert === pt.alert) {
        current.lastAt = pt.at;
      } else {
        runs.push(current);
        current = { alert: pt.alert, startAt: pt.at, lastAt: pt.at };
      }
    } else {
      if (current) {
        runs.push(current);
        current = null;
      }
    }
  }

  if (current) {
    runs.push(current);
  }

  const result: AlertRun[] = [];

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const isLastRun = i === runs.length - 1;
    let endAt = run.lastAt;

    if (isLastRun) {
      // Runs ongoing at right edge extend to now if data is fresh
      if (isFresh) {
        endAt = now;
      } else {
        endAt = run.lastAt;
      }
    } else {
      const nextRun = runs[i + 1];
      if (nextRun && nextRun.startAt - run.lastAt <= 500) {
        endAt = nextRun.startAt;
      } else {
        endAt = Math.min(now, run.lastAt + 100);
      }
    }

    const x1 = Math.max(-60, Number(((run.startAt - now) / 1000).toFixed(2)));
    const x2 = Math.min(0, Number(((endAt - now) / 1000).toFixed(2)));

    if (x2 > x1) {
      result.push({
        alert: run.alert,
        startAt: run.startAt,
        endAt,
        x1,
        x2,
      });
    }
  }

  return result;
}

export function ActivityGraph({
  history,
  now,
  isFresh,
  isKiosk = false,
  className,
}: ActivityGraphProps) {
  const chartData = useMemo(() => {
    const data: { x: number; strength: number | null }[] = [];
    for (let i = 0; i < history.length; i++) {
      const pt = history[i];
      if (i > 0) {
        const prevPt = history[i - 1];
        if (pt.at - prevPt.at > 1000) {
          // Gap > 1s detected between points (e.g. after pause and resume)
          // Insert null strength point between them to keep the gap visible
          const gapX = Number(((prevPt.at + 50 - now) / 1000).toFixed(2));
          data.push({ x: gapX, strength: null });
        }
      }
      data.push({
        x: Number(((pt.at - now) / 1000).toFixed(2)),
        strength: Math.round(pt.strength * 100),
      });
    }
    return data;
  }, [history, now]);

  const alertRuns = useMemo(() => {
    return getAlertRuns(history, now, isFresh);
  }, [history, now, isFresh]);

  return (
    <div
      className={`rounded-[10px] border border-line bg-surface flex flex-col shrink-0 min-w-0 ${
        isKiosk ? 'p-2' : 'justify-between'
      } ${
        className ??
        'p-4 my-2 h-[140px] md:h-[160px] min-[1100px]:h-[clamp(140px,22vh,200px)]'
      }`}
    >
      {!isKiosk && (
        <div className="flex items-center justify-between text-xs mb-1 shrink-0">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            ACTIVITY
          </span>
          <span className="text-xs text-muted font-mono">Last 60 s</span>
        </div>
      )}

      <div className="flex-1 w-full min-h-0 min-w-0 relative">
        {history.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center">
            <span className="font-mono text-xs text-faint">Waiting for data</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart
              data={chartData}
              margin={
                isKiosk
                  ? { top: 4, right: 4, left: 4, bottom: 2 }
                  : { top: 6, right: 16, left: 0, bottom: 0 }
              }
            >
              <defs>
                <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.accent} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid horizontal={true} vertical={false} stroke={theme.line} />
              <XAxis
                type="number"
                dataKey="x"
                domain={[-60, 0]}
                ticks={[-60, -45, -30, -15, 0]}
                tickFormatter={(val: number) => (val === 0 ? 'now' : `${Math.abs(val)} s`)}
                axisLine={false}
                tickLine={false}
                tick={{
                  fill: theme.faint,
                  fontSize: isKiosk ? 10 : 11,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              />
              <YAxis
                type="number"
                domain={[0, 100]}
                ticks={[0, 50, 100]}
                tickFormatter={(val: number) => `${val}%`}
                axisLine={false}
                tickLine={false}
                hide={isKiosk}
                width={isKiosk ? 0 : 36}
                tick={
                  isKiosk
                    ? false
                    : {
                        fill: theme.faint,
                        fontSize: 11,
                        fontFamily: "'IBM Plex Mono', monospace",
                      }
                }
              />
              {alertRuns.map((run) => (
                <ReferenceArea
                  key={`${run.alert}-${run.startAt}`}
                  x1={run.x1}
                  x2={run.x2}
                  y1={0}
                  y2={100}
                  fill={run.alert === 'inside' ? theme.motion : theme.warn}
                  fillOpacity={run.alert === 'inside' ? 0.1 : 0.08}
                  strokeOpacity={0}
                  ifOverflow="hidden"
                />
              ))}
              <Area
                type="monotone"
                dataKey="strength"
                stroke={theme.accent}
                strokeWidth={1.5}
                fill="url(#activity-fill)"
                isAnimationActive={false}
                dot={false}
                activeDot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
