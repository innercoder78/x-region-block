import { describe, expect, it, vi } from 'vitest';

import { createSettingsRepository, SETTINGS_STORAGE_KEY } from '../src/shared/settings-repository.js';
import { createSettingsRuntime } from '../src/shared/settings-runtime.js';
import { createDefaultSettings } from '../src/shared/settings-schema.js';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness(initializeSettings = vi.fn().mockResolvedValue(createDefaultSettings()), onError = vi.fn()) {
  const listeners = [];
  const removers = [];
  const changeAdapter = {
    subscribe: vi.fn((listener) => {
      listeners.push(listener);
      const remove = vi.fn();
      removers.push(remove);
      return remove;
    }),
  };
  const runtime = createSettingsRuntime({ repository: { initializeSettings }, changeAdapter, onError });
  return {
    runtime,
    initializeSettings,
    onError,
    changeAdapter,
    removers,
    emit: (...args) => listeners.at(-1)(...args),
  };
}

function memoryHarness(initialValue) {
  const values = {};
  if (initialValue !== undefined) values[SETTINGS_STORAGE_KEY] = initialValue;
  const storage = {
    get: vi.fn(async () => ({ ...values })),
    set: vi.fn(async (updates) => Object.assign(values, updates)),
    remove: vi.fn(async (key) => { delete values[key]; }),
  };
  const base = harness(createSettingsRepository(storage).initializeSettings);
  return {
    ...base,
    storage,
    values,
    removeStoredSettings: () => { delete values[SETTINGS_STORAGE_KEY]; },
  };
}

const relevantChange = { [SETTINGS_STORAGE_KEY]: {} };
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('settings runtime', () => {
  it('starts once, shares concurrent starts, freezes and notifies its snapshot', async () => {
    const deferred = createDeferred();
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
    expect(h.removers[0]).toHaveBeenCalledOnce();
    await expect(h.runtime.start()).resolves.toEqual(createDefaultSettings());
  });

  it('rejects a non-callable unsubscribe result without initializing and remains restartable', async () => {
    const initialize = vi.fn().mockResolvedValue(createDefaultSettings());
    const changeAdapter = { subscribe: vi.fn().mockReturnValueOnce(null).mockReturnValue(vi.fn()) };
    const runtime = createSettingsRuntime({ repository: { initializeSettings: initialize }, changeAdapter, onError: vi.fn() });
    await expect(runtime.start()).rejects.toThrow(TypeError);
    expect(initialize).not.toHaveBeenCalled();
    await expect(runtime.start()).resolves.toEqual(createDefaultSettings());
  });

  it('ignores unrelated areas and keys and suppresses equivalent notifications', async () => {
    const canonical = createDefaultSettings();
    const h = harness(vi.fn().mockResolvedValue(canonical));
    const subscriber = vi.fn();
    h.runtime.subscribe(subscriber);
    await h.runtime.start();
    h.emit({ unrelated: {} }, 'local');
    h.emit(relevantChange, 'sync');
    await flush();
    expect(h.initializeSettings).toHaveBeenCalledOnce();
    h.emit(relevantChange, 'local');
    await flush();
    expect(h.initializeSettings).toHaveBeenCalledTimes(2);
    expect(subscriber).toHaveBeenCalledOnce();
  });

  it('uses the real repository to restore defaults after key removal', async () => {
    const h = memoryHarness({ schemaVersion: 1, allowlist: ['before-removal'] });
    await h.runtime.start();
    h.removeStoredSettings();
    h.emit(relevantChange, 'local');
    await flush();
    expect(h.runtime.getSettings()).toEqual(createDefaultSettings());
    expect(h.values[SETTINGS_STORAGE_KEY]).toEqual(createDefaultSettings());
  });

  it.each([
    ['version-0 settings', { country: { hide: ['us'] } }, (settings) => expect(settings.country.hide).toEqual(['US'])],
    ['partial version-1 settings', { schemaVersion: 1, allowlist: ['account'] }, (settings) => {
      expect(settings.allowlist).toEqual(['account']);
      expect(settings.region).toEqual({ hide: [], highlight: [] });
    }],
  ])('uses the real repository to canonicalize %s', async (_name, stored, verify) => {
    const h = memoryHarness(stored);
    const settings = await h.runtime.start();
    verify(settings);
    expect(h.values[SETTINGS_STORAGE_KEY]).toEqual(settings);
  });

  it('reports one generic refresh error, preserves state, and accepts a later valid update', async () => {
    const valid = createDefaultSettings();
    const later = { ...valid, allowlist: ['later'] };
    const h = harness(vi.fn().mockResolvedValueOnce(valid)
      .mockRejectedValueOnce(new TypeError('secret-token stored-value'))
      .mockResolvedValueOnce(later));
    await h.runtime.start();
    h.emit(relevantChange, 'local');
    await flush();
    expect(h.runtime.getSettings()).toEqual(valid);
    expect(h.onError).toHaveBeenCalledOnce();
    const reported = h.onError.mock.calls[0][0];
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe('Unable to refresh extension settings');
    expect(reported.message).not.toMatch(/secret-token|stored-value/);
    h.emit(relevantChange, 'local');
    await flush();
    expect(h.runtime.getSettings().allowlist).toEqual(['later']);
  });

  it('preserves state after a storage read failure', async () => {
    const h = memoryHarness({ schemaVersion: 1, allowlist: ['valid'] });
    const initial = await h.runtime.start();
    h.storage.get.mockRejectedValueOnce(new Error('read failed'));
    h.emit(relevantChange, 'local');
    await flush();
    expect(h.runtime.getSettings()).toBe(initial);
    expect(h.onError).toHaveBeenCalledOnce();
  });

  it('serializes rapid changes so an older result cannot overwrite a newer snapshot', async () => {
    const older = createDeferred();
    const newer = createDeferred();
    const initial = createDefaultSettings();
    const initialize = vi.fn().mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const h = harness(initialize);
    await h.runtime.start();
    h.emit(relevantChange, 'local');
    h.emit(relevantChange, 'local');
    await flush();
    expect(initialize).toHaveBeenCalledTimes(2);
    older.resolve({ ...initial, allowlist: ['older'] });
    await flush();
    expect(initialize).toHaveBeenCalledTimes(3);
    newer.resolve({ ...initial, allowlist: ['newer'] });
    await flush();
    expect(h.runtime.getSettings().allowlist).toEqual(['newer']);
  });

  it('contains a throwing error callback and processes a later refresh', async () => {
    const valid = createDefaultSettings();
    const initialize = vi.fn().mockResolvedValueOnce(valid)
      .mockRejectedValueOnce(new Error('bad read'))
      .mockResolvedValueOnce({ ...valid, allowlist: ['recovered'] });
    const h = harness(initialize, vi.fn(() => { throw new Error('reporter failed'); }));
    await h.runtime.start();
    h.emit(relevantChange, 'local');
    await flush();
    h.emit(relevantChange, 'local');
    await flush();
    expect(h.runtime.getSettings().allowlist).toEqual(['recovered']);
  });

  it('isolates subscribers, supports unsubscribe, stops reads, and restarts with one listener', async () => {
    const first = createDefaultSettings();
    const second = { ...first, allowlist: ['restart'] };
    const h = harness(vi.fn().mockResolvedValueOnce(first).mockResolvedValue(second));
    const throwing = vi.fn(() => { throw new Error('subscriber'); });
    const good = vi.fn();
    h.runtime.subscribe(throwing);
    const unsubscribe = h.runtime.subscribe(good);
    await h.runtime.start();
    expect(good).toHaveBeenCalledOnce();
    unsubscribe();
    unsubscribe();
    h.runtime.stop();
    h.runtime.stop();
    expect(h.removers[0]).toHaveBeenCalledOnce();
    h.emit(relevantChange, 'local');
    await flush();
    expect(h.initializeSettings).toHaveBeenCalledOnce();
    await h.runtime.start();
    expect(h.changeAdapter.subscribe).toHaveBeenCalledTimes(2);
    expect(h.initializeSettings).toHaveBeenCalledTimes(2);
    expect(h.runtime.getSettings().allowlist).toEqual(['restart']);
    expect(throwing).toHaveBeenCalledTimes(2);
  });
});
