import type { AlertLevel } from './contract';

type DemoState = 'clear' | 'activity' | 'inside_moving' | 'inside_still' | 'leaving';

export class DemoSource {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onMessage: ((raw: string) => void) | null = null;
  private paused = false;

  // Signal state
  private demoState: DemoState = 'clear';
  private visitSide: 'left' | 'right' = 'left';
  private phaseElapsed = 0;
  private phaseDuration = 0;
  private insideStillExtension = 0;
  private timeUntilNextVisit = 10 + Math.random() * 10; // 10 to 20 s

  private leftStrength = 0.05;
  private rightStrength = 0.05;
  private leftMotion = false;
  private rightMotion = false;
  private radarLevel = 0.05;
  private alert: AlertLevel = 'clear';
  private distanceM: number | null = null;

  // Fake hub settings, so the Settings panel and the detail views work without a hub. The
  // commands the dashboard sends (set_threshold, set_range, calibrate, ...) change these.
  private readonly startedAt = Date.now();
  private thresholds: Record<'left' | 'right', number> = { left: 0.1176, right: 0.1257 };
  private calibratedThresholds: Record<'left' | 'right', number> = { left: 0.1176, right: 0.1257 };
  private readonly baselines: Record<'left' | 'right', number> = { left: 0.0588, right: 0.0584 };
  private macs: Record<'left' | 'right', string> = { left: '1a:00:00:00:00:02', right: '1a:00:00:00:00:03' };
  private radarThresholds = { moving: 20, still: 20 };
  private calibratedRadar = { moving: 20, still: 20 };
  private thresholdSource = 'hub calibration at 22:43';
  private maxCm = 220;
  private calState: 'idle' | 'countdown' | 'measuring' | 'done' | 'failed' = 'done';
  private calRemaining = 0;
  private calMessage = 'Using the calibration from 22:43';
  private calAt: string | null = '2026-11-08 22:43';
  private lastDistanceCm = 130;

  /** Applies a dashboard command to the fake hub. Returns false for unknown commands. */
  applyCommand(cmd: Record<string, unknown>): boolean {
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const side = cmd.side === 'left' || cmd.side === 'right' ? cmd.side : null;
    switch (cmd.type) {
      case 'calibrate':
        this.calState = 'countdown';
        this.calRemaining = 5;
        this.calMessage = 'Leave the zone. Measuring starts in 5 s';
        return true;
      case 'cancel_calibration':
        if (this.calState === 'countdown' || this.calState === 'measuring') {
          this.calState = 'idle';
          this.calMessage = 'Calibration cancelled';
        }
        return true;
      case 'swap_sides':
        this.macs = { left: this.macs.right, right: this.macs.left };
        return true;
      case 'adjust_threshold': {
        const factor = num(cmd.factor);
        if (!side || factor === null || factor < 0.5 || factor > 2) return false;
        this.thresholds[side] = Math.round(Math.max(0.02, this.thresholds[side] * factor, this.baselines[side] * 1.2) * 1e4) / 1e4;
        return true;
      }
      case 'set_threshold': {
        const value = num(cmd.value);
        if (!side || value === null) return false;
        this.thresholds[side] = Math.round(Math.min(2, Math.max(0.02, this.baselines[side] * 1.2, value)) * 1e4) / 1e4;
        return true;
      }
      case 'reset_threshold':
        if (!side) return false;
        this.thresholds[side] = this.calibratedThresholds[side];
        return true;
      case 'set_radar_thresholds': {
        const moving = num(cmd.moving);
        const still = num(cmd.still);
        if (moving !== null) this.radarThresholds.moving = Math.round(Math.min(100, Math.max(5, moving)));
        if (still !== null) this.radarThresholds.still = Math.round(Math.min(100, Math.max(5, still)));
        if (moving !== null || still !== null) this.thresholdSource = 'manual setting';
        return true;
      }
      case 'reset_radar_thresholds':
        this.radarThresholds = { ...this.calibratedRadar };
        this.thresholdSource = 'calibrated values, restored';
        return true;
      case 'set_range': {
        const v = num(cmd.max_cm) ?? 220;
        this.maxCm = Math.round(Math.min(600, Math.max(100, v)));
        return true;
      }
      default:
        return false;
    }
  }

  private tickCalibration(dt: number): void {
    if (this.calState !== 'countdown' && this.calState !== 'measuring') return;
    this.calRemaining -= dt;
    if (this.calState === 'countdown') {
      this.calMessage = `Leave the zone. Measuring starts in ${Math.max(0, Math.ceil(this.calRemaining))} s`;
      if (this.calRemaining <= 0) {
        this.calState = 'measuring';
        this.calRemaining = 15;
      }
    } else {
      this.calMessage = 'Measuring the empty zone for 15 s. Stay out of it';
      if (this.calRemaining <= 0) {
        this.calState = 'done';
        this.calibratedThresholds = { left: 0.1176, right: 0.1257 };
        this.thresholds = { ...this.calibratedThresholds };
        this.calibratedRadar = { moving: 20, still: 20 };
        this.radarThresholds = { ...this.calibratedRadar };
        const d = new Date();
        this.calAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        this.thresholdSource = `hub calibration at ${this.calAt.slice(11)}`;
        this.calMessage = 'Calibrated';
      }
    }
  }

  start(onMessage: (raw: string) => void): void {
    if (this.intervalId !== null) {
      return;
    }
    this.onMessage = onMessage;
    this.intervalId = setInterval(() => {
      this.tick();
    }, 100);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.onMessage = null;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  simulateEntry(): void {
    if (this.demoState === 'clear') {
      // When clear, start a visit with a 1 s activity phase
      this.visitSide = Math.random() < 0.5 ? 'left' : 'right';
      this.demoState = 'activity';
      this.phaseElapsed = 0;
      this.phaseDuration = 1.0;
      this.insideStillExtension = 0;
      this.distanceM = null;
      this.alert = 'approach';
      this.leftMotion = false;
      this.rightMotion = false;
      this.radarLevel = 0.05;
    } else if (this.demoState === 'activity') {
      // During activity, skip to inside, moving
      this.demoState = 'inside_moving';
      this.phaseElapsed = 0;
      this.phaseDuration = 2.5;
      this.distanceM = 1.5;
      this.alert = 'inside';
      this.radarLevel = 0.5;
    } else if (this.demoState === 'inside_moving') {
      // During either inside step, make the still step 3 s longer
      this.insideStillExtension += 3.0;
    } else if (this.demoState === 'inside_still') {
      // During either inside step, make the still step 3 s longer
      this.phaseDuration += 3.0;
    } else if (this.demoState === 'leaving') {
      // While leaving, go back to inside, still, for 3 s
      this.demoState = 'inside_still';
      this.phaseElapsed = 0;
      this.phaseDuration = 3.0;
      this.alert = 'inside';
      this.distanceM = this.distanceM ?? 1.4;
      this.radarLevel = 0.05;
      this.leftMotion = false;
      this.rightMotion = false;
    }
  }

  triggerMovement(): void {
    this.simulateEntry();
  }

  private tick(): void {
    const dt = 0.1; // 100 ms

    // Idle drift on unmonitored baseline
    const idleWalk = (curr: number) => {
      const delta = (Math.random() * 2 - 1) * 0.015 + (0.05 - curr) * 0.1;
      return Math.max(0.02, Math.min(0.09, curr + delta));
    };

    if (this.demoState === 'clear') {
      this.alert = 'clear';
      this.distanceM = null;
      this.leftMotion = false;
      this.rightMotion = false;
      this.radarLevel = idleWalk(this.radarLevel);
      this.leftStrength = idleWalk(this.leftStrength);
      this.rightStrength = idleWalk(this.rightStrength);

      this.timeUntilNextVisit -= dt;
      if (this.timeUntilNextVisit <= 0) {
        // Spontaneous visit: activity 1.5 to 2.5 s
        this.visitSide = Math.random() < 0.5 ? 'left' : 'right';
        this.demoState = 'activity';
        this.phaseElapsed = 0;
        this.phaseDuration = 1.5 + Math.random() * 1.0;
        this.insideStillExtension = 0;
        this.distanceM = null;
        this.alert = 'approach';
        this.leftMotion = false;
        this.rightMotion = false;
        this.radarLevel = 0.05;
      }
    } else if (this.demoState === 'activity') {
      this.phaseElapsed += dt;
      this.alert = 'approach';
      this.distanceM = null;
      this.radarLevel = idleWalk(this.radarLevel);

      const p = Math.min(1, this.phaseElapsed / this.phaseDuration);
      const wobble =
        0.06 * Math.sin(2 * Math.PI * 1.7 * this.phaseElapsed) +
        (Math.random() * 2 - 1) * 0.02;
      const activeStr = Math.max(
        0.05,
        Math.min(0.65, 0.05 + 0.48 * Math.sin(Math.PI * 0.5 * p) + wobble)
      );

      if (this.visitSide === 'left') {
        this.leftStrength = activeStr;
        this.leftMotion =
          this.leftStrength > 0.35
            ? true
            : this.leftStrength < 0.25
            ? false
            : this.leftMotion;
        this.rightStrength = idleWalk(this.rightStrength);
        this.rightMotion = false;
      } else {
        this.rightStrength = activeStr;
        this.rightMotion =
          this.rightStrength > 0.35
            ? true
            : this.rightStrength < 0.25
            ? false
            : this.rightMotion;
        this.leftStrength = idleWalk(this.leftStrength);
        this.leftMotion = false;
      }

      if (this.phaseElapsed >= this.phaseDuration) {
        // Transition to inside, moving: 2 to 3 s
        this.demoState = 'inside_moving';
        this.phaseElapsed = 0;
        this.phaseDuration = 2.0 + Math.random() * 1.0;
        this.alert = 'inside';
        this.distanceM = Number((0.9 + Math.random() * 0.8).toFixed(1)); // 0.9 to 1.7 m: inside a 2 m triangle
        this.radarLevel = 0.45 + Math.random() * 0.15; // 0.4 to 0.6
      }
    } else if (this.demoState === 'inside_moving') {
      this.phaseElapsed += dt;
      this.alert = 'inside';

      // Drift distance by up to 0.05 per tick. Keep full precision here: rounding every
      // tick would cancel the drift. The message rounds it to 0.1 m.
      if (this.distanceM !== null) {
        const drift = (Math.random() * 2 - 1) * 0.05;
        this.distanceM = Math.max(0.7, Math.min(1.7, this.distanceM + drift));
      }

      // Radar movement level 0.4 to 0.6
      this.radarLevel = Math.max(
        0.4,
        Math.min(
          0.6,
          0.5 + 0.08 * Math.sin(2 * Math.PI * 1.5 * this.phaseElapsed) + (Math.random() * 2 - 1) * 0.02
        )
      );

      // The side's link falls back to idle within 1 s
      if (this.phaseElapsed <= 1.0) {
        const fallP = this.phaseElapsed / 1.0;
        const fallingStr = 0.5 * (1 - fallP) + 0.05 * fallP;
        if (this.visitSide === 'left') {
          this.leftStrength = fallingStr;
          this.leftMotion =
            this.leftStrength > 0.35
              ? true
              : this.leftStrength < 0.25
              ? false
              : this.leftMotion;
          this.rightStrength = idleWalk(this.rightStrength);
          this.rightMotion = false;
        } else {
          this.rightStrength = fallingStr;
          this.rightMotion =
            this.rightStrength > 0.35
              ? true
              : this.rightStrength < 0.25
              ? false
              : this.rightMotion;
          this.leftStrength = idleWalk(this.leftStrength);
          this.leftMotion = false;
        }
      } else {
        this.leftMotion = false;
        this.rightMotion = false;
        this.leftStrength = idleWalk(this.leftStrength);
        this.rightStrength = idleWalk(this.rightStrength);
      }

      if (this.phaseElapsed >= this.phaseDuration) {
        // Transition to inside, still: 3 to 6 s (+ extension)
        this.demoState = 'inside_still';
        this.phaseElapsed = 0;
        this.phaseDuration =
          (3.0 + Math.random() * 3.0) + this.insideStillExtension;
        this.insideStillExtension = 0;
        this.alert = 'inside';
        this.leftMotion = false;
        this.rightMotion = false;
      }
    } else if (this.demoState === 'inside_still') {
      this.phaseElapsed += dt;
      this.alert = 'inside';
      // Person stands still: distance stops drifting, radar level idle, motion false
      this.radarLevel = idleWalk(this.radarLevel);
      this.leftMotion = false;
      this.rightMotion = false;
      this.leftStrength = idleWalk(this.leftStrength);
      this.rightStrength = idleWalk(this.rightStrength);

      if (this.phaseElapsed >= this.phaseDuration) {
        // Transition to leaving: about 1.5 s
        this.demoState = 'leaving';
        this.phaseElapsed = 0;
        this.phaseDuration = 1.5;
        this.alert = 'approach';
        this.distanceM = null;
      }
    } else if (this.demoState === 'leaving') {
      this.phaseElapsed += dt;
      this.alert = 'approach';
      this.distanceM = null;
      this.radarLevel = idleWalk(this.radarLevel);

      const p = Math.min(1, this.phaseElapsed / this.phaseDuration);
      const wobble =
        0.06 * Math.sin(2 * Math.PI * 1.7 * this.phaseElapsed) +
        (Math.random() * 2 - 1) * 0.02;
      const leavingStrength = Math.max(
        0.36,
        Math.min(0.6, 0.45 + 0.12 * Math.sin(Math.PI * p) + wobble)
      );

      if (this.visitSide === 'left') {
        this.leftStrength = leavingStrength;
        this.leftMotion =
          this.leftStrength > 0.35
            ? true
            : this.leftStrength < 0.25
            ? false
            : this.leftMotion;
        this.rightStrength = idleWalk(this.rightStrength);
        this.rightMotion = false;
      } else {
        this.rightStrength = leavingStrength;
        this.rightMotion =
          this.rightStrength > 0.35
            ? true
            : this.rightStrength < 0.25
            ? false
            : this.rightMotion;
        this.leftStrength = idleWalk(this.leftStrength);
        this.leftMotion = false;
      }

      if (this.phaseElapsed >= this.phaseDuration) {
        // Clear: alert clear, side drops to idle in this same message
        this.distanceM = null;
        this.demoState = 'clear';
        this.alert = 'clear';
        this.leftMotion = false;
        this.rightMotion = false;
        this.radarLevel = 0.05;
        this.leftStrength = idleWalk(0.05);
        this.rightStrength = idleWalk(0.05);
        this.timeUntilNextVisit = 10 + Math.random() * 10; // 10 to 20 s
      }
    }

    const isRadarMoving = this.demoState === 'inside_moving';
    const topMotion = this.leftMotion || this.rightMotion || isRadarMoving;
    const topStrength = Math.max(this.leftStrength, this.rightStrength, this.radarLevel);

    const confidence = Math.min(
      0.99,
      Math.max(0.05, Number((topStrength * 1.05 + 0.04).toFixed(2)))
    );

    this.tickCalibration(dt);

    if (this.paused) {
      return;
    }

    if (this.onMessage) {
      const leftRssi = Math.round(-67 + (Math.random() * 2 - 1));
      const rightRssi = Math.round(-64 + (Math.random() * 2 - 1));
      const leftPps = Math.round(22 + Math.random() * 3);
      const rightPps = Math.round(22 + Math.random() * 3);
      const links = [
        { id: 'left', motion: this.leftMotion, strength: Number(this.leftStrength.toFixed(3)), rssi: leftRssi, pps: leftPps },
        { id: 'right', motion: this.rightMotion, strength: Number(this.rightStrength.toFixed(3)), rssi: rightRssi, pps: rightPps },
      ];

      // Hub-style raw numbers that match the contract fields above
      const linkDebug = (id: 'left' | 'right', strength: number, motion: boolean, rssi: number, pps: number) => {
        const thr = this.thresholds[id];
        const base = this.baselines[id];
        const score = base + 2 * strength * (thr - base);
        return {
          id,
          mac: this.macs[id],
          online: true,
          pps,
          rssi,
          score: Number(score.toFixed(4)),
          threshold: thr,
          baseline: base,
          block: null,
          block_threshold: null,
          calibrated: true,
          motion,
          evidence: Number(Math.min(2, 2 * strength).toFixed(3)),
          follow_scale: 1,
          calibrated_threshold: this.calibratedThresholds[id],
        };
      };

      const inside = this.alert === 'inside';
      const distCm = this.distanceM !== null ? Math.round(this.distanceM * 100) : this.lastDistanceCm;
      if (this.distanceM !== null) this.lastDistanceCm = distCm;
      const movingNow = this.demoState === 'inside_moving';
      const stillNow = this.demoState === 'inside_still';
      const avgMoving = movingNow ? Math.round(Math.min(100, 40 + 120 * this.radarLevel)) : Math.round(this.radarLevel * 40);
      const avgStill = stillNow ? 100 : inside ? Math.round(60 + 40 * Math.random()) : Math.round(this.radarLevel * 60);
      const state = movingNow ? 3 : stillNow ? 2 : 0;
      const stateName = state === 3 ? 'moving+still' : state === 2 ? 'still' : 'nobody';
      const prediction = movingNow ? 'moving' : stillNow ? 'still' : 'nothing';
      const zoneState = inside ? 'inside' : this.demoState === 'leaving' ? 'left_zone' : 'clear';

      const payload = {
        t: Date.now() / 1000,
        motion: topMotion,
        strength: Number(topStrength.toFixed(3)),
        confidence: Number(confidence.toFixed(3)),
        alert: this.alert,
        distance_m: this.distanceM !== null ? Number(this.distanceM.toFixed(1)) : null,
        entry_side: inside ? this.visitSide : null,
        links,
        nodes: [
          { id: 'hub', online: true },
          { id: 'left', online: true },
          { id: 'right', online: true },
          { id: 'radar', online: true },
        ],
        debug: {
          source: 'demo',
          uptime_s: Math.round((Date.now() - this.startedAt) / 1000),
          links: [
            linkDebug('left', this.leftStrength, this.leftMotion, leftRssi, leftPps),
            linkDebug('right', this.rightStrength, this.rightMotion, rightRssi, rightPps),
          ],
          radar: {
            fps: 10,
            state,
            state_name: stateName,
            moving_cm: distCm,
            moving_energy: movingNow ? Math.round(avgMoving + (Math.random() * 20 - 10)) : 0,
            still_cm: distCm,
            still_energy: inside ? Math.round(Math.min(100, avgStill + (Math.random() * 10 - 5))) : Math.round(avgStill),
            detect_cm: distCm,
            avg_moving: avgMoving,
            avg_still: avgStill,
            moving_threshold: this.radarThresholds.moving,
            still_threshold: this.radarThresholds.still,
            zone_cm: [0, this.maxCm],
            prediction,
            still_beyond_front: false,
            module_nobody: false,
            held: false,
            status: 'RADAR_STATUS,found,rx_gpio=16',
          },
          esp1: { lines_per_s: leftPps + rightPps + 10, garbled: 0 },
          calibration: {
            state: this.calState,
            remaining_s: this.calState === 'countdown' || this.calState === 'measuring' ? Number(Math.max(0, this.calRemaining).toFixed(1)) : null,
            message: this.calMessage,
            at: this.calAt,
            results: null,
          },
          zone: {
            state: zoneState,
            entry_side: inside ? this.visitSide : null,
            entry_logic: false,
            exit_on_crossing: true,
            blocked_sides: zoneState === 'left_zone' ? [this.visitSide] : [],
          },
          settings: {
            baud: 921600,
            baud_fixed: true,
            max_distance_cm: this.maxCm,
            default_max_distance_cm: 220,
            range_limits_cm: [100, 600],
            still_max_cm: Math.round(0.8 * this.maxCm),
            moving_max_cm: Math.round(0.85 * this.maxCm),
            far_entry_cm: Math.round(0.7 * this.maxCm),
            moving_threshold: this.radarThresholds.moving,
            still_threshold: this.radarThresholds.still,
            calibrated_moving_threshold: this.calibratedRadar.moving,
            calibrated_still_threshold: this.calibratedRadar.still,
            threshold_source: this.thresholdSource,
            radar_threshold_limits: [5, 100],
            link_threshold_limits: [0.02, 2],
          },
        },
      };
      this.onMessage(JSON.stringify(payload));
    }
  }
}
