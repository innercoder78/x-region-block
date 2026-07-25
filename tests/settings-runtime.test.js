import { describe, expect, it, vi } from 'vitest';

import { SETTINGS_STORAGE_KEY } from '../src/shared/settings-repository.js';
import { createSettingsRuntime } from '../src/shared/settings-runtime.js';
import { createDefaultSettings } from '../src/shared/settings-schema.js';

function harness(initializeSettings = vi.fn().mockResolvedValue(createDefaultSettings())) {
  let listener;
  const remove = vi.fn();
  const runtime = createSettingsRuntime({
    repository: { initializeSettings },
    changeAdapter: {
      subscribe: vi.fn((next) => { listener = next; return remove; }),
    },
    onError: vi.fn(),
  });
  return { runtime, initializeSettings, remove, emit: (...args) => listener(...args) };
}

const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('settings runtime', () => {
  it('starts once, shares concurrent starts, freezes and notifies its snapshot', async () => {
    const deferred = Promise.withResolvers();
    const h = harness(vi.fn(() => deferred.promise));
    const subscriber = vi.fn();
    h.runtime.subscribe(subscriber);
    expect(h.runtime.getSettings()).toBeNull();
    const first = h.runtime.start();
    expect(h.runtime.start()).toBe(first);
    deferred.resolve(createDefaultSettings());
    const settings = await first;
    expect(h.initializeSettings).toHaveBeenCalledOnce();
    expect(subscriber).toHaveBeenCalledWith(settings);
    expect(Object.isFrozen(settings)).toBe(true);
    expect(Object.isFrozen(settings.country.hide)).toBe(true);
    const late = vi.fn();
    h.runtime.subscribe(late);
    expect(late).toHaveBeenCalledWith(settings);
  });

  it('removes a failed startup listener and permits retry', async () => {
    const h = harness(vi.fn().mockRejectedValueOnce(new Error('storage')).mockResolvedValue(createDefaultSettings()));
    await expect(h.runtime.start()).rejects.toThrow('storage');
    expect(h.remove).toHaveBeenCalledOnce();
    await expect(h.runtime.start()).resolves.toEqual(createDefaultSettings());
  });

  it('filters events and only publishes changed canonical settings', async () => {
    const changed = { ...createDefaultSettings(), allowlist: ['account'] };
    const initialize = vi.fn().mockResolvedValueOnce(createDefaultSettings()).mockResolvedValue(changed);
    const h = harness(initialize);
    const subscriber = vi.fn();
    h.runtime.subscribe(subscriber);
    await h.runtime.start();
    h.emit({ unrelated: {} }, 'local');
    h.emit({ [SETTINGS_STORAGE_KEY]: {} }, 'sync');
    await tick();
    expect(initialize).toHaveBeenCalledOnce();
    h.emit({ [SETTINGS_STORAGE_KEY]: { newValue: 'ignored' } }, 'local');
    await tick();
    expect(h.runtime.getSettings().allowlist).toEqual(['account']);
    expect(subscriber).toHaveBeenCalledTimes(2);
  });

  it('preserves valid state after errors and processes a later update', async () => {
    const valid = createDefaultSettings();
    const later = { ...valid, allowlist: ['later'] };
    const initialize = vi.fn().mockResolvedValueOnce(valid)
      .mockRejectedValueOnce(new TypeError('secret malformed value'))
      .mockResolvedValueOnce(later);
    const h = harness(initialize);
    await h.runtime.start();
    h.emit({ [SETTINGS_STORAGE_KEY]: {} }, 'local');
    await tick();
    expect(h.runtime.getSettings()).toEqual(valid);
    h.emit({ [SETTINGS_STORAGE_KEY]: {} }, 'local');
    await tick();
    expect(h.runtime.getSettings().allowlist).toEqual(['later']);
  });

  it('isolates subscribers, supports unsubscribe, and stops event reads', async () => {
    const h = harness();
    const good = vi.fn();
    h.runtime.subscribe(() => { throw new Error('subscriber'); });
    const unsubscribe = h.runtime.subscribe(good);
    await h.runtime.start();
    expect(good).toHaveBeenCalledOnce();
    unsubscribe();
    unsubscribe();
    h.runtime.stop();
    h.runtime.stop();
    expect(h.remove).toHaveBeenCalledOnce();
    h.emit({ [SETTINGS_STORAGE_KEY]: {} }, 'local');
    await tick();
    expect(h.initializeSettings).toHaveBeenCalledOnce();
    await h.runtime.start();
    expect(h.initializeSettings).toHaveBeenCalledTimes(2);
  });
});
