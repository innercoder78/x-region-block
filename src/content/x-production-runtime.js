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

function createDiagnostic(globalScope) {
  const last = new Map();
  return (code, level = 'info') => {
    const now = Date.now();
    if (now - (last.get(code) ?? 0) < 30_000) return;
    last.set(code, now);
    try { globalScope.console?.[level]?.(`[X Region Reveal & Block] ${code}`); } catch { /* local only */ }
  };
}

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
  const diagnostic = createDiagnostic(globalScope);
  const report = () => diagnostic('Account processing encountered a lifecycle error.', 'warn');

  const owned = (state) => lifecycle === state && active && !state.claimed
    && generation === state.generation;
  const stopComponent = (state, key, stoppedKey = `${key}Stopped`) => {
    const value = state[key];
    state[key] = null;
    if (value === null || state[stoppedKey]) return;
    state[stoppedKey] = true;
    try { value.stop(); } catch { /* contained */ }
  };
  const removeMetadata = (state) => {
    const listener = state.metadataListener;
    state.metadataListener = null;
    const mayBeAdded = state.metadataMayBeAdded;
    state.metadataMayBeAdded = false;
    if (!mayBeAdded || listener === null) return;
    try { Reflect.apply(dependencies.documentRemove, dependencies.document,
      [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, listener]); } catch { /* contained */ }
  };
  const removePagehide = (state) => {
    const listener = state.pagehideListener;
    state.pagehideListener = null;
    const mayBeAdded = state.pagehideMayBeAdded;
    state.pagehideMayBeAdded = false;
    if (!mayBeAdded || listener === null) return;
    try { Reflect.apply(dependencies.globalRemove, globalScope,
      ['pagehide', listener]); } catch { /* contained */ }
  };
  const cleanup = (state) => {
    if (state.cleaned) return;
    state.cleaned = true;
    removeMetadata(state);
    stopComponent(state, 'routeCandidate');
    stopComponent(state, 'routeController', 'routeCandidateStopped');
    stopComponent(state, 'bridge');
    stopComponent(state, 'settingsCandidate');
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
    const reject = state.reject;
    state.resolve = null; state.reject = null;
    reject(new Error('Unable to start X production runtime'));
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
      const discovered = candidate.start();
      if (!owned(state)) { stopComponent(state, 'routeCandidate'); return; }
      state.routeController = candidate; state.routeCandidate = null;
      ready = true;
      diagnostic('Metadata accepted and account processing started.');
      if (Array.isArray(discovered) && discovered.length === 0) {
        diagnostic('Account discovery started but no supported targets were found.', 'warn');
      }
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
      settingsCandidate: null, settingsRuntime: null, transport: null,
      routeCandidate: null, routeController: null,
      bridgeStopped: false, injectorStopped: false, settingsCandidateStopped: false,
      settingsRuntimeStopped: false, routeCandidateStopped: false,
      metadataListener: null, metadataMayBeAdded: false,
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
    diagnostic('Waiting for X GraphQL authentication metadata.');
    const checkpoint = () => { if (!owned(state)) throw new Error('startup claimed'); };
    state.metadataListener = () => {
      if (!owned(state) || state.metadataCheckPending) return;
      state.metadataCheckPending = true;
      dependencies.Promise.resolve().then(() => {
        state.metadataCheckPending = false;
        if (owned(state)) {
          if (ready && state.bridge?.hasSnapshot()) state.routeController?.retryRecoverable();
          else startRoute(state);
        }
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
      const metadataListener = state.metadataListener;
      Reflect.apply(dependencies.documentAdd, dependencies.document,
        [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, metadataListener]);
      if (!owned(state)) {
        try { Reflect.apply(dependencies.documentRemove, dependencies.document,
          [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, metadataListener]); } catch { /* contained */ }
      }
      checkpoint();
      state.pagehideMayBeAdded = true;
      const pagehideListener = state.pagehideListener;
      Reflect.apply(dependencies.globalAdd, globalScope, ['pagehide', pagehideListener]);
      if (!owned(state)) {
        try { Reflect.apply(dependencies.globalRemove, globalScope,
          ['pagehide', pagehideListener]); } catch { /* contained */ }
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
        state.settingsCandidate = settings;
        if (!owned(state)) {
          stopComponent(state, 'settingsCandidate');
          throw new Error('startup claimed');
        }
        return settings;
      });
      checkpoint();
      dependencies.Promise.all([injectionPromise, guardedSettings]).then(([, settings]) => {
        if (!owned(state)) { stopComponent(state, 'settingsCandidate'); return; }
        if (settings === null) { fail(state); return; }
        if (state.settingsCandidate !== settings) { fail(state); return; }
        state.settingsRuntime = settings;
        state.settingsCandidate = null;
        state.settingsRuntimeStopped = state.settingsCandidateStopped;
        if (!owned(state)) { stopComponent(state, 'settingsRuntime'); return; }
        state.prerequisitesReady = true;
        startRoute(state);
        if (!owned(state)) return;
        if (pending === state) pending = null;
        if (!state.promiseSettled) {
          state.promiseSettled = true;
          const resolve = state.resolve;
          state.resolve = null; state.reject = null;
          resolve();
        }
      }, () => { if (owned(state)) fail(state); });
    } catch { if (owned(state)) fail(state); }
    return state.promise;
  };

  return Object.freeze({ start, stop, isActive: () => active, isReady: () => ready });
}
