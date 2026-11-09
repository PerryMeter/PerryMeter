export type Mode = 'demo' | 'live';

const MODE_STORAGE_KEY = 'perrymeter.mode';
const WS_URL_STORAGE_KEY = 'perrymeter.wsUrl';
const ARMED_STORAGE_KEY = 'perrymeter.armed';

const OLD_MODE_STORAGE_KEY = 'radarping.mode';
const OLD_WS_URL_STORAGE_KEY = 'radarping.wsUrl';
const OLD_ARMED_STORAGE_KEY = 'radarping.armed';

const DEFAULT_MODE: Mode = 'demo';
const DEFAULT_WS_URL = 'ws://localhost:8765';

function getSearchParam(key: string): string | null {
  if (typeof window === 'undefined' || !window.location) {
    return null;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
  } catch {
    return null;
  }
}

function safeGetMigratedStorage(newKey: string, oldKey: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const val = window.localStorage.getItem(newKey);
    if (val !== null) {
      return val;
    }
    const oldVal = window.localStorage.getItem(oldKey);
    if (oldVal !== null) {
      try {
        window.localStorage.setItem(newKey, oldVal);
      } catch {
        // Storage access blocked or quota exceeded
      }
      return oldVal;
    }
    return null;
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage access blocked or quota exceeded
  }
}

export function getInitialMode(): Mode {
  const queryMode = getSearchParam('mode');
  if (queryMode === 'demo' || queryMode === 'live') {
    return queryMode;
  }

  const storedMode = safeGetMigratedStorage(MODE_STORAGE_KEY, OLD_MODE_STORAGE_KEY);
  if (storedMode === 'demo' || storedMode === 'live') {
    return storedMode;
  }

  return DEFAULT_MODE;
}

export function saveMode(mode: Mode): void {
  safeSetStorage(MODE_STORAGE_KEY, mode);
}

export function getInitialWsUrl(): string {
  const queryWs = getSearchParam('ws');
  if (queryWs !== null && queryWs.trim().length > 0) {
    return queryWs.trim();
  }

  const storedWs = safeGetMigratedStorage(WS_URL_STORAGE_KEY, OLD_WS_URL_STORAGE_KEY);
  if (storedWs !== null && storedWs.trim().length > 0) {
    return storedWs.trim();
  }

  const envWs = import.meta.env.VITE_WS_URL as string | undefined;
  if (typeof envWs === 'string' && envWs.trim().length > 0) {
    return envWs.trim();
  }

  return DEFAULT_WS_URL;
}

export function saveWsUrl(url: string): void {
  safeSetStorage(WS_URL_STORAGE_KEY, url);
}

export function isKioskMode(): boolean {
  return getSearchParam('kiosk') === '1';
}

export function getInitialArmed(): boolean {
  const stored = safeGetMigratedStorage(ARMED_STORAGE_KEY, OLD_ARMED_STORAGE_KEY);
  if (stored === '0') return false;
  if (stored === '1') return true;
  return true;
}

export function saveArmed(armed: boolean): void {
  safeSetStorage(ARMED_STORAGE_KEY, armed ? '1' : '0');
}

const SENSORS_STORAGE_KEY = 'perrymeter.sensors';

/** Sensors panel open: ?sensors=1 or 0 wins, then the saved choice, default closed. */
export function getInitialSensorsOpen(): boolean {
  const query = getSearchParam('sensors');
  if (query === '1') return true;
  if (query === '0') return false;
  try {
    return window.localStorage.getItem(SENSORS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveSensorsOpen(open: boolean): void {
  safeSetStorage(SENSORS_STORAGE_KEY, open ? '1' : '0');
}
