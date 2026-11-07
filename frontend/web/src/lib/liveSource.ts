export type LiveSourceStatus =
  | 'connecting'
  | 'open'
  | 'disconnected'
  | 'invalid-url';

export type LiveSourceCallbacks = {
  onMessage: (raw: string) => void;
  onInvalidMessage: () => void;
  onStatusChange: (status: LiveSourceStatus) => void;
  onRetryCountdown: (secondsRemaining: number | null) => void;
};

const BACKOFF_SCHEDULE = [1, 2, 4, 8, 10];

export class LiveSource {
  private active = false;
  private generation = 0;
  private ws: WebSocket | null = null;
  private url = '';
  private callbacks: LiveSourceCallbacks | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private isSchedulingReconnect = false;

  start(url: string, callbacks: LiveSourceCallbacks): void {
    this.stop();

    this.active = true;
    this.generation++;
    this.url = url;
    this.callbacks = callbacks;
    this.attempt = 0;

    let parsed: URL;
    try {
      parsed = new URL(url);
      if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
        callbacks.onStatusChange('invalid-url');
        return;
      }
    } catch {
      callbacks.onStatusChange('invalid-url');
      return;
    }

    this.connect();
  }

  stop(): void {
    this.active = false;
    this.generation++;
    this.clearTimers();

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Socket already closed
      }
    }

    this.callbacks?.onRetryCountdown(null);
    this.callbacks = null;
    this.isSchedulingReconnect = false;
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.isSchedulingReconnect = false;
  }

  private connect(): void {
    if (!this.active || !this.callbacks) {
      return;
    }

    const currentGen = this.generation;
    this.clearTimers();
    this.callbacks.onRetryCountdown(null);
    this.callbacks.onStatusChange('connecting');

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect(currentGen);
      return;
    }

    this.ws.onopen = () => {
      if (!this.active || this.generation !== currentGen) {
        return;
      }
      this.attempt = 0;
      this.isSchedulingReconnect = false;
      this.callbacks?.onRetryCountdown(null);
      this.callbacks?.onStatusChange('open');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (!this.active || this.generation !== currentGen) {
        return;
      }
      if (typeof event.data === 'string') {
        this.callbacks?.onMessage(event.data);
      } else {
        this.callbacks?.onInvalidMessage();
      }
    };

    this.ws.onerror = () => {
      if (!this.active || this.generation !== currentGen) {
        return;
      }
      this.scheduleReconnect(currentGen);
    };

    this.ws.onclose = () => {
      if (!this.active || this.generation !== currentGen) {
        return;
      }
      this.scheduleReconnect(currentGen);
    };
  }

  private scheduleReconnect(forGeneration: number): void {
    if (this.isSchedulingReconnect) {
      return;
    }
    this.isSchedulingReconnect = true;

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Socket already closed
      }
    }

    if (!this.active || this.generation !== forGeneration || !this.callbacks) {
      return;
    }

    this.callbacks.onStatusChange('disconnected');

    const delay =
      BACKOFF_SCHEDULE[Math.min(this.attempt, BACKOFF_SCHEDULE.length - 1)];
    this.attempt++;

    let secondsLeft = delay;
    this.callbacks.onRetryCountdown(secondsLeft);

    this.countdownTimer = setInterval(() => {
      if (!this.active || this.generation !== forGeneration || !this.callbacks) {
        this.clearTimers();
        return;
      }
      secondsLeft--;
      if (secondsLeft > 0) {
        this.callbacks.onRetryCountdown(secondsLeft);
      } else {
        this.clearTimers();
        this.connect();
      }
    }, 1000);
  }
}
