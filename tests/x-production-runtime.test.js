import { beforeEach, describe, expect, it, vi } from 'vitest';
import { X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE } from '../src/shared/x-about-account-request-metadata-event.js';

const mocks = vi.hoisted(() => ({
  order: [], snapshot: false, settingsPromise: null, injectorPromise: null,
  bridge: null, injector: null, route: null, routeOptions: null, routeRoot: null,
  routeFactoryHook: null, routeStartHook: null,
}));

vi.mock('../src/content/x-about-account-request-metadata-bridge.js', () => ({
  createXAboutAccountRequestMetadataBridge: vi.fn((facade) => {
    mocks.order.push(['bridge-create', facade]);
    mocks.bridge = {
      start: vi.fn(() => mocks.order.push(['bridge-start'])), stop: vi.fn(),
      hasSnapshot: vi.fn(() => mocks.snapshot), createRequest: vi.fn(), isActive: vi.fn(),
    };
    return mocks.bridge;
  }),
}));
vi.mock('../src/content/x-page-script-injector.js', () => ({
  createXPageScriptInjector: vi.fn(() => {
    mocks.order.push(['injector-create']);
    mocks.injector = { start: vi.fn(() => {
      mocks.order.push(['injector-start']); return mocks.injectorPromise ?? Promise.resolve();
    }), stop: vi.fn(), isActive: vi.fn() };
    return mocks.injector;
  }),
}));
vi.mock('../src/content/initialize-content-settings.js', () => ({
  initializeContentSettings: vi.fn(() => {
    mocks.order.push(['settings-start']); return mocks.settingsPromise;
  }),
}));
vi.mock('../src/content/x-about-account-request-transport.js', () => ({
  createXAboutAccountRequestTransport: vi.fn((options) => ({
    options, loadPayload: vi.fn(),
  })),
}));
vi.mock('../src/content/account-target-route-session-controller.js', () => ({
  ACCOUNT_TARGET_ROUTE_SESSION_CONTROLLER_VERSION: 1,
  createXAccountTargetRouteSessionController: vi.fn((root, options) => {
    mocks.routeRoot = root; mocks.routeOptions = options;
    mocks.route = { start: vi.fn(() => mocks.routeStartHook?.()), stop: vi.fn() };
    mocks.routeFactoryHook?.();
    return mocks.route;
  }),
}));
vi.mock('../src/content/x-navigation-observer.js', () => ({
  createXNavigationObserver: vi.fn(() => ({
    start: vi.fn(() => 'https://x.com/home'), stop: vi.fn(),
    getCurrentUrl: vi.fn(), isActive: vi.fn(),
  })),
}));

import {
  X_PRODUCTION_CONTENT_RUNTIME_VERSION, createXProductionContentRuntime,
} from '../src/content/x-production-runtime.js';

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function scope() {
  const document = new EventTarget();
  document.querySelectorAll = vi.fn(() => []);
  document.dispatchEvent = EventTarget.prototype.dispatchEvent;
  class MutationObserver { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} }
  class AbortController { constructor() { this.signal = {}; } abort() {} }
  const globalEvents = new EventTarget();
  return {
    location: { origin: 'https://x.com', hostname: 'x.com', href: 'https://x.com/home' },
    document, Event, URLSearchParams, Promise, MutationObserver, AbortController,
    fetch: vi.fn(),
    addEventListener: globalEvents.addEventListener.bind(globalEvents),
    removeEventListener: globalEvents.removeEventListener.bind(globalEvents),
    dispatchEvent: globalEvents.dispatchEvent.bind(globalEvents),
    browser: {
      runtime: { getURL: vi.fn() },
      storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    },
  };
}
function settings() { return { stop: vi.fn(), getSettings: vi.fn(), subscribe: vi.fn() }; }

beforeEach(() => {
  mocks.order.length = 0; mocks.snapshot = false;
  mocks.settingsPromise = Promise.resolve(settings()); mocks.injectorPromise = Promise.resolve();
  mocks.bridge = null; mocks.injector = null; mocks.route = null;
  mocks.routeOptions = null; mocks.routeRoot = null;
  mocks.routeFactoryHook = null; mocks.routeStartHook = null;
});

describe('X production content runtime', () => {
  it('exports version 1 and an exact frozen inactive API', () => {
    const runtime = createXProductionContentRuntime(scope());
    expect(X_PRODUCTION_CONTENT_RUNTIME_VERSION).toBe(1);
    expect(Object.keys(runtime)).toEqual(['start', 'stop', 'isActive', 'isReady']);
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it('starts the bridge before concurrent injection and settings and waits for metadata', async () => {
    const runtime = createXProductionContentRuntime(scope());
    await runtime.start();
    expect(mocks.order.map(([name]) => name)).toEqual([
      'bridge-create', 'bridge-start', 'injector-create', 'injector-start', 'settings-start',
    ]);
    expect(runtime.isActive()).toBe(true);
    expect(runtime.isReady()).toBe(false);
    expect(mocks.route).toBeNull();
    runtime.stop();
  });

  it('returns the same pending promise and starts once after later valid metadata', async () => {
    const pendingSettings = deferred(); mocks.settingsPromise = pendingSettings.promise;
    const fake = scope(); const runtime = createXProductionContentRuntime(fake);
    const first = runtime.start();
    expect(runtime.start()).toBe(first);
    pendingSettings.resolve(settings()); await first;
    fake.document.dispatchEvent(new Event(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE));
    await Promise.resolve(); expect(runtime.isReady()).toBe(false);
    mocks.snapshot = true;
    fake.document.dispatchEvent(new Event(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE));
    await Promise.resolve();
    expect(runtime.isReady()).toBe(true);
    expect(mocks.route.start).toHaveBeenCalledOnce();
    expect(mocks.routeRoot).toBe(fake.document);
    expect(mocks.routeOptions.baseUrl).toBe('https://x.com');
    runtime.stop();
  });

  it('starts from synchronous replay after prerequisites and adapts factories', async () => {
    mocks.snapshot = true;
    const fake = scope(); const runtime = createXProductionContentRuntime(fake);
    await runtime.start();
    expect(runtime.isReady()).toBe(true);
    const mutationA = mocks.routeOptions.observerFactory(() => {});
    const mutationB = mocks.routeOptions.observerFactory(() => {});
    expect(mutationA).not.toBe(mutationB);
    expect(mocks.routeOptions.brokerAbortControllerFactory())
      .not.toBe(mocks.routeOptions.consumerAbortControllerFactory());
    expect(() => mocks.routeOptions.navigationObserverFactory({
      version: 2, onNavigate() {}, onError() {},
    })).toThrow('Invalid navigation observer version');
    runtime.stop();
  });

  it('stops a settings runtime that resolves after stop and supports a clean restart', async () => {
    const late = deferred(); mocks.settingsPromise = late.promise;
    const runtime = createXProductionContentRuntime(scope());
    const first = runtime.start(); runtime.stop();
    const lateRuntime = settings(); late.resolve(lateRuntime);
    await expect(first).rejects.toThrow('Unable to start X production runtime');
    await Promise.resolve(); expect(lateRuntime.stop).toHaveBeenCalledOnce();
    mocks.settingsPromise = Promise.resolve(settings());
    await runtime.start(); expect(runtime.isActive()).toBe(true); runtime.stop();
  });

  it('preserves persisted pagehide and stops on normal pagehide', async () => {
    const fake = scope(); const runtime = createXProductionContentRuntime(fake);
    await runtime.start();
    const persisted = new Event('pagehide'); Object.defineProperty(persisted, 'persisted', { value: true });
    fake.dispatchEvent(persisted); expect(runtime.isActive()).toBe(true);
    fake.dispatchEvent(new Event('pagehide')); expect(runtime.isActive()).toBe(false);
  });

  it('adopts and stops a controller returned after stop during construction', async () => {
    mocks.snapshot = true;
    const runtime = createXProductionContentRuntime(scope());
    mocks.routeFactoryHook = () => runtime.stop();
    await expect(runtime.start()).rejects.toThrow('Unable to start X production runtime');
    expect(mocks.route.stop).toHaveBeenCalledOnce();
    expect(runtime.isReady()).toBe(false);
  });

  it('stops a route candidate exactly once after reentrant stop from start', async () => {
    mocks.snapshot = true;
    const runtime = createXProductionContentRuntime(scope());
    mocks.routeStartHook = () => runtime.stop();
    await expect(runtime.start()).rejects.toThrow('Unable to start X production runtime');
    expect(mocks.route.stop).toHaveBeenCalledOnce();
    expect(runtime.isActive()).toBe(false);
  });
});
