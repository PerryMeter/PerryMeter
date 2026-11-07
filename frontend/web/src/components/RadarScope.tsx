import { useEffect, useRef } from 'react';
import type { SignalRefValue } from '../hooks/useDetectionStream';
import type { Mode } from '../lib/settings';
import { theme } from '../theme';

export interface RadarScopeProps {
  signalRef: React.RefObject<SignalRefValue>;
  mode: Mode;
  armed: boolean;
}

interface ActivityRing {
  elapsed: number;
  duration: number;
  initialOpacity: number;
  color: string;
}

function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

export function RadarScope({ signalRef, mode, armed }: RadarScopeProps) {
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

    // Initial measurement
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
    let sweepAngle = 0;
    let displayStrength = 0;
    let displayDistanceFrac = 1.0;
    let distanceAlpha = 0;
    let ringSpawnTimer = 0;
    const rings: ActivityRing[] = [];
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
      const alert = currentSignal?.alert ?? 'clear';
      const distanceM = currentSignal?.distanceM ?? null;
      const isFresh = currentSignal?.isFresh ?? false;
      const currentArmed = armedRef.current;

      // Eased strength display: display += (target - display) * (1 - exp(-dt / 0.25))
      const targetStrength = isFresh ? strength : 0;
      if (dt > 0) {
        displayStrength += (targetStrength - displayStrength) * (1 - Math.exp(-dt / 0.25));
      }

      const cx = width / 2;
      const cy = height / 2;
      const outerRadius = Math.max(10, Math.min(width, height) / 2 - 4);

      // Sweep rotation period calculation
      let period = 4.0;
      if (!isFresh) {
        period = 8.0;
      } else if (prefersReducedMotion) {
        period = 10.0;
      } else {
        period = 4.0 - 1.6 * displayStrength;
      }

      if (dt > 0) {
        sweepAngle = (sweepAngle + ((2 * Math.PI) / period) * dt) % (Math.PI * 2);
      }

      // Sweep and accent colors
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

      // Activity rings spawn logic:
      // While strength > 0.15, spawn ring every 1.6 - 1.0 * display seconds
      if (displayStrength > 0.15 && isFresh && !prefersReducedMotion) {
        ringSpawnTimer += dt;
        const interval = 1.6 - 1.0 * displayStrength;
        if (ringSpawnTimer >= interval) {
          ringSpawnTimer = 0;
          if (rings.length < 6) {
            const ringColor = currentArmed && alert === 'inside' ? theme.motion : theme.accent;
            rings.push({
              elapsed: 0,
              duration: 2.4,
              initialOpacity: 0.15 + 0.6 * displayStrength,
              color: ringColor,
            });
          }
        }
      } else {
        ringSpawnTimer = 0;
      }

      // Distance ring easing and fading logic
      if (isFresh && distanceM !== null) {
        const targetFrac = Math.min(distanceM / 6, 1);
        if (distanceAlpha <= 0.01) {
          displayDistanceFrac = targetFrac;
        } else if (dt > 0) {
          displayDistanceFrac += (targetFrac - displayDistanceFrac) * (1 - Math.exp(-dt / 0.25));
        }
        distanceAlpha = Math.min(1, distanceAlpha + dt / 0.3);
      } else {
        distanceAlpha = Math.max(0, distanceAlpha - dt / 0.3);
      }

      // Stale opacity handling: 35% opacity when data is not fresh
      const baseAlpha = isFresh ? 1.0 : 0.35;

      ctx.save();
      ctx.globalAlpha = baseAlpha;

      // 1. Face: filled circle with radial gradient from surface at centre to bg at edge
      const faceGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerRadius);
      faceGrad.addColorStop(0, theme.surface);
      faceGrad.addColorStop(1, theme.bg);
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.fillStyle = faceGrad;
      ctx.fill();

      // 2. Rings: 4 concentric circles at 25, 50, 75 and 100% of radius (1px line, outer line-strong)
      ctx.lineWidth = 1;
      ctx.strokeStyle = theme.line;
      for (const frac of [0.25, 0.5, 0.75]) {
        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius * frac, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.strokeStyle = theme.lineStrong;
      ctx.lineWidth = 1;
      ctx.stroke();

      // 3. Bezel ticks: around outer ring, 72 ticks (every 5 deg, 4px line), every 30 deg a 10px tick in line-strong
      for (let deg = 0; deg < 360; deg += 5) {
        const rad = (deg * Math.PI) / 180;
        const isMajor = deg % 30 === 0;
        const tickLen = isMajor ? 10 : 4;
        const innerR = outerRadius - tickLen;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        ctx.beginPath();
        ctx.moveTo(cx + cos * innerR, cy + sin * innerR);
        ctx.lineTo(cx + cos * outerRadius, cy + sin * outerRadius);
        ctx.strokeStyle = isMajor ? theme.lineStrong : theme.line;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 4. Crosshair: horizontal and vertical line through centre, 1px, line at 60% opacity
      ctx.beginPath();
      ctx.moveTo(cx - outerRadius, cy);
      ctx.lineTo(cx + outerRadius, cy);
      ctx.moveTo(cx, cy - outerRadius);
      ctx.lineTo(cx, cy + outerRadius);
      ctx.strokeStyle = 'rgba(30, 42, 47, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 5. Sweep: 45 degree wedge rotating clockwise with createConicGradient
      const wedgeStart = sweepAngle - Math.PI / 4;
      try {
        const grad = ctx.createConicGradient(wedgeStart, cx, cy);
        grad.addColorStop(0, hexToRgba(sweepColor, 0));
        grad.addColorStop(0.125, hexToRgba(sweepColor, 0.3));
        grad.addColorStop(0.12501, hexToRgba(sweepColor, 0));
        grad.addColorStop(1, hexToRgba(sweepColor, 0));

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerRadius, wedgeStart, sweepAngle, false);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
      } catch {
        // Fallback for environments lacking createConicGradient
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerRadius, wedgeStart, sweepAngle, false);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(sweepColor, 0.18);
        ctx.fill();
        ctx.restore();
      }

      // Leading-edge line: 1.5px at 90% opacity
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(
        cx + Math.cos(sweepAngle) * outerRadius,
        cy + Math.sin(sweepAngle) * outerRadius
      );
      ctx.strokeStyle = hexToRgba(sweepColor, 0.9);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // 6. Activity rings: expanding outward over 2.4s, fading to 0
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        ring.elapsed += dt;
        const progress = ring.elapsed / ring.duration;
        if (progress >= 1 || prefersReducedMotion) {
          rings.splice(i, 1);
          continue;
        }
        const r = progress * outerRadius;
        const alpha = ring.initialOpacity * (1 - progress);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = hexToRgba(ring.color, alpha);
        ctx.stroke();
        ctx.restore();
      }

      // 7. Edge glow: when inside and armed and fresh, stroke outer ring with shadowBlur
      if (isFresh && currentArmed && alert === 'inside' && displayStrength > 0.05) {
        ctx.save();
        ctx.shadowColor = theme.motion;
        ctx.shadowBlur = Math.round(12 + 18 * displayStrength);
        ctx.strokeStyle = hexToRgba(theme.motion, Math.min(1, 0.4 + 0.6 * displayStrength));
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 8. Distance ring: full dashed circle (1.5px, warn, dashes 6px on / 6px off)
      if (distanceAlpha > 0.005) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, displayDistanceFrac * outerRadius, 0, Math.PI * 2);
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = hexToRgba(theme.warn, distanceAlpha);
        ctx.stroke();
        ctx.restore();
      }

      // 9. Centre readout: dark disc behind text so sweep does not cross it
      const discRadius = Math.max(26, outerRadius * 0.28);
      ctx.save();
      ctx.globalAlpha = isFresh ? 1.0 : 0.85;
      ctx.beginPath();
      ctx.arc(cx, cy, discRadius, 0, Math.PI * 2);
      ctx.fillStyle = theme.bg;
      ctx.fill();
      ctx.restore();

      // Readout values
      let valueStr = '';
      let labelStr = '';
      let valueColor: string = theme.text;
      let labelColor: string = theme.muted;

      if (!isFresh) {
        valueStr = '--';
        labelStr = 'NO DATA';
        valueColor = theme.faint;
        labelColor = theme.muted;
      } else if (alert === 'approach' && distanceM !== null) {
        valueStr = `${distanceM.toFixed(1)} m`;
        labelStr = 'DISTANCE';
        valueColor = theme.text;
        labelColor = theme.muted;
      } else {
        valueStr = `${Math.round(displayStrength * 100)}%`;
        labelStr = 'STRENGTH';
        valueColor = theme.text;
        labelColor = theme.muted;
      }

      const valueFontSize = Math.max(14, Math.round(outerRadius * 0.11));
      const labelFontSize = Math.max(9, Math.round(outerRadius * 0.055));

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.font = `500 ${valueFontSize}px 'IBM Plex Mono', monospace`;
      ctx.fillStyle = valueColor;
      ctx.fillText(valueStr, cx, cy - outerRadius * 0.035);

      ctx.font = `400 ${labelFontSize}px 'IBM Plex Mono', monospace`;
      ctx.fillStyle = labelColor;
      ctx.fillText(labelStr, cx, cy + outerRadius * 0.08);

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
      className="order-2 md:order-1 min-[1100px]:order-none relative flex items-center justify-center p-4 rounded-[10px] border border-line bg-surface aspect-square w-full h-full max-h-full max-w-[520px] min-[1100px]:max-w-none mx-auto min-[1100px]:m-0 min-h-0 overflow-hidden"
    >
      {mode === 'demo' && (
        <span className="absolute top-3 right-3 font-mono text-[11px] text-warn uppercase tracking-wider select-none pointer-events-none z-10">
          SIMULATED
        </span>
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        aria-label="Radar scope display"
      />
    </div>
  );
}
