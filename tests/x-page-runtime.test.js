import { describe, expect, it, vi } from 'vitest';
import {
  X_PAGE_RUNTIME_ERROR_EVENT_TYPE, X_PAGE_RUNTIME_READY_EVENT_TYPE,
  X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, X_PAGE_RUNTIME_STOP_EVENT_TYPE,
} from '../src/shared/x-page-runtime-event.js';
import { X_PAGE_RUNTIME_VERSION, installXPageRuntime } from '../src/page/x-page-runtime.js';

function page() {
  const document = new EventTarget();
  const history = {
    pushState() {},
    replaceState() {},
  };
  return {
    document, history, Event, CustomEvent,
    URL, URLSearchParams, Headers, Request,
    location: { origin: 'https://x.com' },
    fetch: vi.fn(() => Promise.resolve()),
  };
}

describe('X page runtime', () => {
  it('exports version 1 and an exact frozen owned controller', () => {
    const scope = page();
    const originalPush = scope.history.pushState;
    const originalFetch = scope.fetch;
    const controller = installXPageRuntime(scope);
    expect(X_PAGE_RUNTIME_VERSION).toBe(1);
    expect(Object.keys(controller)).toEqual(['stop', 'isActive']);
    expect(Object.isFrozen(controller)).toBe(true);
    expect(scope.history.pushState).not.toBe(originalPush);
    expect(scope.fetch).not.toBe(originalFetch);
    controller.stop();
  });

  it('signals readiness, answers probes, avoids nested wrappers, and stops by event', () => {
    const scope = page();
    const ready = vi.fn();
    scope.document.addEventListener(X_PAGE_RUNTIME_READY_EVENT_TYPE, ready);
    const controller = installXPageRuntime(scope);
    const wrappedPush = scope.history.pushState;
    const wrappedFetch = scope.fetch;
    expect(ready).toHaveBeenCalledTimes(1);
    scope.document.dispatchEvent(new Event(X_PAGE_RUNTIME_REQUEST_EVENT_TYPE));
    expect(ready).toHaveBeenCalledTimes(2);
    expect(installXPageRuntime(scope)).toBeNull();
    expect(scope.history.pushState).toBe(wrappedPush);
    expect(scope.fetch).toBe(wrappedFetch);
    scope.document.dispatchEvent(new Event(X_PAGE_RUNTIME_STOP_EVENT_TYPE));
    expect(controller.isActive()).toBe(false);
    scope.document.dispatchEvent(new Event(X_PAGE_RUNTIME_REQUEST_EVENT_TYPE));
    expect(ready).toHaveBeenCalledTimes(3); // second installation's probe supplied this response
    controller.stop();
  });

  it('emits only no-detail protocol events', () => {
    const scope = page();
    let observed;
    scope.document.addEventListener(X_PAGE_RUNTIME_READY_EVENT_TYPE, (event) => { observed = event; });
    const controller = installXPageRuntime(scope);
    expect(observed).toMatchObject({ bubbles: false, cancelable: false, composed: false });
    expect('detail' in observed).toBe(false);
    controller.stop();
  });

  it('rolls back and emits a generic error when listener installation fails', () => {
    const scope = page();
    const originalAdd = scope.document.addEventListener.bind(scope.document);
    const errors = [];
    originalAdd(X_PAGE_RUNTIME_ERROR_EVENT_TYPE, (event) => errors.push(event));
    let registrations = 0;
    scope.document.addEventListener = (...args) => {
      registrations += 1;
      if (registrations === 3) throw new Error('private material');
      return originalAdd(...args);
    };
    expect(() => installXPageRuntime(scope)).toThrow('Unable to install X page runtime');
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe(X_PAGE_RUNTIME_ERROR_EVENT_TYPE);
    expect(errors[0].bubbles).toBe(false);
  });
});
