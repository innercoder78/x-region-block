import { describe, expect, it, vi } from 'vitest';

import { initializeContentSettings } from '../src/content/initialize-content-settings.js';

function scope(hostname, style = 'browser') {
  const values = {};
  const listeners = new Set();
  const local = style === 'browser' ? {
    get: vi.fn(async () => values),
    set: vi.fn(async (updates) => Object.assign(values, updates)),
    remove: vi.fn(async (key) => { delete values[key]; }),
  } : {
    get: vi.fn((key, callback) => callback(values)),
    set: vi.fn((updates, callback) => { Object.assign(values, updates); callback(); }),
    remove: vi.fn((key, callback) => { delete values[key]; callback(); }),
  };
  return {
    location: hostname === undefined ? {} : { hostname },
    [style]: {
      storage: {
        local,
        onChanged: {
          addListener: vi.fn((listener) => listeners.add(listener)),
          removeListener: vi.fn((listener) => listeners.delete(listener)),
        },
      },
      ...(style === 'chrome' ? { runtime: {} } : {}),
    },
    console: { error: vi.fn() },
    fetch: vi.fn(),
    setTimeout: vi.fn(),
  };
}

describe('content settings initialization', () => {
  it.each([['x.com', 'browser'], ['twitter.com', 'chrome'], ['X.COM', 'browser']])(
    'initializes on %s with %s storage',
    async (hostname, style) => {
      const globalScope = scope(hostname, style);
      const runtime = await initializeContentSettings(globalScope);
      expect(runtime.getSettings()).not.toBeNull();
      expect(globalScope[style].storage.local.get).toHaveBeenCalled();
      expect(globalScope.fetch).not.toHaveBeenCalled();
      expect(globalScope.setTimeout).not.toHaveBeenCalled();
    },
  );

  it.each([['example.com'], [undefined], ['mobile.x.com']])('does nothing on hostname %s', async (hostname) => {
    const globalScope = scope(hostname);
    await expect(initializeContentSettings(globalScope)).resolves.toBeNull();
    expect(globalScope.browser.storage.local.get).not.toHaveBeenCalled();
    expect(globalScope.browser.storage.onChanged.addListener).not.toHaveBeenCalled();
  });

  it('rejects generically when a supported host has no storage API', async () => {
    await expect(initializeContentSettings({ location: { hostname: 'x.com' } }))
      .rejects.toThrow('No supported extension local storage API');
  });
});
