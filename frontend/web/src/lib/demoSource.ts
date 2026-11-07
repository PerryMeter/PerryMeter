export class DemoSource {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onMessage: ((raw: string) => void) | null = null;
  private paused = false;

  // Signal state
  private strength = 0.06;
  private motion = false;

  // Episode state
  private inEpisode = false;
  private episodeElapsed = 0;
  private episodeDuration = 5;
  private episodePeak = 0.75;
  private episodeStartStrength = 0.06;
  private timeUntilNextEpisode = 10;

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

  triggerMovement(): void {
    const extension = 3 + Math.random() * 5; // 3 to 8 s
    const targetPeak = 0.55 + Math.random() * 0.40; // 0.55 to 0.95

    if (this.inEpisode) {
      // Extend current episode
      this.episodePeak = Math.max(this.episodePeak, targetPeak);
      const fallDuration = 1.2;
      const riseDuration = 0.8;

      if (this.episodeElapsed > this.episodeDuration - fallDuration) {
        // Was already falling, return to plateau
        this.episodeElapsed = riseDuration;
        this.episodeDuration = riseDuration + extension;
      } else {
        // Still rising or on plateau: ensure at least extension seconds remain
        this.episodeDuration = Math.max(
          this.episodeDuration,
          this.episodeElapsed + extension,
        );
      }
    } else {
      // Start a new episode rising from current strength
      this.inEpisode = true;
      this.episodeElapsed = 0;
      this.episodeDuration = extension;
      this.episodePeak = Math.max(this.strength, targetPeak);
      this.episodeStartStrength = this.strength;
    }
  }

  private tick(): void {
    const dt = 0.1; // 100 ms

    if (!this.inEpisode) {
      this.timeUntilNextEpisode -= dt;
      if (this.timeUntilNextEpisode <= 0) {
        this.triggerMovement();
      } else {
        // Slow random walk around 0.06 (range 0.02 to 0.16), step <= 0.02
        const delta =
          (Math.random() * 2 - 1) * 0.02 + (0.06 - this.strength) * 0.1;
        this.strength = Math.max(0.02, Math.min(0.16, this.strength + delta));
      }
    }

    if (this.inEpisode) {
      this.episodeElapsed += dt;

      // Rise over ~0.8s, fall back to idle over ~1.2s
      let baseStrength = 0.06;
      const riseDuration = 0.8;
      const fallDuration = 1.2;

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

      // Active wobble: 0.08 * sin(2 * PI * 1.7 * seconds) + small noise
      const wobble =
        0.08 * Math.sin(2 * Math.PI * 1.7 * this.episodeElapsed) +
        (Math.random() * 2 - 1) * 0.02;

      this.strength = Math.max(0, Math.min(1, baseStrength + wobble));

      if (this.episodeElapsed >= this.episodeDuration) {
        this.inEpisode = false;
        this.timeUntilNextEpisode = 8 + Math.random() * 12; // 8 to 20 s
      }
    }

    // Motion hysteresis: > 0.35 => true, < 0.25 => false
    if (this.strength > 0.35) {
      this.motion = true;
    } else if (this.strength < 0.25) {
      this.motion = false;
    }

    // Confidence: high when far from threshold, lower near it
    const rawConf =
      0.55 +
      0.45 * Math.min(1, Math.abs(this.strength - 0.30) / 0.30) +
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
      };
      this.onMessage(JSON.stringify(payload));
    }
  }
}
