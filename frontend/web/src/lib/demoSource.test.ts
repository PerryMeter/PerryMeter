import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoSource } from './demoSource';
import { parseHubDebug } from './hubDebug';

/** Runs the demo's fake hub for one message and returns its parsed arm state. */
function armAfter(messages: string[]) {
  vi.advanceTimersByTime(100);
  return parseHubDebug(messages[messages.length - 1])?.arm ?? null;
}

describe('DemoSource arming', () => {
  let demo: DemoSource;
  const messages: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    messages.length = 0;
    demo = new DemoSource();
    demo.start((raw) => messages.push(raw));
  });

  afterEach(() => {
    demo.stop();
    vi.useRealTimers();
  });

  it('starts armed and disarms only with the PIN', () => {
    expect(armAfter(messages)).toMatchObject({ armed: true, rejections: 0, lockedS: 0 });

    expect(demo.applyCommand({ type: 'set_armed', armed: false, pin: '1234' })).toBe(true);
    expect(armAfter(messages)).toMatchObject({ armed: true, rejections: 1 });

    demo.applyCommand({ type: 'set_armed', armed: false, pin: '6767' });
    const arm = armAfter(messages);
    expect(arm).toMatchObject({ armed: false, rejections: 1 });
    expect(arm?.changedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('locks for 30 s after 5 wrong PINs in a row', () => {
    for (let i = 0; i < 5; i++) demo.applyCommand({ type: 'set_armed', armed: false, pin: '0000' });
    const locked = armAfter(messages);
    expect(locked?.rejections).toBe(5);
    expect(locked?.lockedS).toBeGreaterThan(29);

    demo.applyCommand({ type: 'set_armed', armed: false, pin: '6767' });
    expect(armAfter(messages)).toMatchObject({ armed: true, rejections: 5 });

    vi.advanceTimersByTime(30_000);
    demo.applyCommand({ type: 'set_armed', armed: false, pin: '6767' });
    expect(armAfter(messages)).toMatchObject({ armed: false, lockedS: 0 });
  });

  it('refuses a command without a true/false state', () => {
    expect(demo.applyCommand({ type: 'set_armed', pin: '6767' })).toBe(false);
  });
});
