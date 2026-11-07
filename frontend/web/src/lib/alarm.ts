export class ZoneAlarm {
  private audioCtx: AudioContext | null = null;
  private isPlaying = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private currentOsc: OscillatorNode | null = null;
  private currentGain: GainNode | null = null;

  init(): void {
    if (!this.audioCtx && typeof window !== 'undefined') {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }
  }

  start(): void {
    if (this.isPlaying) {
      return;
    }
    this.init();
    if (!this.audioCtx) {
      return;
    }
    this.isPlaying = true;
    void this.playLoop();
  }

  stop(): void {
    if (!this.isPlaying && this.timerId === null && this.currentOsc === null) {
      return;
    }
    this.isPlaying = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.stopTone();
  }

  private stopTone(): void {
    if (this.currentOsc) {
      try {
        this.currentOsc.stop();
        this.currentOsc.disconnect();
      } catch {
        // already stopped
      }
      this.currentOsc = null;
    }
    if (this.currentGain) {
      try {
        this.currentGain.disconnect();
      } catch {
        // already disconnected
      }
      this.currentGain = null;
    }
  }

  private playTone(freq: number, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isPlaying || !this.audioCtx) {
        resolve();
        return;
      }
      this.stopTone();
      try {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
        gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        this.currentOsc = osc;
        this.currentGain = gain;

        osc.start();
        this.timerId = setTimeout(() => {
          this.stopTone();
          this.timerId = null;
          resolve();
        }, durationMs);
      } catch {
        resolve();
      }
    });
  }

  private async playLoop(): Promise<void> {
    while (this.isPlaying) {
      // 880 Hz for 150 ms
      await this.playTone(880, 150);
      if (!this.isPlaying) break;

      // 660 Hz for 150 ms
      await this.playTone(660, 150);
      if (!this.isPlaying) break;

      // 700 ms silence
      await new Promise<void>((resolve) => {
        this.timerId = setTimeout(() => {
          this.timerId = null;
          resolve();
        }, 700);
      });
    }
  }

  destroy(): void {
    this.stop();
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
