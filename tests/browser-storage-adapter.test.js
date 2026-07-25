import { describe, expect, it, vi } from 'vitest';
import { createBrowserStorageAdapter } from '../src/shared/browser-storage-adapter.js';

describe('browser storage adapter', () => {
  it('uses the Promise-based browser local API for every operation', async () => {
    const local = { get: vi.fn(async () => ({ key: 1 })), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
    const adapter = createBrowserStorageAdapter({ browser: { storage: { local } } });
    const values = { key: 2 };

    await expect(adapter.get('key')).resolves.toEqual({ key: 1 });
    await expect(adapter.set(values)).resolves.toBeUndefined();
    await expect(adapter.remove('key')).resolves.toBeUndefined();
    expect(local.get).toHaveBeenCalledWith('key');
    expect(local.set).toHaveBeenCalledWith(values);
    expect(local.remove).toHaveBeenCalledWith('key');
    expect(values).toEqual({ key: 2 });
  });

  it('wraps callback-based Chrome local storage', async () => {
    const local = {
      get: vi.fn((key, callback) => callback({ [key]: 1 })),
      set: vi.fn((values, callback) => callback()),
      remove: vi.fn((key, callback) => callback()),
    };
    const adapter = createBrowserStorageAdapter({ chrome: { storage: { local }, runtime: {} } });
    await expect(adapter.get('key')).resolves.toEqual({ key: 1 });
    await expect(adapter.set({ key: 2 })).resolves.toBeUndefined();
    await expect(adapter.remove('key')).resolves.toBeUndefined();
  });

  it('prefers browser when both APIs are present', async () => {
    const browserGet = vi.fn(async () => ({}));
    const chromeGet = vi.fn();
    const scope = {
      browser: { storage: { local: { get: browserGet, set: vi.fn(), remove: vi.fn() } } },
      chrome: { storage: { local: { get: chromeGet } }, runtime: {} },
    };
    await createBrowserStorageAdapter(scope).get('key');
    expect(browserGet).toHaveBeenCalledOnce();
    expect(chromeGet).not.toHaveBeenCalled();
  });

  it('propagates Promise rejection', async () => {
    const failure = new Error('unavailable');
    const local = { get: vi.fn(async () => { throw failure; }), set: vi.fn(), remove: vi.fn() };
    await expect(createBrowserStorageAdapter({ browser: { storage: { local } } }).get('key')).rejects.toBe(failure);
  });

  it('rejects Chrome runtime errors without exposing values', async () => {
    const scope = {
      chrome: {
        runtime: { lastError: { message: 'quota exceeded' } },
        storage: { local: { get: vi.fn((key, callback) => callback()), set: vi.fn(), remove: vi.fn() } },
      },
    };
    await expect(createBrowserStorageAdapter(scope).get('secret-key')).rejects.toThrow('Extension local storage operation failed');
  });

  it('throws when no supported API exists', () => {
    expect(() => createBrowserStorageAdapter({})).toThrow('No supported extension local storage API');
  });

  it('does not call storage while constructing the adapter', () => {
    const local = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
    createBrowserStorageAdapter({ browser: { storage: { local } } });
    expect(local.get).not.toHaveBeenCalled();
    expect(local.set).not.toHaveBeenCalled();
    expect(local.remove).not.toHaveBeenCalled();
  });
});
