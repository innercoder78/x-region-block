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

function usableExtensionApi(namespace) {
  try {
    const { runtime, storage } = namespace ?? {};
    return typeof runtime?.getURL === 'function' && typeof storage?.local?.get === 'function'
      && typeof storage.local.set === 'function' && typeof storage.local.remove === 'function'
      && typeof storage?.onChanged?.addListener === 'function'
      && typeof storage.onChanged.removeListener === 'function' ? namespace : null;
  } catch { return null; }
}

export function createXProductionContentRuntime(globalScope) {
  let dependencies;
  try {
    const origin = globalScope.location.origin;
    const document = globalScope.document;
    const { MutationObserver, AbortController, Event, URLSearchParams,
      Promise: PromiseConstructor } = globalScope;
    const fetchMethod = globalScope.fetch;
    const globalAdd = globalScope.addEventListener;
    const globalRemove = globalScope.removeEventListener;
    const documentAdd = document.addEventListener;
    const documentRemove = document.removeEventListener;
    const documentDispatch = document.dispatchEvent;
    const extensionApi = usableExtensionApi(globalScope.browser)
      ?? usableExtensionApi(globalScope.chrome);
    if (!supportedOrigins.has(origin) || typeof document.querySelectorAll !== 'function'
      || typeof MutationObserver !== 'function' || typeof AbortController !== 'function'
      || typeof fetchMethod !== 'function' || typeof Event !== 'function'
      || typeof URLSearchParams !== 'function' || typeof PromiseConstructor !== 'function'
      || typeof globalAdd !== 'function' || typeof globalRemove !== 'function'
      || typeof documentAdd !== 'function' || typeof documentRemove !== 'function'
      || typeof documentDispatch !== 'function' || extensionApi === null) throw new Error();
    dependencies = { origin, document, MutationObserver, AbortController, Event,
      URLSearchParams, Promise: PromiseConstructor,
      fetch: (...args) => Reflect.apply(fetchMethod, globalScope, args),
      globalAdd, globalRemove, documentAdd, documentRemove };
  } catch { throw new TypeError('Invalid X production runtime global scope'); }

  let active = false;
  let ready = false;
  let generation = 0;
  let pending = null;
  let lifecycle = null;
  const report = () => { /* Raw production errors are deliberately discarded. */ };

  const owned = (state) => lifecycle === state && active && !state.claimed
    && generation === state.generation;
  const stopComponent = (state, key) => {
    const value = state[key];
    if (value === null || state.stopped.has(value)) return;
    state.stopped.add(value);
    try { value.stop(); } catch { /* contained */ }
  };
  const removeMetadata = (state) => {
    if (!state.metadataMayBeAdded) return;
    state.metadataMayBeAdded = false;
    try { Reflect.apply(dependencies.documentRemove, dependencies.document,
      [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, state.metadataListener]); } catch { /* contained */ }
  };
  const removePagehide = (state) => {
    if (!state.pagehideMayBeAdded) return;
    state.pagehideMayBeAdded = false;
    try { Reflect.apply(dependencies.globalRemove, globalScope,
      ['pagehide', state.pagehideListener]); } catch { /* contained */ }
  };
  const cleanup = (state) => {
    if (state.cleaned) return;
    state.cleaned = true;
    removeMetadata(state);
    stopComponent(state, 'routeCandidate');
    state.routeController = null;
    stopComponent(state, 'bridge');
    stopComponent(state, 'settingsRuntime');
    stopComponent(state, 'injector');
    removePagehide(state);
    state.transport = null;
    state.metadataCheckPending = false;
    state.prerequisitesReady = false;
  };
  const rejectStartup = (state) => {
    if (state.promiseSettled) return;
    state.promiseSettled = true;
    state.reject(new Error('Unable to start X production runtime'));
  };
  const fail = (state) => {
    state.claimed = true;
    if (lifecycle === state) {
      active = false; ready = false; lifecycle = null; generation += 1;
    }
    if (pending === state) pending = null;
    cleanup(state);
    rejectStartup(state);
    report();
  };

  const startRoute = (state) => {
    if (!owned(state) || ready || state.routeStarting || !state.prerequisitesReady
      || !state.bridge?.hasSnapshot()) return;
    state.routeStarting = true;
    let candidate = null;
    try {
      const bridge = state.bridge;
      const transport = createXAboutAccountRequestTransport({
        fetch: dependencies.fetch, createRequest: bridge.createRequest,
      });
      if (!owned(state)) throw new Error();
      state.transport = transport;
      candidate = createXAccountTargetRouteSessionController(dependencies.document, {
        settingsRuntime: state.settingsRuntime,
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
      state.routeCandidate = candidate;
      if (!owned(state)) { stopComponent(state, 'routeCandidate'); return; }
      candidate.start();
      if (!owned(state)) { stopComponent(state, 'routeCandidate'); return; }
      state.routeController = candidate;
      ready = true;
      removeMetadata(state);
    } catch {
      if (candidate !== null && state.routeCandidate === null) state.routeCandidate = candidate;
      stopComponent(state, 'routeCandidate');
      if (owned(state)) fail(state);
    } finally { state.routeStarting = false; }
  };

  const stop = () => {
    const state = lifecycle;
    if (state === null) return;
    state.claimed = true;
    active = false; ready = false; generation += 1;
    lifecycle = null;
    if (pending === state) pending = null;
    cleanup(state);
    rejectStartup(state);
  };

  const start = () => {
    if (pending !== null) return pending.promise;
    if (active) return dependencies.Promise.resolve();
    const state = {
      generation: generation + 1, claimed: false, cleaned: false, promiseSettled: false,
      resolve: null, reject: null, promise: null, bridge: null, injector: null,
      settingsRuntime: null, transport: null, routeCandidate: null, routeController: null,
      stopped: new Set(), metadataListener: null, metadataMayBeAdded: false,
      metadataCheckPending: false, pagehideListener: null, pagehideMayBeAdded: false,
      prerequisitesReady: false, routeStarting: false,
    };
    state.promise = new dependencies.Promise((resolve, reject) => {
      state.resolve = resolve; state.reject = reject;
    });
    generation = state.generation;
    lifecycle = state;
    pending = state;
    active = true; ready = false;
    const checkpoint = () => { if (!owned(state)) throw new Error('startup claimed'); };
    state.metadataListener = () => {
      if (!owned(state) || state.metadataCheckPending) return;
      state.metadataCheckPending = true;
      dependencies.Promise.resolve().then(() => {
        state.metadataCheckPending = false;
        if (owned(state)) startRoute(state);
      });
    };
    state.pagehideListener = (event) => { if (event.persisted !== true && owned(state)) stop(); };
    try {
      const facade = Object.assign(Object.create(null), {
        location: { origin: dependencies.origin }, document: dependencies.document,
        Event: dependencies.Event, URLSearchParams: dependencies.URLSearchParams,
      });
      const bridge = createXAboutAccountRequestMetadataBridge(facade, { onError: report });
      state.bridge = bridge;
      if (!owned(state)) stopComponent(state, 'bridge');
      checkpoint();
      bridge.start();
      checkpoint();
      state.metadataMayBeAdded = true;
      Reflect.apply(dependencies.documentAdd, dependencies.document,
        [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, state.metadataListener]);
      if (!owned(state)) {
        try { Reflect.apply(dependencies.documentRemove, dependencies.document,
          [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, state.metadataListener]); } catch { /* contained */ }
      }
      checkpoint();
      state.pagehideMayBeAdded = true;
      Reflect.apply(dependencies.globalAdd, globalScope, ['pagehide', state.pagehideListener]);
      if (!owned(state)) {
        try { Reflect.apply(dependencies.globalRemove, globalScope,
          ['pagehide', state.pagehideListener]); } catch { /* contained */ }
      }
      checkpoint();
      const injector = createXPageScriptInjector(globalScope);
      state.injector = injector;
      if (!owned(state)) stopComponent(state, 'injector');
      checkpoint();
      const injectionPromise = injector.start();
      checkpoint();
      const settingsPromise = initializeContentSettings(globalScope);
      const guardedSettings = dependencies.Promise.resolve(settingsPromise).then((settings) => {
        if (!owned(state)) {
          try { settings?.stop(); } catch { /* contained */ }
          throw new Error('startup claimed');
        }
        return settings;
      });
      checkpoint();
      dependencies.Promise.all([injectionPromise, guardedSettings]).then(([, settings]) => {
        if (!owned(state)) { try { settings?.stop(); } catch { /* contained */ } return; }
        if (settings === null) { fail(state); return; }
        state.settingsRuntime = settings;
        if (!owned(state)) { stopComponent(state, 'settingsRuntime'); return; }
        state.prerequisitesReady = true;
        startRoute(state);
        if (!owned(state)) return;
        if (pending === state) pending = null;
        if (!state.promiseSettled) { state.promiseSettled = true; state.resolve(); }
      }, () => { if (owned(state)) fail(state); });
    } catch { if (owned(state)) fail(state); }
    return state.promise;
  };

  return Object.freeze({ start, stop, isActive: () => active, isReady: () => ready });
}
