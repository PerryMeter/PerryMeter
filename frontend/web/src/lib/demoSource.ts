import type { AlertLevel } from './contract';

type DemoState = 'clear' | 'near' | 'crossing' | 'inside' | 'exit_crossing';

export class DemoSource {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onMessage: ((raw: string) => void) | null = null;
  private paused = false;

  // Signal state
  private demoState: DemoState = 'clear';
  private visitSide: 'left' | 'right' = 'left';
  private phaseElapsed = 0;
  private phaseDuration = 0;
  private insideExtension = 0;
  private timeUntilNextVisit = 10 + Math.random() * 10; // 10 to 20 s

  private leftStrength = 0.05;
  private rightStrength = 0.05;
  private leftMotion = false;
  private rightMotion = false;
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
      // When clear, start a visit with a 1 s near phase
      this.visitSide = Math.random() < 0.5 ? 'left' : 'right';
      this.demoState = 'near';
      this.phaseElapsed = 0;
      this.phaseDuration = 1.0;
      this.insideExtension = 0;
      this.distanceM = null;
      this.alert = 'approach';
      this.leftMotion = false;
      this.rightMotion = false;
    } else if (this.demoState === 'near') {
      // During the near phase, skip to the crossing
      this.demoState = 'crossing';
      this.phaseElapsed = 0;
      this.phaseDuration = 1.2;
      this.distanceM = null;
      this.alert = 'inside';
      if (this.visitSide === 'left') {
        this.leftMotion = true;
        this.leftStrength = 0.75;
      } else {
        this.rightMotion = true;
        this.rightStrength = 0.75;
      }
    } else if (this.demoState === 'crossing') {
      // During crossing phase, extend upcoming inside phase by 3 s
      this.insideExtension += 3.0;
    } else if (this.demoState === 'inside') {
      // During inside phase, extend it by 3 s
      this.phaseDuration += 3.0;
    } else if (this.demoState === 'exit_crossing') {
      // Re-enter inside phase with 3 s
      this.demoState = 'inside';
      this.phaseElapsed = 0;
      this.phaseDuration = 3.0;
      this.alert = 'inside';
      this.leftMotion = false;
      this.rightMotion = false;
      if (this.distanceM === null) {
        this.distanceM = 1.8;
      }
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
      this.leftStrength = idleWalk(this.leftStrength);
      this.rightStrength = idleWalk(this.rightStrength);

      this.timeUntilNextVisit -= dt;
      if (this.timeUntilNextVisit <= 0) {
        // Spontaneous visit: near 1.5 to 2.5 s
        this.visitSide = Math.random() < 0.5 ? 'left' : 'right';
        this.demoState = 'near';
        this.phaseElapsed = 0;
        this.phaseDuration = 1.5 + Math.random() * 1.0;
        this.insideExtension = 0;
        this.distanceM = null;
        this.alert = 'approach';
      }
    } else if (this.demoState === 'near') {
      this.phaseElapsed += dt;
      this.alert = 'approach';
      this.distanceM = null;
      this.leftMotion = false;
      this.rightMotion = false;

      const progress = Math.min(1, this.phaseElapsed / this.phaseDuration);
      const nearStrength = Math.min(
        0.28,
        0.05 + 0.20 * progress + (Math.random() * 2 - 1) * 0.015
      );

      if (this.visitSide === 'left') {
        this.leftStrength = nearStrength;
        this.rightStrength = idleWalk(this.rightStrength);
      } else {
        this.rightStrength = nearStrength;
        this.leftStrength = idleWalk(this.leftStrength);
      }

      if (this.phaseElapsed >= this.phaseDuration) {
        // Transition to crossing: about 1 to 1.5 s
        this.demoState = 'crossing';
        this.phaseElapsed = 0;
        this.phaseDuration = 1.0 + Math.random() * 0.5;
        this.alert = 'inside';
        const crossStr = 0.55;
        if (this.visitSide === 'left') {
          this.leftStrength = crossStr;
          this.leftMotion = true;
        } else {
          this.rightStrength = crossStr;
          this.rightMotion = true;
        }
      }
    } else if (this.demoState === 'crossing') {
      this.phaseElapsed += dt;
      this.alert = 'inside';
      this.distanceM = null;

      // Strength rises above 0.35 with wobble
      const p = Math.min(1, this.phaseElapsed / this.phaseDuration);
      const wobble =
        0.06 * Math.sin(2 * Math.PI * 1.7 * this.phaseElapsed) +
        (Math.random() * 2 - 1) * 0.02;
      const crossingStrength = Math.max(
        0.36,
        Math.min(0.92, 0.55 + 0.25 * Math.sin(Math.PI * p) + wobble)
      );

      if (this.visitSide === 'left') {
        this.leftStrength = crossingStrength;
        this.leftMotion = this.leftStrength > 0.35 ? true : this.leftStrength < 0.25 ? false : this.leftMotion;
        this.rightStrength = idleWalk(this.rightStrength);
        this.rightMotion = false;
      } else {
        this.rightStrength = crossingStrength;
        this.rightMotion = this.rightStrength > 0.35 ? true : this.rightStrength < 0.25 ? false : this.rightMotion;
        this.leftStrength = idleWalk(this.leftStrength);
        this.leftMotion = false;
      }

      if (this.phaseElapsed >= this.phaseDuration) {
        // Transition to inside: 2 to 5 s (+ any extension)
        this.demoState = 'inside';
        this.phaseElapsed = 0;
        this.phaseDuration = (2.0 + Math.random() * 3.0) + this.insideExtension;
        this.insideExtension = 0;
        this.distanceM = Number((1.2 + Math.random() * 1.6).toFixed(1)); // 1.0 to 3.0 m
        this.alert = 'inside';
        this.leftMotion = false;
        this.rightMotion = false;
      }
    } else if (this.demoState === 'inside') {
      this.phaseElapsed += dt;
      // Alert STAYS 'inside' because of the radar
      this.alert = 'inside';
      this.leftMotion = false;
      this.rightMotion = false;
      this.leftStrength = idleWalk(this.leftStrength);
      this.rightStrength = idleWalk(this.rightStrength);

      // Radar distance drifts by up to 0.05 per tick
      if (this.distanceM !== null) {
        const drift = (Math.random() * 2 - 1) * 0.04;
        this.distanceM = Number(Math.max(1.0, Math.min(3.0, this.distanceM + drift)).toFixed(1));
      }

      if (this.phaseElapsed >= this.phaseDuration) {
        // Transition to exit crossing: about 1 s
        this.demoState = 'exit_crossing';
        this.phaseElapsed = 0;
        this.phaseDuration = 1.0;
        this.alert = 'inside';
      }
    } else if (this.demoState === 'exit_crossing') {
      this.phaseElapsed += dt;
      this.alert = 'inside';

      const p = Math.min(1, this.phaseElapsed / this.phaseDuration);
      const wobble =
        0.06 * Math.sin(2 * Math.PI * 1.7 * this.phaseElapsed) +
        (Math.random() * 2 - 1) * 0.02;
      const crossingStrength = Math.max(
        0.36,
        Math.min(0.90, 0.50 + 0.28 * Math.sin(Math.PI * p) + wobble)
      );

      if (this.visitSide === 'left') {
        this.leftStrength = crossingStrength;
        this.leftMotion = this.leftStrength > 0.35 ? true : this.leftStrength < 0.25 ? false : this.leftMotion;
        this.rightStrength = idleWalk(this.rightStrength);
        this.rightMotion = false;
      } else {
        this.rightStrength = crossingStrength;
        this.rightMotion = this.rightStrength > 0.35 ? true : this.rightStrength < 0.25 ? false : this.rightMotion;
        this.leftStrength = idleWalk(this.leftStrength);
        this.leftMotion = false;
      }

      if (this.phaseElapsed >= this.phaseDuration) {
        // End of visit: distance becomes null, alert becomes clear
        this.distanceM = null;
        this.demoState = 'clear';
        this.alert = 'clear';
        this.leftMotion = false;
        this.rightMotion = false;
        // The person has left: drop the crossed side back to idle in this same message,
        // so a CLEAR message never carries a crossing-level strength.
        this.leftStrength = idleWalk(0.05);
        this.rightStrength = idleWalk(0.05);
        this.timeUntilNextVisit = 10 + Math.random() * 10; // 10 to 20 s
      }
    }

    const topMotion = this.leftMotion || this.rightMotion;
    const topStrength = Math.max(this.leftStrength, this.rightStrength);

    // Confidence: high when far from threshold, lower near it
    const rawConf =
      0.55 +
      0.45 * Math.min(1, Math.abs(topStrength - 0.3) / 0.3) +
      (Math.random() * 2 - 1) * 0.03;
    const confidence = Math.max(0, Math.min(1, rawConf));

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
            rssi: Math.round(-58 + (Math.random() * 2 - 1)),
            pps: Math.round(27 + Math.random() * 2),
          },
          {
            id: 'right',
            motion: this.rightMotion,
            strength: Number(this.rightStrength.toFixed(3)),
            rssi: Math.round(-61 + (Math.random() * 2 - 1)),
            pps: Math.round(27 + Math.random() * 2),
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
