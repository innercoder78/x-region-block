import { describe, expect, it, vi } from 'vitest';

import { createBrowserStorageChangeAdapter } from '../src/shared/storage-change-adapter.js';

function eventApi() {
  return { addListener: vi.fn(), removeListener: vi.fn() };
}

describe('browser storage change adapter', () => {
  it.each(['browser', 'chrome'])('supports the %s event API', (name) => {
    const event = eventApi();
    const scope = { [name]: { storage: { onChanged: event } } };
    const listener = vi.fn();
    const adapter = createBrowserStorageChangeAdapter(scope);
    expect(event.addListener).not.toHaveBeenCalled();

    const unsubscribe = adapter.subscribe(listener);
    const changes = { setting: { newValue: { private: true } } };
    event.addListener.mock.calls[0][0](changes, 'local');
    expect(listener).toHaveBeenCalledWith(changes, 'local');
    expect(changes).toEqual({ setting: { newValue: { private: true } } });

    unsubscribe();
    unsubscribe();
    expect(event.removeListener).toHaveBeenCalledTimes(1);
    expect(event.removeListener).toHaveBeenCalledWith(listener);
  });

  it('prefers browser when both APIs are available', () => {
    const browserEvent = eventApi();
    const chromeEvent = eventApi();
    createBrowserStorageChangeAdapter({
      browser: { storage: { onChanged: browserEvent } },
      chrome: { storage: { onChanged: chromeEvent } },
    }).subscribe(() => {});
    expect(browserEvent.addListener).toHaveBeenCalledOnce();
    expect(chromeEvent.addListener).not.toHaveBeenCalled();
  });

  it('rejects invalid listeners and missing APIs', () => {
    const adapter = createBrowserStorageChangeAdapter({ browser: { storage: { onChanged: eventApi() } } });
    expect(() => adapter.subscribe(null)).toThrow(TypeError);
    expect(() => createBrowserStorageChangeAdapter({})).toThrow(/No supported/);
  });
});
