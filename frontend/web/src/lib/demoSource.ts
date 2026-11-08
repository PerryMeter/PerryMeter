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
      this.distanceM = 2.1;
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
      this.distanceM = this.distanceM ?? 2.0;
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
        this.distanceM = Number((1.2 + Math.random() * 1.6).toFixed(1)); // 1.0 to 3.0 m
        this.radarLevel = 0.45 + Math.random() * 0.15; // 0.4 to 0.6
      }
    } else if (this.demoState === 'inside_moving') {
      this.phaseElapsed += dt;
      this.alert = 'inside';

      // Drift distance by up to 0.05 per tick
      if (this.distanceM !== null) {
        const drift = (Math.random() * 2 - 1) * 0.04;
        this.distanceM = Number(
          Math.max(1.0, Math.min(3.0, this.distanceM + drift)).toFixed(1)
        );
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

    if (this.paused) {
      return;
    }

    if (this.onMessage) {
      const payload = {
        t: Date.now() / 1000,
        motion: topMotion,
        strength: Number(topStrength.toFixed(3)),
        confidence: Number(confidence.toFixed(3)),
        alert: this.alert,
        distance_m: this.distanceM !== null ? Number(this.distanceM.toFixed(1)) : null,
        links: [
          {
            id: 'left',
            motion: this.leftMotion,
            strength: Number(this.leftStrength.toFixed(3)),
            rssi: Math.round(-55 + (Math.random() * 2 - 1)),
            pps: Math.round(68 + Math.random() * 4),
          },
          {
            id: 'right',
            motion: this.rightMotion,
            strength: Number(this.rightStrength.toFixed(3)),
            rssi: Math.round(-58 + (Math.random() * 2 - 1)),
            pps: Math.round(68 + Math.random() * 4),
          },
        ],
        nodes: [
          { id: 'hub', online: true },
          { id: 'left', online: true },
          { id: 'right', online: true },
          { id: 'radar', online: true },
        ],
      };
      this.onMessage(JSON.stringify(payload));
    }
  }
}
