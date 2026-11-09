import { useEffect, useRef } from 'react';
import type { AlertLevel, LinkState, NodeState } from '../lib/contract';
import type { SignalRefValue } from '../hooks/useDetectionStream';
import type { Mode, Units } from '../lib/settings';
import { formatMetres } from '../lib/units';
import type { Palette } from '../theme';
import { hexToRgba, readPalette } from '../theme';

/** What was clicked on the map. */
export type MapTarget =
  | { kind: 'side'; id: 'left' | 'right' }
  | { kind: 'front' }
  | { kind: 'hub' }
  | { kind: 'node'; id: 'left' | 'right' }
  | { kind: 'zone' };

export interface ZoneMapProps {
  signalRef: React.RefObject<SignalRefValue>;
  mode: Mode;
  armed: boolean;
  /** Changes when the theme changes, so the canvas re-reads its colours. */
  themeKey: string;
  units: Units;
  onSelect?: (target: MapTarget) => void;
  className?: string;
}

interface Point {
  x: number;
  y: number;
}

type Geometry = {
  hub: Point;
  left: Point;
  right: Point;
  S: number;
  pxPerMetre: number;
};

const FAN_START = Math.PI / 2 - Math.PI / 3; // 30 deg: the radar sees about 120 deg
const FAN_END = Math.PI / 2 + Math.PI / 3; // 150 deg
const HEAT_SLICES = 36;
const HEAT_FADE_S = 1.5;

function getSideMetres(): number {
  if (typeof window === 'undefined') return 3;
  try {
    const params = new URLSearchParams(window.location.search);
    const sideParam = params.get('side');
    if (sideParam !== null) {
      const parsed = parseFloat(sideParam);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 10) {
        return parsed;
      }
    }
  } catch {
    // fallback to default 3 metres
  }
  return 3;
}

function line(ctx: CanvasRenderingContext2D, p1: Point, p2: Point, color: string, width: number, dash: number[]) {
  ctx.setLineDash(dash);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function clipTriangle(ctx: CanvasRenderingContext2D, g: Geometry) {
  ctx.beginPath();
  ctx.moveTo(g.hub.x, g.hub.y);
  ctx.lineTo(g.left.x, g.left.y);
  ctx.lineTo(g.right.x, g.right.y);
  ctx.closePath();
  ctx.clip();
}

/** A side of the triangle: offline or missing node, active (someone at the line), or idle. */
function drawSide(
  ctx: CanvasRenderingContext2D,
  p1: Point,
  p2: Point,
  sideId: string,
  links: LinkState[] | null,
  nodes: NodeState[] | null,
  armed: boolean,
  alert: AlertLevel,
  pal: Palette,
) {
  if (nodes !== null) {
    const node = nodes.find((n) => n.id === sideId);
    if (!node) {
      line(ctx, p1, p2, pal.faint, 1.5, [4, 4]);
      return;
    }
    if (!node.online) {
      line(ctx, p1, p2, pal.muted, 2, [6, 6]);
      return;
    }
  }

  // Older servers without links: colour both sides by the overall alert
  if (links === null) {
    let color: string = pal.lineStrong;
    if (armed) {
      if (alert === 'inside') color = pal.alert;
      else if (alert === 'approach') color = pal.warn;
    }
    line(ctx, p1, p2, color, 2, []);
    return;
  }

  const link = links.find((l) => l.id === sideId);
  if (!link) {
    line(ctx, p1, p2, pal.lineStrong, 2, []);
    return;
  }

  if (link.motion) {
    // Someone is at this side: 3 px amber, no decoration
    line(ctx, p1, p2, pal.warn, 3, []);
    return;
  }

  line(ctx, p1, p2, pal.lineStrong, 2, []);
  // Rising activity under the threshold: the side warms up as its strength climbs (the hub sends
  // 0 at the empty-zone baseline and 0.5 at the threshold)
  const warmth = Math.max(0, Math.min(1, (link.strength - 0.05) / 0.45));
  if (warmth > 0) {
    line(ctx, p1, p2, hexToRgba(pal.warn, 0.15 + 0.65 * warmth), 2 + 0.75 * warmth, []);
  }
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function insideTriangle(p: Point, g: Geometry): boolean {
  const cross = (a: Point, b: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const d1 = cross(g.hub, g.left);
  const d2 = cross(g.left, g.right);
  const d3 = cross(g.right, g.hub);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function hitTest(p: Point, g: Geometry): MapTarget | null {
  if (Math.hypot(p.x - g.hub.x, p.y - g.hub.y) <= 16) return { kind: 'hub' };
  if (Math.hypot(p.x - g.left.x, p.y - g.left.y) <= 16) return { kind: 'node', id: 'left' };
  if (Math.hypot(p.x - g.right.x, p.y - g.right.y) <= 16) return { kind: 'node', id: 'right' };
  if (distanceToSegment(p, g.hub, g.left) <= 10) return { kind: 'side', id: 'left' };
  if (distanceToSegment(p, g.hub, g.right) <= 10) return { kind: 'side', id: 'right' };
  if (distanceToSegment(p, g.left, g.right) <= 10) return { kind: 'front' };
  if (insideTriangle(p, g)) return { kind: 'zone' };
  return null;
}

export function ZoneMap({ signalRef, mode, armed, themeKey, units, onSelect, className }: ZoneMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const geometryRef = useRef<Geometry | null>(null);
  const paletteRef = useRef<Palette>(readPalette());
  const paletteThemeRef = useRef<string | undefined>(typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme);
  const unitsRef = useRef<Units>(units);

  const armedRef = useRef(armed);
  useEffect(() => {
    armedRef.current = armed;
  }, [armed]);

  useEffect(() => {
    unitsRef.current = units;
  }, [units]);

  useEffect(() => {
    // The CSS variables have changed with the theme; read them again
    paletteRef.current = readPalette();
    paletteThemeRef.current = document.documentElement.dataset.theme;
  }, [themeKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size tracking via ResizeObserver
    const size = { width: 0, height: 0 };
    const updateSize = (w: number, h: number) => {
      size.width = w;
      size.height = h;
    };

    const initialRect = container.getBoundingClientRect();
    const style = window.getComputedStyle(container);
    const padX = (parseFloat(style.paddingLeft) || 16) + (parseFloat(style.paddingRight) || 16);
    const padY = (parseFloat(style.paddingTop) || 16) + (parseFloat(style.paddingBottom) || 16);
    updateSize(Math.max(0, initialRect.width - padX), Math.max(0, initialRect.height - padY));

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        updateSize(width, height);
      }
    });
    resizeObserver.observe(canvas);

    // Eased display state
    let lastTimestamp = 0;
    let displayDistance = 1.5; // metres
    let displayLean = 0; // -1 left ... +1 right
    let displayConf = 0.5;
    let heat = 0; // 0 to 1: the band's presence, fades over HEAT_FADE_S after the target goes
    let heatColor: 'alert' | 'warn' = 'alert';
    let rafId = 0;

    const render = (timestamp: number) => {
      rafId = requestAnimationFrame(render);

      if (lastTimestamp === 0) {
        lastTimestamp = timestamp;
      }
      let dt = (timestamp - lastTimestamp) / 1000;
      dt = Math.max(0, Math.min(dt, 0.05));
      lastTimestamp = timestamp;

      const { width, height } = size;
      if (width <= 0 || height <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      const targetWidth = Math.round(width * dpr);
      const targetHeight = Math.round(height * dpr);
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // The theme attribute can change between effects; re-read the colours when it does
      const themeNow = document.documentElement.dataset.theme;
      if (themeNow !== paletteThemeRef.current) {
        paletteRef.current = readPalette();
        paletteThemeRef.current = themeNow;
      }
      const pal = paletteRef.current;
      const s = signalRef.current;
      const alert: AlertLevel = s?.alert ?? 'clear';
      const distanceM = s?.distanceM ?? null;
      const isFresh = s?.isFresh ?? false;
      const links = s?.links ?? null;
      const nodes = s?.nodes ?? null;
      const entrySide = s?.entrySide ?? null;
      const confidence = s?.confidence ?? 0;
      const rangeCm = s?.rangeCm ?? null;
      const currentArmed = armedRef.current;

      // Geometry: the hub near the top, the triangle scaled so the radar range arc also fits
      const sideMetres = getSideMetres();
      const rangeRatio = rangeCm !== null ? rangeCm / 100 / sideMetres : 0;
      const topMargin = 28;
      const bottomMargin = 30;
      const needed = Math.max(0.866 + 0.08, rangeRatio + 0.1);
      const S = Math.max(40, Math.min(0.82 * width, (height - topMargin - bottomMargin) / needed));
      const triH = S * (Math.sqrt(3) / 2);
      const cx = width / 2;
      const hub: Point = { x: cx, y: topMargin };
      const left: Point = { x: cx - S / 2, y: topMargin + triH };
      const right: Point = { x: cx + S / 2, y: topMargin + triH };
      const pxPerMetre = S / sideMetres;
      const g: Geometry = { hub, left, right, S, pxPerMetre };
      geometryRef.current = g;

      // Eased values
      const target = isFresh && distanceM !== null;
      if (target) {
        if (heat <= 0.01) displayDistance = distanceM;
        else if (dt > 0) displayDistance += (distanceM - displayDistance) * (1 - Math.exp(-dt / 0.25));
        heat = Math.min(1, heat + dt / 0.25);
        heatColor = alert === 'inside' ? 'alert' : 'warn';
      } else {
        heat = Math.max(0, heat - dt / HEAT_FADE_S);
      }
      if (dt > 0) displayConf += ((target ? confidence : displayConf) - displayConf) * (1 - Math.exp(-dt / 0.4));

      // Lean: toward the side whose Wi-Fi level is higher (the radar has no angle)
      const leftStrength = links?.find((l) => l.id === 'left')?.strength ?? 0;
      const rightStrength = links?.find((l) => l.id === 'right')?.strength ?? 0;
      const leanTarget = Math.max(-1, Math.min(1, (rightStrength - leftStrength) / Math.max(0.2, leftStrength + rightStrength)));
      const leanCertainty = Math.min(1, (leftStrength + rightStrength) / 0.6);
      if (dt > 0) displayLean += (leanTarget - displayLean) * (1 - Math.exp(-dt / 0.5));

      const baseAlpha = isFresh ? 1.0 : 0.35;
      ctx.save();
      ctx.globalAlpha = baseAlpha;

      // 1. The zone: a flat fill, tinted by the alert while armed
      ctx.beginPath();
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.closePath();
      ctx.fillStyle = pal.surface2;
      ctx.fill();
      if (isFresh && currentArmed) {
        if (alert === 'approach') {
          ctx.fillStyle = hexToRgba(pal.warn, 0.06);
          ctx.fill();
        } else if (alert === 'inside') {
          ctx.fillStyle = hexToRgba(pal.alert, 0.08);
          ctx.fill();
        }
      }

      // 2. Range arcs every metre inside the zone (scale only)
      ctx.save();
      clipTriangle(ctx, g);
      ctx.lineWidth = 1;
      ctx.strokeStyle = pal.line;
      const maxM = Math.ceil(sideMetres);
      for (let m = 1; m <= maxM; m++) {
        ctx.beginPath();
        ctx.arc(hub.x, hub.y, m * pxPerMetre, FAN_START, FAN_END);
        ctx.stroke();
      }
      ctx.restore();

      // 3. The radar's cutoff (MAX_DISTANCE_CM): dotted, across its 120 degree view
      if (rangeCm !== null) {
        const r = (rangeCm / 100) * pxPerMetre;
        ctx.save();
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = pal.faint;
        ctx.beginPath();
        ctx.arc(hub.x, hub.y, r, FAN_START, FAN_END);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "10px 'IBM Plex Mono', monospace";
        ctx.fillStyle = pal.faint;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`RADAR RANGE ${formatMetres(rangeCm / 100, unitsRef.current)}`, cx, hub.y + r + 4);
        ctx.restore();
      }

      // 4. Heat band: the radar's distance (a ring around the hub, clipped to the zone), leaning
      // toward the side whose Wi-Fi level is higher, as strong as the confidence, fading when lost
      if (heat > 0.01) {
        const color = heatColor === 'alert' ? pal.alert : pal.warn;
        const r = displayDistance * pxPerMetre;
        const halfW = (0.12 + 0.22 * (1 - displayConf)) * pxPerMetre;
        const thetaC = Math.PI / 2 - displayLean * (Math.PI / 6) * 0.85;
        const sigma = (Math.PI / 6) * (0.45 + 0.75 * (1 - leanCertainty));
        const intensity = heat * (0.3 + 0.7 * displayConf);
        const step = (FAN_END - FAN_START) / HEAT_SLICES;
        ctx.save();
        clipTriangle(ctx, g);
        for (let i = 0; i < HEAT_SLICES; i++) {
          const a0 = FAN_START + step * i;
          const a1 = a0 + step + 0.004;
          const am = a0 + step / 2;
          const w = Math.exp(-0.5 * ((am - thetaC) / sigma) ** 2);
          const alpha = intensity * (0.1 + 0.9 * w);
          for (const [frac, mult] of [
            [1.0, 0.25],
            [0.75, 0.5],
            [0.45, 1.0],
          ] as const) {
            const inner = Math.max(0, r - halfW * frac);
            const outer = r + halfW * frac;
            ctx.beginPath();
            ctx.arc(hub.x, hub.y, outer, a0, a1);
            ctx.arc(hub.x, hub.y, inner, a1, a0, true);
            ctx.closePath();
            ctx.fillStyle = hexToRgba(color, alpha * mult);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // 5. Sides
      drawSide(ctx, hub, left, 'left', links, nodes, currentArmed, alert, pal);
      drawSide(ctx, hub, right, 'right', links, nodes, currentArmed, alert, pal);

      // 6. The front: a Wi-Fi link if the hub reports one, otherwise the radar's side
      const hasBaseLink = Boolean(links?.some((l) => l.id === 'base'));
      const radarWatches = Boolean(nodes?.some((n) => n.id === 'radar' && n.online));
      if (hasBaseLink) {
        drawSide(ctx, left, right, 'base', links, nodes, currentArmed, alert, pal);
      } else {
        line(ctx, left, right, radarWatches ? pal.lineStrong : pal.faint, 1.5, [4, 4]);
        ctx.font = "10px 'IBM Plex Mono', monospace";
        ctx.fillStyle = radarWatches ? pal.muted : pal.faint;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(radarWatches ? 'FRONT: RADAR' : 'FRONT: NOT MONITORED', cx, left.y + 6);
      }

      // 7. Entry mark: a chevron on the side the person came in through, pointing inward
      if (isFresh && alert === 'inside' && entrySide !== null) {
        let mid: Point | null = null;
        if (entrySide === 'left') mid = { x: (hub.x + left.x) / 2, y: (hub.y + left.y) / 2 };
        else if (entrySide === 'right') mid = { x: (hub.x + right.x) / 2, y: (hub.y + right.y) / 2 };
        else if (entrySide === 'base') mid = { x: cx, y: left.y };
        if (mid) {
          const centroid: Point = { x: cx, y: hub.y + (2 / 3) * triH };
          const len = Math.max(1, Math.hypot(centroid.x - mid.x, centroid.y - mid.y));
          const nx = (centroid.x - mid.x) / len;
          const ny = (centroid.y - mid.y) / len;
          const sz = Math.max(6, S * 0.022);
          ctx.beginPath();
          ctx.moveTo(mid.x - ny * sz, mid.y + nx * sz);
          ctx.lineTo(mid.x + nx * sz * 1.2, mid.y + ny * sz * 1.2);
          ctx.lineTo(mid.x + ny * sz, mid.y - nx * sz);
          ctx.lineWidth = 2;
          ctx.strokeStyle = pal.alert;
          ctx.stroke();
        }
      }

      // 8. Cones and labels
      const coneStroke = (id: string): string => {
        if (nodes === null) return pal.faint;
        const n = nodes.find((x) => x.id === id);
        if (!n) return pal.faint;
        return n.online ? pal.accent : pal.muted;
      };
      const coneLabel = (id: string): string => {
        if (nodes === null) return pal.muted;
        const n = nodes.find((x) => x.id === id);
        return n ? pal.muted : pal.faint;
      };
      for (const [p, id] of [
        [hub, 'hub'],
        [left, 'left'],
        [right, 'right'],
      ] as const) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = pal.bg;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = coneStroke(id);
        ctx.stroke();
      }
      const hasRadar = Boolean(nodes?.some((n) => n.id === 'radar'));
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.textAlign = 'center';
      ctx.fillStyle = coneLabel('hub');
      ctx.textBaseline = 'bottom';
      ctx.fillText(hasRadar ? 'HUB + RADAR' : 'HUB', hub.x, hub.y - 12);
      ctx.textBaseline = 'top';
      ctx.fillStyle = coneLabel('left');
      ctx.fillText('LEFT', left.x, left.y + 12);
      ctx.fillStyle = coneLabel('right');
      ctx.fillText('RIGHT', right.x, right.y + 12);

      // 9. Readout: the radar distance while it sees someone, otherwise NO TARGET; no data when stale
      let valStr = '--';
      let lblStr = 'NO DATA';
      let valColor: string = pal.faint;
      if (isFresh && distanceM !== null && alert !== 'clear') {
        valStr = formatMetres(distanceM, unitsRef.current);
        lblStr = 'FROM HUB';
        valColor = alert === 'inside' ? pal.alert : pal.warn;
      } else if (isFresh) {
        lblStr = 'NO TARGET';
      }
      const valFontSize = Math.max(14, Math.round(S * 0.055));
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `500 ${valFontSize}px 'IBM Plex Mono', monospace`;
      ctx.fillStyle = valColor;
      ctx.fillText(valStr, 4, 4);
      ctx.font = "400 10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = pal.muted;
      ctx.fillText(lblStr, 4, 8 + valFontSize);

      ctx.restore();
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [signalRef]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = geometryRef.current;
    const canvas = canvasRef.current;
    if (!g || !canvas || !onSelect) return;
    const rect = canvas.getBoundingClientRect();
    const target = hitTest({ x: e.clientX - rect.left, y: e.clientY - rect.top }, g);
    if (target) onSelect(target);
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center rounded-[10px] border border-line bg-surface aspect-square overflow-hidden ${
        className ??
        'order-2 md:order-1 min-[1100px]:order-none p-4 w-full h-full max-h-full max-w-[520px] min-[1100px]:max-w-none mx-auto min-[1100px]:m-0 min-h-0 self-center'
      }`}
    >
      {mode === 'demo' && (
        <span className="absolute top-3 right-3 font-mono text-[11px] text-warn uppercase tracking-wider select-none pointer-events-none z-10">
          Simulated
        </span>
      )}
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className={`w-full h-full block ${onSelect ? 'cursor-pointer' : ''}`}
        aria-label="Zone map. Click a side, the hub, the front line or a corner for details"
      />
    </div>
  );
}
