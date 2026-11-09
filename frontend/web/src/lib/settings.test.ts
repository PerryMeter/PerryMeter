import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, getInitialView, getViewOverride, loadSettings, saveSettings } from './settings';

const KEY = 'perrymeter.settings';

/** A fake browser window: the address bar's query string and a localStorage. */
function stubWindow(search: string, stored: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(stored));
  vi.stubGlobal('window', {
    location: { search },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
    matchMedia: () => ({ matches: false }),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('view setting', () => {
  it('defaults to Simple, also on the kiosk', () => {
    expect(DEFAULT_SETTINGS.view).toBe('simple');
    stubWindow('');
    expect(getInitialView()).toBe('simple');
    stubWindow('?kiosk=1&mode=live');
    expect(getInitialView()).toBe('simple');
  });

  it('uses the choice saved in localStorage', () => {
    stubWindow('', { [KEY]: JSON.stringify({ view: 'admin' }) });
    expect(loadSettings().view).toBe('admin');
    expect(getInitialView()).toBe('admin');
    stubWindow('?kiosk=1', { [KEY]: JSON.stringify({ view: 'admin', theme: 'light' }) });
    expect(getInitialView()).toBe('admin');
  });

  it('lets ?view= override the saved choice', () => {
    stubWindow('?view=admin', { [KEY]: JSON.stringify({ view: 'simple' }) });
    expect(getViewOverride()).toBe('admin');
    expect(getInitialView()).toBe('admin');
    stubWindow('?kiosk=1&view=simple', { [KEY]: JSON.stringify({ view: 'admin' }) });
    expect(getInitialView()).toBe('simple');
  });

  it('ignores invalid values', () => {
    stubWindow('?view=expert', { [KEY]: JSON.stringify({ view: 'admin' }) });
    expect(getViewOverride()).toBeNull();
    expect(getInitialView()).toBe('admin');
    stubWindow('', { [KEY]: JSON.stringify({ view: 42 }) });
    expect(getInitialView()).toBe('simple');
    stubWindow('', { [KEY]: '{not json' });
    expect(getInitialView()).toBe('simple');
  });

  it('saves the view with the other settings, never the URL override', () => {
    const store = stubWindow('?view=admin');
    const settings = loadSettings();
    expect(settings.view).toBe('simple'); // the override is not part of the saved settings
    saveSettings({ ...settings, units: 'imperial' });
    expect(JSON.parse(store.get(KEY) ?? '{}')).toMatchObject({ view: 'simple', units: 'imperial' });
    saveSettings({ ...settings, view: 'admin' });
    stubWindow('', Object.fromEntries(store));
    expect(getInitialView()).toBe('admin');
  });

  it('falls back to Simple when storage is blocked', () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(getInitialView()).toBe('simple');
    expect(() => saveSettings({ ...DEFAULT_SETTINGS, view: 'admin' })).not.toThrow();
  });
});
