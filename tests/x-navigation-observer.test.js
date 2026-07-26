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

  it('accepts null-prototype options and captures callbacks exactly once', () => {
    const global = facade();
    const navigate = vi.fn();
    const error = vi.fn();
    const reads = { navigate: 0, error: 0 };
    const options = Object.create(null);
    Object.defineProperties(options, {
      onNavigate: { enumerable: true, get() { reads.navigate += 1; return navigate; } },
      onError: { enumerable: true, get() { reads.error += 1; return error; } },
    });
    const observer = createXNavigationObserver(global, options);
    observer.start();
    global.listeners.get('popstate')();
    expect(reads).toEqual({ navigate: 1, error: 1 });
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('normalizes throwing callback accessors and ignores inherited callbacks', () => {
    const global = facade();
    const throwing = { onError() {} };
    Object.defineProperty(throwing, 'onNavigate', { get() { throw new Error('private'); } });
    expect(() => createXNavigationObserver(global, throwing)).toThrowError(
      new TypeError('Invalid X navigation observer options'),
    );
    Object.defineProperties(Object.prototype, {
      onNavigate: { configurable: true, value() {} },
      onError: { configurable: true, value() {} },
    });
    try {
      expect(() => createXNavigationObserver(global, {})).toThrowError(
        new TypeError('Invalid X navigation observer options'),
      );
    } finally {
      delete Object.prototype.onNavigate;
      delete Object.prototype.onError;
    }
  });

  it('requires a live string on repeated start and reports one stop failure', () => {
    const global = facade();
    const onError = vi.fn(() => { throw new Error('boundary'); });
    const observer = createXNavigationObserver(global, { onNavigate: vi.fn(), onError });
    observer.start();
    global.location.href = null;
    expect(() => observer.start()).toThrowError(
      new TypeError('Invalid X navigation observer global scope'),
    );
    global.document.removeEventListener = () => { throw new Error('document'); };
    global.removeEventListener = () => { throw new Error('global'); };
    expect(() => observer.stop()).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(new Error('Unable to stop X navigation observer'));
  });

  it('rolls back only successfully registered listeners', () => {
    const global = facade();
    const removeDocument = vi.spyOn(global.document, 'removeEventListener');
    const removeGlobal = vi.spyOn(global, 'removeEventListener');
    global.addEventListener = () => { throw new Error('registration'); };
    const observer = createXNavigationObserver(global, { onNavigate: vi.fn(), onError: vi.fn() });
    expect(() => observer.start()).toThrowError(new Error('registration'));
    expect(removeDocument).toHaveBeenCalledOnce();
    expect(removeGlobal).toHaveBeenCalledOnce();
    expect(observer.isActive()).toBe(false);
  });

  it('rolls back when document registration synchronously stops the lifecycle', () => {
    const global = facade();
    let invokeDuringRegistration = true;
    const addDocument = global.document.addEventListener;
    global.document.addEventListener = function (type, listener) {
      addDocument.call(this, type, listener);
      if (invokeDuringRegistration) listener();
    };
    let observer;
    observer = createXNavigationObserver(global, {
      onNavigate: () => observer.stop(), onError: vi.fn(),
    });
    expect(() => observer.start()).toThrowError(
      new Error('X navigation observer start was interrupted'),
    );
    expect(observer.isActive()).toBe(false);
    expect(global.document.listeners.size).toBe(0);
    expect(global.listeners.size).toBe(0);
    invokeDuringRegistration = false;
    expect(observer.start()).toBe(global.location.href);
    expect(observer.isActive()).toBe(true);
    observer.stop();
  });

  it('rolls back both listeners when popstate registration synchronously stops', () => {
    const global = facade();
    let invokeDuringRegistration = true;
    const addGlobal = global.addEventListener;
    global.addEventListener = function (type, listener) {
      addGlobal.call(this, type, listener);
      if (invokeDuringRegistration) listener();
    };
    let observer;
    observer = createXNavigationObserver(global, {
      onNavigate: () => observer.stop(), onError: vi.fn(),
    });
    expect(() => observer.start()).toThrowError(
      new Error('X navigation observer start was interrupted'),
    );
    expect(global.document.listeners.size).toBe(0);
    expect(global.listeners.size).toBe(0);
    invokeDuringRegistration = false;
    expect(observer.start()).toBe(global.location.href);
    observer.stop();
  });

  it('contains synchronous delivery and error-boundary failures during registration', () => {
    const global = facade();
    const addDocument = global.document.addEventListener;
    global.document.addEventListener = function (type, listener) {
      addDocument.call(this, type, listener);
      listener();
    };
    let observer;
    observer = createXNavigationObserver(global, {
      onNavigate: () => { throw new Error('delivery'); },
      onError: () => { observer.stop(); throw new Error('boundary'); },
    });
    expect(() => observer.start()).toThrowError(
      new Error('X navigation observer start was interrupted'),
    );
    expect(observer.isActive()).toBe(false);
    expect(global.document.listeners.size).toBe(0);
    expect(global.listeners.size).toBe(0);
  });
});
