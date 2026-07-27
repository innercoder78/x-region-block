import {
  X_PAGE_RUNTIME_ERROR_EVENT_TYPE, X_PAGE_RUNTIME_READY_EVENT_TYPE,
  X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, X_PAGE_RUNTIME_STOP_EVENT_TYPE,
} from '../shared/x-page-runtime-event.js';

export const X_PAGE_SCRIPT_INJECTOR_VERSION = 1;
const supportedOrigins = new Set(['https://x.com', 'https://twitter.com']);

export function createXPageScriptInjector(globalScope) {
  let dependencies;
  try {
    const { document, Event, Promise: PromiseConstructor } = globalScope;
    const origin = globalScope.location.origin;
    const root = document.documentElement;
    const add = document.addEventListener;
    const remove = document.removeEventListener;
    const dispatch = document.dispatchEvent;
    const createElement = document.createElement;
    const runtime = globalScope.browser?.runtime ?? globalScope.chrome?.runtime;
    const getURL = runtime.getURL;
    if (!supportedOrigins.has(origin) || !root || typeof Event !== 'function'
      || typeof PromiseConstructor !== 'function' || typeof add !== 'function'
      || typeof remove !== 'function' || typeof dispatch !== 'function'
      || typeof createElement !== 'function' || typeof root.appendChild !== 'function'
      || typeof getURL !== 'function') throw new Error();
    dependencies = { document, root, Event, Promise: PromiseConstructor, add, remove, dispatch,
      createElement, runtime, getURL };
  } catch { throw new TypeError('Invalid X page script injector global scope'); }
  let active = false;
  let generation = 0;
  let pending = null;
  let mayHaveRuntime = false;

  const event = (type) => new dependencies.Event(type, {
    bubbles: false, cancelable: false, composed: false,
  });
  const cleanup = (state) => {
    try { Reflect.apply(dependencies.remove, dependencies.document, [X_PAGE_RUNTIME_READY_EVENT_TYPE, state.ready]); } catch { /* best effort */ }
    try { Reflect.apply(dependencies.remove, dependencies.document, [X_PAGE_RUNTIME_ERROR_EVENT_TYPE, state.error]); } catch { /* best effort */ }
    if (state.script) {
      state.script.onload = null; state.script.onerror = null;
      try { state.script.remove(); } catch { try { state.script.parentNode?.removeChild(state.script); } catch { /* best effort */ } }
      state.script = null;
    }
  };
  const start = () => {
    if (pending) return pending.promise;
    if (active) return dependencies.Promise.resolve();
    const lifecycle = ++generation;
    const state = { script: null, settled: false, ready: null, error: null, cancel: null, promise: null };
    state.promise = new dependencies.Promise((resolve, reject) => {
      const settle = (success) => {
        if (state.settled) return;
        state.settled = true; cleanup(state);
        if (pending === state) pending = null;
        if (success && generation === lifecycle) { active = true; mayHaveRuntime = true; resolve(); }
        else { active = false; reject(new Error('Unable to inject X page runtime')); }
      };
      state.ready = () => settle(true);
      state.error = () => settle(false);
      state.cancel = () => settle(false);
      try {
        Reflect.apply(dependencies.add, dependencies.document, [X_PAGE_RUNTIME_READY_EVENT_TYPE, state.ready]);
        Reflect.apply(dependencies.add, dependencies.document, [X_PAGE_RUNTIME_ERROR_EVENT_TYPE, state.error]);
        Reflect.apply(dependencies.dispatch, dependencies.document, [event(X_PAGE_RUNTIME_REQUEST_EVENT_TYPE)]);
        if (state.settled) return;
        const url = Reflect.apply(dependencies.getURL, dependencies.runtime, ['page/page-script.js']);
        if (typeof url !== 'string' || !/^(?:chrome|moz)-extension:/.test(url)) throw new Error();
        const script = Reflect.apply(dependencies.createElement, dependencies.document, ['script']);
        state.script = script; script.src = url; script.async = false;
        script.onerror = () => settle(false);
        script.onload = () => dependencies.Promise.resolve().then(() => {
          if (!state.settled && generation === lifecycle) settle(false);
        });
        Reflect.apply(dependencies.root.appendChild, dependencies.root, [script]);
      } catch { settle(false); }
    });
    if (!state.settled) pending = state;
    return state.promise;
  };
  const stop = () => {
    const shouldSignal = active || mayHaveRuntime || pending?.script !== null;
    active = false; mayHaveRuntime = false; generation += 1;
    const state = pending;
    if (state) {
      state.cancel();
    }
    if (shouldSignal) {
      try { Reflect.apply(dependencies.dispatch, dependencies.document, [event(X_PAGE_RUNTIME_STOP_EVENT_TYPE)]); } catch { /* best effort */ }
    }
  };
  return Object.freeze({ start, stop, isActive: () => active });
}
