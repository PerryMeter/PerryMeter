export type Mode = 'demo' | 'live';

const MODE_STORAGE_KEY = 'radarping.mode';
const WS_URL_STORAGE_KEY = 'radarping.wsUrl';
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

function safeGetStorage(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
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

  const storedMode = safeGetStorage(MODE_STORAGE_KEY);
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

  const storedWs = safeGetStorage(WS_URL_STORAGE_KEY);
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
