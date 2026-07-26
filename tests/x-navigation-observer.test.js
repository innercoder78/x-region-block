import { describe, expect, it, vi } from 'vitest';
import {
  X_NAVIGATION_OBSERVER_VERSION, createXNavigationObserver,
} from '../src/content/x-navigation-observer.js';
import { X_NAVIGATION_EVENT_TYPE } from '../src/shared/x-navigation-event.js';

function target() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
}
function facade() {
  return Object.assign(target(), { location: { href: 'https://x.com/home' }, document: target() });
}

describe('X navigation observer', () => {
  it('is lazy, returns the initial URL, and exposes its exact frozen API', () => {
    const global = facade();
    const observer = createXNavigationObserver(global, { onNavigate: vi.fn(), onError: vi.fn() });
    expect(X_NAVIGATION_OBSERVER_VERSION).toBe(1);
    expect(Object.keys(observer)).toEqual(['start', 'stop', 'getCurrentUrl', 'isActive']);
    expect(Object.isFrozen(observer)).toBe(true);
    expect(global.listeners.size).toBe(0);
    expect(observer.start()).toBe('https://x.com/home');
    expect(observer.start()).toBe('https://x.com/home');
    expect(global.listeners.size).toBe(1);
  });

  it('delivers live custom-event and popstate URLs without deduplication', () => {
    const global = facade();
    const onNavigate = vi.fn();
    const observer = createXNavigationObserver(global, { onNavigate, onError: vi.fn() });
    observer.start();
    global.location.href = 'https://x.com/search?q=one';
    global.document.listeners.get(X_NAVIGATION_EVENT_TYPE)();
    global.listeners.get('popstate')();
    expect(onNavigate).toHaveBeenNthCalledWith(1, global.location.href);
    expect(onNavigate).toHaveBeenNthCalledWith(2, global.location.href);
  });

  it('converts delivery errors and rejects invalid options', () => {
    const global = facade();
    const onError = vi.fn();
    const observer = createXNavigationObserver(global, {
      onNavigate: () => { throw new Error('private'); }, onError,
    });
    observer.start();
    global.listeners.get('popstate')();
    expect(onError).toHaveBeenCalledWith(new Error('Unable to deliver X navigation'));
    expect(() => createXNavigationObserver(global, { onNavigate() {}, onError() {}, extra: true }))
      .toThrowError(new TypeError('Invalid X navigation observer options'));
  });

  it('invalidates stale callbacks and supports restart', () => {
    const global = facade();
    const onNavigate = vi.fn();
    const observer = createXNavigationObserver(global, { onNavigate, onError: vi.fn() });
    observer.start();
    const stale = global.listeners.get('popstate');
    observer.stop();
    stale();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(() => observer.getCurrentUrl()).toThrowError(
      new TypeError('X navigation observer is not active'),
    );
    observer.start();
    expect(observer.isActive()).toBe(true);
  });
});
