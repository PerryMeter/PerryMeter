import type { AlertLevel } from './contract';

type DemoState = 'clear' | 'approach' | 'entry';

export class DemoSource {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onMessage: ((raw: string) => void) | null = null;
  private paused = false;

  // Signal state
  private strength = 0.06;
  private motion = false;
  private alert: AlertLevel = 'clear';
  private distanceM: number | null = null;

  // State machine
  private demoState: DemoState = 'clear';
  private timeUntilNextVisit = 10 + Math.random() * 10; // 10 to 20 s

  // Approach state
  private approachElapsed = 0;
  private approachDuration = 2.5;

  // Entry episode state
  private episodeElapsed = 0;
  private episodeDuration = 5;
  private episodePeak = 0.75;
  private episodeStartStrength = 0.06;

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
    if (this.demoState === 'approach') {
      // While approaching, skip straight to the entry
      this.startEntryEpisode();
    } else if (this.demoState === 'entry') {
      // During entry, extend it as in section 5.1
      const extension = 3 + Math.random() * 5; // 3 to 8 s
      const targetPeak = 0.55 + Math.random() * 0.4; // 0.55 to 0.95
      this.episodePeak = Math.max(this.episodePeak, targetPeak);
      const fallDuration = 1.2;
      const riseDuration = 0.8;

      if (this.episodeElapsed > this.episodeDuration - fallDuration) {
        this.episodeElapsed = riseDuration;
        this.episodeDuration = riseDuration + extension;
      } else {
        this.episodeDuration = Math.max(
          this.episodeDuration,
          this.episodeElapsed + extension,
        );
      }
    } else {
      // When clear, start a visit with a 1.5 s approach
      this.demoState = 'approach';
      this.approachElapsed = 0;
      this.approachDuration = 1.5;
      this.distanceM = 5.5;
      this.alert = 'approach';
      this.motion = false;
    }
  }

  triggerMovement(): void {
    this.simulateEntry();
  }

  private startEntryEpisode(): void {
    this.demoState = 'entry';
    this.distanceM = null;
    this.episodeElapsed = 0;
    this.episodeDuration = 3 + Math.random() * 5; // 3 to 8 s
    this.episodePeak = 0.55 + Math.random() * 0.4;
    this.episodeStartStrength = this.strength;
  }

  private tick(): void {
    const dt = 0.1; // 100 ms

    if (this.demoState === 'clear') {
      this.alert = 'clear';
      this.distanceM = null;
      this.motion = false;

      // Random walk around 0.06
      const delta =
        (Math.random() * 2 - 1) * 0.02 + (0.06 - this.strength) * 0.1;
      this.strength = Math.max(0.02, Math.min(0.16, this.strength + delta));

      this.timeUntilNextVisit -= dt;
      if (this.timeUntilNextVisit <= 0) {
        // Spontaneous visit: 2 to 3 s approach
        this.demoState = 'approach';
        this.approachElapsed = 0;
        this.approachDuration = 2 + Math.random() * 1;
        this.distanceM = 5.5;
        this.alert = 'approach';
      }
    } else if (this.demoState === 'approach') {
      this.approachElapsed += dt;
      this.alert = 'approach';
      this.motion = false;

      // Idle strength walk
      const delta =
        (Math.random() * 2 - 1) * 0.02 + (0.06 - this.strength) * 0.1;
      this.strength = Math.max(0.02, Math.min(0.16, this.strength + delta));

      // Distance falls from 5.5 to 1.0 in a straight line +/- 0.1 noise
      const progress = Math.min(1, this.approachElapsed / this.approachDuration);
      const linearDist = 5.5 - (5.5 - 1.0) * progress;
      const noise = (Math.random() * 2 - 1) * 0.1;
      this.distanceM = Number(Math.max(0, Math.min(20, linearDist + noise)).toFixed(1));

      if (this.approachElapsed >= this.approachDuration) {
        this.startEntryEpisode();
      }
    } else if (this.demoState === 'entry') {
      this.episodeElapsed += dt;
      this.distanceM = null;

      const riseDuration = 0.8;
      const fallDuration = 1.2;
      let baseStrength = 0.06;

      if (this.episodeElapsed < riseDuration) {
        const progress = this.episodeElapsed / riseDuration;
        baseStrength =
          this.episodeStartStrength +
          (this.episodePeak - this.episodeStartStrength) * progress;
      } else if (this.episodeElapsed > this.episodeDuration - fallDuration) {
        const remaining = Math.max(0, this.episodeDuration - this.episodeElapsed);
        const progress = remaining / fallDuration;
        baseStrength = 0.06 + (this.episodePeak - 0.06) * progress;
      } else {
        baseStrength = this.episodePeak;
      }

      // Wobble
      const wobble =
        0.08 * Math.sin(2 * Math.PI * 1.7 * this.episodeElapsed) +
        (Math.random() * 2 - 1) * 0.02;

      this.strength = Math.max(0, Math.min(1, baseStrength + wobble));

      // Motion hysteresis
      if (this.strength > 0.35) {
        this.motion = true;
      } else if (this.strength < 0.25) {
        this.motion = false;
      }

      this.alert = this.motion ? 'inside' : 'clear';

      // After episode duration and motion has fallen back to false
      if (this.episodeElapsed >= this.episodeDuration && !this.motion) {
        this.demoState = 'clear';
        this.alert = 'clear';
        this.timeUntilNextVisit = 10 + Math.random() * 10; // 10 to 20 s
      }
    }

    // Confidence: high when far from threshold, lower near it
    const rawConf =
      0.55 +
      0.45 * Math.min(1, Math.abs(this.strength - 0.3) / 0.3) +
      (Math.random() * 2 - 1) * 0.03;
    const confidence = Math.max(0, Math.min(1, rawConf));

    if (this.paused) {
      return;
    }

    if (this.onMessage) {
      const payload = {
        t: Date.now() / 1000,
        motion: this.motion,
        strength: Number(this.strength.toFixed(3)),
        confidence: Number(confidence.toFixed(3)),
        alert: this.alert,
        distance_m: this.distanceM,
      };
      this.onMessage(JSON.stringify(payload));
    }
  }
}
