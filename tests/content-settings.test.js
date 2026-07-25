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
  const globalScope = {
    location: hostname === undefined ? {} : { hostname },
    [style]: {
      storage: {
        local,
        onChanged: {
          addListener: vi.fn((listener) => listeners.add(listener)),
          removeListener: vi.fn((listener) => listeners.delete(listener)),
        },
      },
      ...(style === 'chrome' ? { runtime: { sendMessage: vi.fn() } } : {}),
    },
    console: { error: vi.fn() },
    fetch: vi.fn(),
    setTimeout: vi.fn(),
    document: { querySelector: vi.fn(), querySelectorAll: vi.fn() },
    MutationObserver: vi.fn(),
    accountApi: vi.fn(),
  };
  if (style === 'browser') globalScope.browser.runtime = { sendMessage: vi.fn() };
  return {
    globalScope,
    emit: (...args) => [...listeners].forEach((listener) => listener(...args)),
  };
}

function expectNoPageActivity(globalScope) {
  expect(globalScope.fetch).not.toHaveBeenCalled();
  expect(globalScope.setTimeout).not.toHaveBeenCalled();
  expect(globalScope.document.querySelector).not.toHaveBeenCalled();
  expect(globalScope.document.querySelectorAll).not.toHaveBeenCalled();
  expect(globalScope.MutationObserver).not.toHaveBeenCalled();
  expect(globalScope.accountApi).not.toHaveBeenCalled();
  expect(globalScope.browser?.runtime?.sendMessage ?? globalScope.chrome?.runtime?.sendMessage)
    .not.toHaveBeenCalled();
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('content settings initialization', () => {
  it.each([['x.com', 'browser'], ['twitter.com', 'chrome'], ['X.COM', 'browser']])(
    'initializes on %s with %s storage',
    async (hostname, style) => {
      const { globalScope } = scope(hostname, style);
      const runtime = await initializeContentSettings(globalScope);
      expect(runtime.getSettings()).not.toBeNull();
      expect(globalScope[style].storage.local.get).toHaveBeenCalled();
      expectNoPageActivity(globalScope);
    },
  );

  it.each([['example.com'], [undefined], ['mobile.x.com']])('does nothing on hostname %s', async (hostname) => {
    const { globalScope } = scope(hostname);
    await expect(initializeContentSettings(globalScope)).resolves.toBeNull();
    expect(globalScope.browser.storage.local.get).not.toHaveBeenCalled();
    expect(globalScope.browser.storage.onChanged.addListener).not.toHaveBeenCalled();
    expectNoPageActivity(globalScope);
  });

  it('rejects generically when a supported host has no storage API', async () => {
    await expect(initializeContentSettings({ location: { hostname: 'x.com' } }))
      .rejects.toThrow('No supported extension local storage API');
  });

  it('does not expose secret-bearing initialization failures', async () => {
    const { globalScope } = scope('x.com');
    globalScope.browser.storage.local.get.mockRejectedValue(new Error('secret-token stored-value'));
    await expect(initializeContentSettings(globalScope)).rejects.toThrow('Unable to initialize extension settings');
    await expect(initializeContentSettings(globalScope)).rejects.not.toThrow(/secret-token|stored-value/);
    expectNoPageActivity(globalScope);
  });

  it('logs only a generic message for secret-bearing refresh failures', async () => {
    const { globalScope, emit } = scope('x.com');
    await initializeContentSettings(globalScope);
    globalScope.browser.storage.local.get.mockRejectedValueOnce(new Error('secret-account stored-value'));
    emit({ 'xRegionBlock.settings': { newValue: 'secret-account' } }, 'local');
    await flush();
    expect(globalScope.console.error).toHaveBeenCalledOnce();
    expect(globalScope.console.error).toHaveBeenCalledWith('Unable to refresh extension settings');
    expect(JSON.stringify(globalScope.console.error.mock.calls)).not.toMatch(/secret-account|stored-value/);
    expectNoPageActivity(globalScope);
  });
});
