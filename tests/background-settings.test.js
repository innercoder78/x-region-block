import { describe, expect, it, vi } from 'vitest';
import { initializeBackgroundSettings } from '../src/background/initialize-settings.js';
import { SETTINGS_STORAGE_KEY } from '../src/shared/settings-repository.js';

describe('background settings initialization', () => {
  it('initializes with Firefox-style local storage only when needed', async () => {
    const data = {};
    const local = {
      get: vi.fn(async (key) => key in data ? { [key]: data[key] } : {}),
      set: vi.fn(async (values) => Object.assign(data, structuredClone(values))),
      remove: vi.fn(async () => undefined),
    };
    const scope = { browser: { storage: { local } }, fetch: vi.fn(), account: { get: vi.fn() } };
    const first = await initializeBackgroundSettings(scope);
    expect(data[SETTINGS_STORAGE_KEY]).toEqual(first);
    expect(local.set).toHaveBeenCalledOnce();
    await initializeBackgroundSettings(scope);
    expect(local.set).toHaveBeenCalledOnce();
    expect(scope.fetch).not.toHaveBeenCalled();
    expect(scope.account.get).not.toHaveBeenCalled();
  });

  it('initializes with Chrome-style local storage', async () => {
    const data = {};
    const local = {
      get: vi.fn((key, callback) => callback(key in data ? { [key]: data[key] } : {})),
      set: vi.fn((values, callback) => { Object.assign(data, structuredClone(values)); callback(); }),
      remove: vi.fn((key, callback) => callback()),
    };
    await expect(initializeBackgroundSettings({ chrome: { runtime: {}, storage: { local } } }))
      .resolves.toMatchObject({ schemaVersion: 2 });
  });

  it('rejects when extension storage is unavailable', async () => {
    await expect(initializeBackgroundSettings({})).rejects.toThrow('No supported extension local storage API');
  });
});
