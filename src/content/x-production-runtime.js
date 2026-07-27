import { X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE } from '../shared/x-about-account-request-metadata-event.js';
import { createXAccountTargetRouteSessionController,
  ACCOUNT_TARGET_ROUTE_SESSION_CONTROLLER_VERSION } from './account-target-route-session-controller.js';
import { initializeContentSettings } from './initialize-content-settings.js';
import { createXAboutAccountRequestMetadataBridge } from './x-about-account-request-metadata-bridge.js';
import { createXAboutAccountRequestTransport } from './x-about-account-request-transport.js';
import { createXNavigationObserver } from './x-navigation-observer.js';
import { createXPageScriptInjector } from './x-page-script-injector.js';

export const X_PRODUCTION_CONTENT_RUNTIME_VERSION = 1;
const supportedOrigins = new Set(['https://x.com', 'https://twitter.com']);

export function createXProductionContentRuntime(globalScope) {
  let dependencies;
  try {
    const origin = globalScope.location.origin;
    const document = globalScope.document;
    const { MutationObserver, AbortController, Event, URLSearchParams } = globalScope;
    const fetchMethod = globalScope.fetch;
    const add = globalScope.addEventListener;
    const remove = globalScope.removeEventListener;
    const documentAdd = document.addEventListener;
    const documentRemove = document.removeEventListener;
    const extensionNamespace = globalScope.browser ?? globalScope.chrome;
    const runtime = extensionNamespace?.runtime;
    const storage = extensionNamespace?.['storage'];
    if (!supportedOrigins.has(origin) || typeof document.querySelectorAll !== 'function'
      || typeof MutationObserver !== 'function' || typeof AbortController !== 'function'
      || typeof fetchMethod !== 'function' || typeof Event !== 'function'
      || typeof URLSearchParams !== 'function' || typeof add !== 'function'
      || typeof remove !== 'function' || typeof documentAdd !== 'function'
      || typeof documentRemove !== 'function' || typeof document.dispatchEvent !== 'function'
      || typeof runtime?.getURL !== 'function' || typeof storage?.local?.get !== 'function'
      || typeof storage?.local?.set !== 'function' || typeof storage?.onChanged?.addListener !== 'function'
      || typeof storage?.onChanged?.removeListener !== 'function') throw new Error();
    dependencies = { origin, document, MutationObserver, AbortController, Event,
      URLSearchParams, fetch: (...args) => Reflect.apply(fetchMethod, globalScope, args), add, remove };
  } catch { throw new TypeError('Invalid X production runtime global scope'); }

  let active = false;
  let ready = false;
  let generation = 0;
  let startPromise = null;
  let bridge = null;
  let injector = null;
  let settingsRuntime = null;
  let transport = null;
  let routeController = null;
  let metadataListener = null;
  let metadataCheckPending = false;
  let prerequisitesReady = false;
  let pagehideListener = null;

  const removeMetadataListener = () => {
    if (!metadataListener) return;
    try { dependencies.document.removeEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, metadataListener); } catch { /* best effort */ }
    metadataListener = null;
  };
  const cleanup = () => {
    removeMetadataListener();
    try { routeController?.stop(); } catch { /* contained */ }
    routeController = null; ready = false;
    try { bridge?.stop(); } catch { /* contained */ }
    bridge = null;
    try { settingsRuntime?.stop(); } catch { /* contained */ }
    settingsRuntime = null;
    try { injector?.stop(); } catch { /* contained */ }
    injector = null; transport = null; prerequisitesReady = false; metadataCheckPending = false;
    if (pagehideListener) {
      try { Reflect.apply(dependencies.remove, globalScope, ['pagehide', pagehideListener]); } catch { /* contained */ }
      pagehideListener = null;
    }
    startPromise = null;
  };
  const stop = () => {
    if (!active && startPromise === null && bridge === null && injector === null) return;
    active = false; generation += 1; cleanup();
  };
  const report = () => { /* Production details are intentionally discarded. */ };
  const startRoute = (lifecycle) => {
    if (!active || generation !== lifecycle || ready || !prerequisitesReady
      || !bridge?.hasSnapshot()) return;
    const currentBridge = bridge;
    transport = createXAboutAccountRequestTransport({
      fetch: dependencies.fetch,
      createRequest: currentBridge.createRequest,
    });
    routeController = createXAccountTargetRouteSessionController(dependencies.document, {
      settingsRuntime,
      observerFactory: (callback) => new dependencies.MutationObserver(callback),
      loadPayload: transport.loadPayload,
      brokerAbortControllerFactory: () => new dependencies.AbortController(),
      consumerAbortControllerFactory: () => new dependencies.AbortController(),
      navigationObserverFactory: (options) => {
        if (options.version !== ACCOUNT_TARGET_ROUTE_SESSION_CONTROLLER_VERSION) {
          throw new TypeError('Invalid navigation observer version');
        }
        return createXNavigationObserver(globalScope, {
          onNavigate: options.onNavigate, onError: options.onError,
        });
      },
      onError: report,
      baseUrl: dependencies.origin,
    });
    routeController.start();
    if (!active || generation !== lifecycle) { routeController.stop(); routeController = null; return; }
    ready = true; removeMetadataListener();
  };
  const start = () => {
    if (startPromise) return startPromise;
    if (active) return Promise.resolve();
    active = true; ready = false; prerequisitesReady = false;
    const lifecycle = ++generation;
    const facade = Object.assign(Object.create(null), {
      location: { origin: dependencies.origin }, document: dependencies.document,
      Event: dependencies.Event, URLSearchParams: dependencies.URLSearchParams,
    });
    try {
      bridge = createXAboutAccountRequestMetadataBridge(facade, { onError: report });
      bridge.start();
      metadataListener = () => {
        if (!active || generation !== lifecycle || metadataCheckPending) return;
        metadataCheckPending = true;
        Promise.resolve().then(() => {
          metadataCheckPending = false;
          if (!active || generation !== lifecycle) return;
          try { startRoute(lifecycle); } catch { stop(); report(); }
        });
      };
      dependencies.document.addEventListener(
        X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, metadataListener,
      );
      injector = createXPageScriptInjector(globalScope);
      pagehideListener = (event) => { if (event.persisted !== true) stop(); };
      Reflect.apply(dependencies.add, globalScope, ['pagehide', pagehideListener]);
      const injection = injector.start();
      const settings = initializeContentSettings(globalScope).then((runtime) => {
        if (!active || generation !== lifecycle) { runtime?.stop(); return null; }
        if (runtime === null) throw new Error();
        settingsRuntime = runtime;
        return runtime;
      });
      startPromise = Promise.all([injection, settings]).then(() => {
        if (!active || generation !== lifecycle) throw new Error();
        prerequisitesReady = true;
        startRoute(lifecycle);
      }).catch(() => {
        if (active && generation === lifecycle) { active = false; generation += 1; cleanup(); }
        throw new Error('Unable to start X production runtime');
      });
      return startPromise;
    } catch {
      active = false; generation += 1; cleanup();
      startPromise = Promise.reject(new Error('Unable to start X production runtime'));
      return startPromise;
    }
  };
  return Object.freeze({ start, stop, isActive: () => active, isReady: () => ready });
}
