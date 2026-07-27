import {
  X_PAGE_RUNTIME_ERROR_EVENT_TYPE, X_PAGE_RUNTIME_READY_EVENT_TYPE,
  X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, X_PAGE_RUNTIME_STOP_EVENT_TYPE,
} from '../shared/x-page-runtime-event.js';

export const X_PAGE_SCRIPT_INJECTOR_VERSION = 1;
const supportedOrigins = new Set(['https://x.com', 'https://twitter.com']);

function usableRuntime(namespace) {
  try { return typeof namespace?.runtime?.getURL === 'function' ? namespace.runtime : null; }
  catch { return null; }
}

export function createXPageScriptInjector(globalScope) {
  let dependencies;
  try {
    const { document, Event, Promise: PromiseConstructor, MutationObserver } = globalScope;
    const origin = globalScope.location.origin;
    const add = document.addEventListener;
    const remove = document.removeEventListener;
    const dispatch = document.dispatchEvent;
    const createElement = document.createElement;
    const runtime = usableRuntime(globalScope.browser) ?? usableRuntime(globalScope.chrome);
    const getURL = runtime?.getURL;
    if (!supportedOrigins.has(origin) || document === null || typeof document !== 'object'
      || typeof Event !== 'function' || typeof PromiseConstructor !== 'function'
      || typeof MutationObserver !== 'function' || typeof add !== 'function'
      || typeof remove !== 'function' || typeof dispatch !== 'function'
      || typeof createElement !== 'function' || typeof getURL !== 'function') throw new Error();
    dependencies = { document, Event, Promise: PromiseConstructor, MutationObserver,
      add, remove, dispatch, createElement, runtime, getURL };
  } catch { throw new TypeError('Invalid X page script injector global scope'); }

  let active = false;
  let generation = 0;
  let pending = null;
  const createEvent = (type) => new dependencies.Event(type, {
    bubbles: false, cancelable: false, composed: false,
  });
  const owned = (state) => pending === state && generation === state.lifecycle && !state.claimed;
  const removeScript = (script) => {
    try { script.remove(); }
    catch { try { script.parentNode?.removeChild(script); } catch { /* best effort */ } }
  };
  const cleanup = (state) => {
    if (state.readyMayBeAdded) {
      state.readyMayBeAdded = false;
      try { Reflect.apply(dependencies.remove, dependencies.document,
        [X_PAGE_RUNTIME_READY_EVENT_TYPE, state.ready]); } catch { /* best effort */ }
    }
    if (state.errorMayBeAdded) {
      state.errorMayBeAdded = false;
      try { Reflect.apply(dependencies.remove, dependencies.document,
        [X_PAGE_RUNTIME_ERROR_EVENT_TYPE, state.error]); } catch { /* best effort */ }
    }
    const observer = state.observer;
    state.observer = null;
    try { observer?.disconnect(); } catch { /* best effort */ }
    const script = state.script;
    state.script = null;
    if (script) {
      try { script.onload = null; } catch { /* best effort */ }
      try { script.onerror = null; } catch { /* best effort */ }
      removeScript(script);
    }
  };
  const settle = (state, success) => {
    if (state.settled) return;
    state.settled = true;
    cleanup(state);
    if (pending === state) pending = null;
    if (success && !state.claimed && generation === state.lifecycle) {
      active = true;
      state.resolve();
    } else {
      active = false;
      state.reject(new Error('Unable to inject X page runtime'));
    }
  };

  const start = () => {
    if (pending !== null) return pending.promise;
    if (active) return dependencies.Promise.resolve();
    const state = {
      lifecycle: generation + 1, claimed: false, settled: false, probeDispatched: false,
      readyMayBeAdded: false, errorMayBeAdded: false, observer: null, script: null,
      resolve: null, reject: null, ready: null, error: null, promise: null,
    };
    state.promise = new dependencies.Promise((resolve, reject) => {
      state.resolve = resolve; state.reject = reject;
    });
    generation = state.lifecycle;
    pending = state;
    state.ready = () => { if (owned(state)) settle(state, true); };
    state.error = () => { if (owned(state)) settle(state, false); };
    const checkpoint = () => {
      if (!owned(state)) throw new Error('startup claimed');
    };
    const insert = () => {
      checkpoint();
      const root = dependencies.document.documentElement;
      checkpoint();
      if (root === null || root === undefined) return false;
      if (typeof root.appendChild !== 'function') throw new Error('invalid insertion root');
      const observer = state.observer;
      state.observer = null;
      try { observer?.disconnect(); } catch { /* insertion can continue */ }
      checkpoint();
      Reflect.apply(root.appendChild, root, [state.script]);
      if (!owned(state)) { removeScript(state.script); checkpoint(); }
      return true;
    };
    try {
      state.readyMayBeAdded = true;
      Reflect.apply(dependencies.add, dependencies.document,
        [X_PAGE_RUNTIME_READY_EVENT_TYPE, state.ready]);
      if (!owned(state)) {
        try { Reflect.apply(dependencies.remove, dependencies.document,
          [X_PAGE_RUNTIME_READY_EVENT_TYPE, state.ready]); } catch { /* best effort */ }
      }
      checkpoint();
      state.errorMayBeAdded = true;
      Reflect.apply(dependencies.add, dependencies.document,
        [X_PAGE_RUNTIME_ERROR_EVENT_TYPE, state.error]);
      if (!owned(state)) {
        try { Reflect.apply(dependencies.remove, dependencies.document,
          [X_PAGE_RUNTIME_ERROR_EVENT_TYPE, state.error]); } catch { /* best effort */ }
      }
      checkpoint();
      state.probeDispatched = true;
      Reflect.apply(dependencies.dispatch, dependencies.document,
        [createEvent(X_PAGE_RUNTIME_REQUEST_EVENT_TYPE)]);
      checkpoint();
      const url = Reflect.apply(dependencies.getURL, dependencies.runtime, ['page/page-script.js']);
      checkpoint();
      if (typeof url !== 'string' || !/^(?:chrome|moz)-extension:/.test(url)) throw new Error();
      const script = Reflect.apply(dependencies.createElement, dependencies.document, ['script']);
      checkpoint();
      if (script === null || (typeof script !== 'object' && typeof script !== 'function')) throw new Error();
      state.script = script;
      script.src = url;
      checkpoint();
      script.async = false;
      checkpoint();
      script.onerror = () => { if (owned(state)) settle(state, false); };
      checkpoint();
      script.onload = () => {
        if (!owned(state)) return;
        dependencies.Promise.resolve().then(() => {
          if (owned(state)) settle(state, false);
        });
      };
      checkpoint();
      if (!insert()) {
        const observer = new dependencies.MutationObserver(() => {
          if (!owned(state)) return;
          try { insert(); } catch { if (owned(state)) settle(state, false); }
        });
        if (!owned(state)) { try { observer.disconnect(); } catch { /* best effort */ } }
        checkpoint();
        state.observer = observer;
        observer.observe(dependencies.document, { childList: true });
        checkpoint();
        insert();
      }
    } catch { if (!state.settled) settle(state, false); }
    return state.promise;
  };

  const stop = () => {
    const state = pending;
    const shouldSignal = active || state?.probeDispatched === true;
    active = false;
    generation += 1;
    if (state !== null) {
      state.claimed = true;
      settle(state, false);
    }
    if (shouldSignal) {
      try { Reflect.apply(dependencies.dispatch, dependencies.document,
        [createEvent(X_PAGE_RUNTIME_STOP_EVENT_TYPE)]); } catch { /* best effort */ }
    }
  };
  return Object.freeze({ start, stop, isActive: () => active });
}
