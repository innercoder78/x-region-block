import { expect, it, vi } from 'vitest';
import { installXNavigationSignal } from '../src/page/x-navigation-signal.js';
import { createXNavigationObserver } from '../src/content/x-navigation-observer.js';

it('connects an explicitly installed page signal to explicit content observation', () => {
  const listeners = new Map();
  const document = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    dispatchEvent: (event) => listeners.get(event.type)?.(event),
  };
  const global = {
    location: { href: 'https://x.com/home' }, document,
    history: {
      pushState(state, title, url) { global.location.href = new URL(url, global.location.href).href; },
      replaceState(state, title, url) { global.location.href = new URL(url, global.location.href).href; },
    },
    Event: class Event { constructor(type) { this.type = type; } },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  const onNavigate = vi.fn();
  const observer = createXNavigationObserver(global, { onNavigate, onError: vi.fn() });
  const signal = installXNavigationSignal(global);
  observer.start();
  global.history.pushState({}, '', '/alice/with_replies');
  expect(onNavigate).toHaveBeenCalledWith('https://x.com/alice/with_replies');
  observer.stop();
  signal.stop();
});
