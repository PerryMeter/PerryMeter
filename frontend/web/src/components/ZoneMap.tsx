import { useEffect, useRef } from 'react';
import type { AlertLevel, LinkState, NodeState } from '../lib/contract';
import type { SignalRefValue } from '../hooks/useDetectionStream';
import type { Mode } from '../lib/settings';
import { theme } from '../theme';

export interface ZoneMapProps {
  signalRef: React.RefObject<SignalRefValue>;
  mode: Mode;
  armed: boolean;
  className?: string;
}

interface Point {
  x: number;
  y: number;
}

function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

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


function drawSide(
  ctx: CanvasRenderingContext2D,
  p1: Point,
  p2: Point,
  sideId: string,
  links: LinkState[] | null,
  nodes: NodeState[] | null,
  armed: boolean,
  alert: AlertLevel,
  timeSec: number,
  prefersReducedMotion: boolean,
  isFresh: boolean
) {
  ctx.save();

  // 19.1: node states apply only when the server reports nodes. With nodes null
  // (older servers) the side is drawn exactly as before Phase 13.
  if (nodes !== null) {
    const node = nodes.find((n) => n.id === sideId);

    // Not installed (node missing from nodes): 1.5px dashed faint, dashes 4px on and
    // 4px off (the same as the bottom side), no glow, ignores links and alert.
    if (!node) {
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = theme.faint;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Offline (node reported with online false): 2px dashed error at 70%
    if (!node.online) {
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = hexToRgba(theme.error, 0.70);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
  }

  // Older servers without links: colour both sides by the overall alert (18.7)
  if (links === null) {
    let color: string = theme.accent;
    if (armed) {
      if (alert === 'inside') color = theme.motion;
      else if (alert === 'approach') color = theme.warn;
    }
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const link = links.find((l) => l.id === sideId);

  // No link for this side (node online, or no node status): the idle style (2px line-strong), not red.
  if (!link) {
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.lineStrong;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Disarmed: accent, no glow
  if (!armed) {
    ctx.setLineDash([]);
    ctx.lineWidth = link.motion ? 3 : 2;
    ctx.strokeStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Armed:
  // 19.5: Active side colour:
  // A link with motion: true now means activity at that side, so draw it in warn
  // instead of motion: 3px warn, with the same glow (shadowBlur 12 to 24 scaled by
  // the link's strength, reset right after) and the same 1.2 s pulse (none with reduced motion).
  if (link.motion) {
    if (isFresh) {
      const pulse = prefersReducedMotion
        ? 1.0
        : 0.7 + 0.3 * Math.sin((2 * Math.PI * timeSec) / 1.2);
      const clampedStrength = Math.min(1, Math.max(0, link.strength));
      const baseBlur = 12 + 12 * clampedStrength;
      const blur = Math.round(baseBlur * pulse);
      ctx.shadowColor = theme.warn;
      ctx.shadowBlur = blur;
    }
    ctx.strokeStyle = theme.warn;
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Near (strength >= 0.15, motion false): 2.5px warn at 80%
  if (link.strength >= 0.15) {
    ctx.setLineDash([]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = hexToRgba(theme.warn, 0.80);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Idle: 2px line-strong
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.lineStrong;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.restore();
}

export function ZoneMap({ signalRef, mode, armed, className }: ZoneMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const armedRef = useRef(armed);
  useEffect(() => {
    armedRef.current = armed;
  }, [armed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Prefers reduced motion detection
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let prefersReducedMotion = mediaQuery.matches;
    const handleMediaChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
    };
    mediaQuery.addEventListener('change', handleMediaChange);

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
    updateSize(
      Math.max(0, initialRect.width - padX),
      Math.max(0, initialRect.height - padY)
    );

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        updateSize(width, height);
      }
    });
    resizeObserver.observe(canvas);

    // Animation state
    let lastTimestamp = 0;
    let sweepTime = 0;
    let displayStrength = 0;
    let displayDistance = 3.0;
    let distanceAlpha = 0;
    let rafId = 0;

    const render = (timestamp: number) => {
      rafId = requestAnimationFrame(render);

      if (lastTimestamp === 0) {
        lastTimestamp = timestamp;
      }
      let dt = (timestamp - lastTimestamp) / 1000;
      dt = Math.max(0, Math.min(dt, 0.05)); // Cap dt at 50 ms
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

      // Read current signals from signalRef
      const currentSignal = signalRef.current;
      const strength = currentSignal?.strength ?? 0;
      const alert: AlertLevel = currentSignal?.alert ?? 'clear';
      const distanceM = currentSignal?.distanceM ?? null;
      const isFresh = currentSignal?.isFresh ?? false;
      const links = currentSignal?.links ?? null;
      const nodes = currentSignal?.nodes ?? null;
      const currentArmed = armedRef.current;

      // Eased strength display: display += (target - display) * (1 - exp(-dt / 0.25))
      const targetStrength = isFresh ? strength : 0;
      if (dt > 0) {
        displayStrength += (targetStrength - displayStrength) * (1 - Math.exp(-dt / 0.25));
      }

      // Distance easing and fading logic
      if (isFresh && distanceM !== null) {
        const targetDist = distanceM;
        if (distanceAlpha <= 0.01) {
          displayDistance = targetDist;
        } else if (dt > 0) {
          displayDistance += (targetDist - displayDistance) * (1 - Math.exp(-dt / 0.25));
        }
        distanceAlpha = Math.min(1, distanceAlpha + dt / 0.3);
      } else {
        distanceAlpha = Math.max(0, distanceAlpha - dt / 0.3);
      }

      // Geometry:
      // S = min(0.80 * width, 0.80 * height / 0.866)
      const S = Math.min(0.80 * width, (0.80 * height) / 0.866);
      const triH = S * (Math.sqrt(3) / 2);

      const cx = width / 2;
      const cy = height / 2;

      const hub: Point = { x: cx, y: cy - triH / 2 };
      const left: Point = { x: cx - S / 2, y: cy + triH / 2 };
      const right: Point = { x: cx + S / 2, y: cy + triH / 2 };

      const centroidX = cx;
      const centroidY = hub.y + (2 / 3) * triH;

      const sideMetres = getSideMetres();
      const pxPerMetre = S / sideMetres;

      const fanStartAngle = Math.PI / 2 - Math.PI / 3; // PI / 6 (30 deg)
      const fanEndAngle = Math.PI / 2 + Math.PI / 3;   // 5 * PI / 6 (150 deg)
      const fanRadius = Math.min(6, 1.2 * sideMetres) * pxPerMetre;

      // Sweep period and timing
      let period = 4.0;
      if (!isFresh) {
        period = 8.0;
      } else {
        period = 4.0 - 1.6 * displayStrength;
      }

      if (dt > 0) {
        sweepTime += dt;
      }

      const cycleProgress = (sweepTime % period) / period;
      const isForward = cycleProgress < 0.5;
      const p = isForward ? cycleProgress / 0.5 : (1 - cycleProgress) / 0.5;
      const sweepAngle = fanStartAngle + p * (fanEndAngle - fanStartAngle);

      let sweepColor: string = theme.accent;
      if (currentArmed) {
        if (alert === 'inside') {
          sweepColor = theme.motion;
        } else if (alert === 'approach') {
          sweepColor = theme.warn;
        } else {
          sweepColor = theme.accent;
        }
      } else {
        sweepColor = theme.accent;
      }

      // Layer 8: Not fresh -> 35% global opacity
      const baseAlpha = isFresh ? 1.0 : 0.35;
      ctx.save();
      ctx.globalAlpha = baseAlpha;

      // 1. Interior: fill the triangle with surface-2.
      // When data is fresh and armed, tint it: approach with warn at 5%, inside with motion at 10%.
      ctx.beginPath();
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.closePath();
      ctx.fillStyle = theme.surface2;
      ctx.fill();

      if (isFresh && currentArmed) {
        if (alert === 'approach') {
          ctx.fillStyle = hexToRgba(theme.warn, 0.05);
          ctx.fill();
        } else if (alert === 'inside') {
          ctx.fillStyle = hexToRgba(theme.motion, 0.10);
          ctx.fill();
        }
      }

      // 2. Radar fan, clipped to the triangle
      // a fan from the hub with radius min(6, 1.2 * sideMetres) * pxPerMetre, plus faint range arcs every 1 m (1px, line, no labels).
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.closePath();
      ctx.clip();

      ctx.lineWidth = 1;
      ctx.strokeStyle = theme.line;

      const maxM = Math.floor(Math.min(6, 1.2 * sideMetres));
      for (let m = 1; m <= maxM; m++) {
        const r = m * pxPerMetre;
        if (r < fanRadius - 0.5) {
          ctx.beginPath();
          ctx.arc(hub.x, hub.y, r, fanStartAngle, fanEndAngle);
          ctx.stroke();
        }
      }

      ctx.beginPath();
      ctx.arc(hub.x, hub.y, fanRadius, fanStartAngle, fanEndAngle);
      ctx.stroke();

      ctx.restore();

      // 3. Sweep, clipped to the triangle
      // a line from the hub that swings back and forth across the fan.
      // Behind the line, a 15 degree wedge fading from 30% at the line to 0, on the side it came from.
      // Reduced motion: no sweep, only the static fan.
      if (!prefersReducedMotion) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(hub.x, hub.y);
        ctx.lineTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.closePath();
        ctx.clip();

        const wedgeAngle = Math.PI / 12; // 15 degrees
        const wedgeSpanFrac = 1 / 24;

        try {
          if (isForward) {
            const gradStart = sweepAngle - wedgeAngle;
            const grad = ctx.createConicGradient(gradStart, hub.x, hub.y);
            grad.addColorStop(0, hexToRgba(sweepColor, 0));
            grad.addColorStop(wedgeSpanFrac, hexToRgba(sweepColor, 0.30));
            grad.addColorStop(wedgeSpanFrac + 0.0001, hexToRgba(sweepColor, 0));
            grad.addColorStop(1, hexToRgba(sweepColor, 0));

            ctx.beginPath();
            ctx.moveTo(hub.x, hub.y);
            ctx.arc(hub.x, hub.y, fanRadius, gradStart, sweepAngle, false);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();
          } else {
            const grad = ctx.createConicGradient(sweepAngle, hub.x, hub.y);
            grad.addColorStop(0, hexToRgba(sweepColor, 0.30));
            grad.addColorStop(wedgeSpanFrac, hexToRgba(sweepColor, 0));
            grad.addColorStop(wedgeSpanFrac + 0.0001, hexToRgba(sweepColor, 0));
            grad.addColorStop(1, hexToRgba(sweepColor, 0));

            ctx.beginPath();
            ctx.moveTo(hub.x, hub.y);
            ctx.arc(hub.x, hub.y, fanRadius, sweepAngle, sweepAngle + wedgeAngle, false);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();
          }
        } catch {
          // Fallback if createConicGradient is unavailable
          ctx.beginPath();
          ctx.moveTo(hub.x, hub.y);
          const wStart = isForward ? sweepAngle - wedgeAngle : sweepAngle;
          const wEnd = isForward ? sweepAngle : sweepAngle + wedgeAngle;
          ctx.arc(hub.x, hub.y, fanRadius, wStart, wEnd, false);
          ctx.closePath();
          ctx.fillStyle = hexToRgba(sweepColor, 0.15);
          ctx.fill();
        }

        // Sweep leading line
        ctx.beginPath();
        ctx.moveTo(hub.x, hub.y);
        ctx.lineTo(
          hub.x + Math.cos(sweepAngle) * fanRadius,
          hub.y + Math.sin(sweepAngle) * fanRadius
        );
        ctx.strokeStyle = hexToRgba(sweepColor, 0.90);
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();
      }

      // 4. Distance arc, clipped to the triangle
      // when fresh and distanceM is a number, a dashed warn arc (1.5px, 6px on and 6px off)
      // centred on the hub, radius distanceM * pxPerMetre, spanning the whole fan.
      // Its radius eases like the strength, and it fades out over 300 ms when the distance goes away. Never a dot.
      if (isFresh && distanceAlpha > 0.005) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(hub.x, hub.y);
        ctx.lineTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.closePath();
        ctx.clip();

        ctx.beginPath();
        ctx.arc(hub.x, hub.y, displayDistance * pxPerMetre, fanStartAngle, fanEndAngle);
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = hexToRgba(theme.warn, distanceAlpha);
        ctx.stroke();

        ctx.restore();
      }

      // 5. Sides
      const animTime = timestamp / 1000;
      // Left side: hub to left
      drawSide(
        ctx,
        hub,
        left,
        'left',
        links,
        nodes,
        currentArmed,
        alert,
        animTime,
        prefersReducedMotion,
        isFresh
      );

      // Right side: hub to right
      drawSide(
        ctx,
        hub,
        right,
        'right',
        links,
        nodes,
        currentArmed,
        alert,
        animTime,
        prefersReducedMotion,
        isFresh
      );

      // Bottom side: left to right
      const hasBaseLink = Boolean(links?.some((l) => l.id === 'base'));
      if (hasBaseLink) {
        drawSide(
          ctx,
          left,
          right,
          'base',
          links,
          nodes,
          currentArmed,
          alert,
          animTime,
          prefersReducedMotion,
          isFresh
        );
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = theme.faint;
        ctx.stroke();

        ctx.font = "10px 'IBM Plex Mono', monospace";
        ctx.fillStyle = theme.faint;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('EXPANSION', cx, left.y + 6);
        ctx.restore();
      }

      // 6. Cones: a circle of radius 7 at each corner: fill bg, 2px stroke
      // 19.1: not installed cone stroke faint, label faint; offline stroke error; online stroke accent
      const hasRadar = Boolean(nodes?.some((n) => n.id === 'radar'));

      // Hub cone
      const hubNode = nodes ? nodes.find((n) => n.id === 'hub') : null;
      let hubStroke: string = theme.faint;
      if (nodes !== null) {
        hubStroke = hubNode?.online ? theme.accent : theme.error;
      }
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = theme.bg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hubStroke;
      ctx.stroke();

      // Left cone & label
      const leftNode = nodes ? nodes.find((n) => n.id === 'left') : null;
      let leftStroke: string = theme.faint;
      let leftLabelColor: string = theme.muted;
      if (nodes !== null) {
        if (!leftNode) {
          leftStroke = theme.faint;
          leftLabelColor = theme.faint;
        } else if (!leftNode.online) {
          leftStroke = theme.error;
          leftLabelColor = theme.muted;
        } else {
          leftStroke = theme.accent;
          leftLabelColor = theme.muted;
        }
      }
      ctx.beginPath();
      ctx.arc(left.x, left.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = theme.bg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = leftStroke;
      ctx.stroke();

      // Right cone & label
      const rightNode = nodes ? nodes.find((n) => n.id === 'right') : null;
      let rightStroke: string = theme.faint;
      let rightLabelColor: string = theme.muted;
      if (nodes !== null) {
        if (!rightNode) {
          rightStroke = theme.faint;
          rightLabelColor = theme.faint;
        } else if (!rightNode.online) {
          rightStroke = theme.error;
          rightLabelColor = theme.muted;
        } else {
          rightStroke = theme.accent;
          rightLabelColor = theme.muted;
        }
      }
      ctx.beginPath();
      ctx.arc(right.x, right.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = theme.bg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = rightStroke;
      ctx.stroke();

      // Labels
      ctx.save();
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.textAlign = 'center';

      // Hub label above apex
      ctx.fillStyle = theme.muted;
      ctx.textBaseline = 'bottom';
      ctx.fillText(hasRadar ? 'HUB + RADAR' : 'HUB', hub.x, hub.y - 12);

      // Left label below left corner
      ctx.fillStyle = leftLabelColor;
      ctx.textBaseline = 'top';
      ctx.fillText('LEFT', left.x, left.y + 12);

      // Right label below right corner
      ctx.fillStyle = rightLabelColor;
      ctx.textBaseline = 'top';
      ctx.fillText('RIGHT', right.x, right.y + 12);

      ctx.restore();

      // 7. Centre readout at the triangle's centroid, on a dark disc as in section 10:
      // inside with a distance, 2.3 m with the label FROM HUB;
      // otherwise the strength percentage with the label STRENGTH;
      // not fresh, -- and NO DATA.
      const discRadius = Math.max(26, S * 0.12);
      ctx.save();
      ctx.beginPath();
      ctx.arc(centroidX, centroidY, discRadius, 0, Math.PI * 2);
      ctx.fillStyle = theme.bg;
      ctx.fill();

      let valStr = '';
      let lblStr = '';
      let valColor: string = theme.text;
      let lblColor: string = theme.muted;

      if (!isFresh) {
        valStr = '--';
        lblStr = 'NO DATA';
        valColor = theme.faint;
        lblColor = theme.muted;
      } else if (alert === 'inside' && distanceM !== null) {
        valStr = `${distanceM.toFixed(1)} m`;
        lblStr = 'FROM HUB';
        valColor = theme.text;
        lblColor = theme.muted;
      } else {
        valStr = `${Math.round(displayStrength * 100)}%`;
        lblStr = 'STRENGTH';
        valColor = theme.text;
        lblColor = theme.muted;
      }

      const valFontSize = Math.max(14, Math.round(discRadius * 0.44));
      const lblFontSize = Math.max(9, Math.round(discRadius * 0.22));

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.font = `500 ${valFontSize}px 'IBM Plex Mono', monospace`;
      ctx.fillStyle = valColor;
      ctx.fillText(valStr, centroidX, centroidY - discRadius * 0.18);

      ctx.font = `400 ${lblFontSize}px 'IBM Plex Mono', monospace`;
      ctx.fillStyle = lblColor;
      ctx.fillText(lblStr, centroidX, centroidY + discRadius * 0.35);

      ctx.restore();

      // Restore outer baseAlpha save
      ctx.restore();
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, [signalRef]);

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
          SIMULATED
        </span>
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        aria-label="Zone map display"
      />
    </div>
  );
}
