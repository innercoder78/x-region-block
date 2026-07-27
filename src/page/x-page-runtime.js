import {
  X_PAGE_RUNTIME_ERROR_EVENT_TYPE, X_PAGE_RUNTIME_READY_EVENT_TYPE,
  X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, X_PAGE_RUNTIME_STOP_EVENT_TYPE,
} from '../shared/x-page-runtime-event.js';
import { installXAboutAccountRequestCapture } from './x-about-account-request-capture.js';
import { installXNavigationSignal } from './x-navigation-signal.js';

export const X_PAGE_RUNTIME_VERSION = 1;
const installations = new WeakMap();

export function installXPageRuntime(globalScope) {
  if ((typeof globalScope === 'object' && globalScope !== null) || typeof globalScope === 'function') {
    const existing = installations.get(globalScope);
    if (existing?.active) {
      try { Reflect.apply(existing.dispatch, existing.document,
        [new existing.Event(X_PAGE_RUNTIME_REQUEST_EVENT_TYPE,
          { bubbles: false, cancelable: false, composed: false })]); } catch { /* best effort */ }
      return null;
    }
    if (existing) return existing.controller;
  }
  let document;
  let EventConstructor;
  let add;
  let remove;
  let dispatch;
  try {
    document = globalScope.document;
    EventConstructor = globalScope.Event;
    add = document.addEventListener;
    remove = document.removeEventListener;
    dispatch = document.dispatchEvent;
    if (typeof EventConstructor !== 'function' || typeof add !== 'function'
      || typeof remove !== 'function' || typeof dispatch !== 'function') throw new Error();
  } catch {
    try { globalScope.document.dispatchEvent(new globalScope.Event(X_PAGE_RUNTIME_ERROR_EVENT_TYPE,
      { bubbles: false, cancelable: false, composed: false })); } catch { /* unavailable */ }
    throw new Error('Unable to install X page runtime');
  }

  const state = {
    scope: globalScope, document, Event: EventConstructor, add, remove, dispatch,
    active: false, claimed: false, finalized: false, probeMayBeAdded: false,
    requestMayBeAdded: false, stopMayBeAdded: false, navigation: null, capture: null,
    probe: null, respond: null, stopListener: null, controller: null,
  };
  const current = () => installations.get(globalScope) === state && !state.claimed;
  const event = (type) => new state.Event(type, {
    bubbles: false, cancelable: false, composed: false,
  });
  const emit = (type) => Reflect.apply(state.dispatch, state.document, [event(type)]);
  const removeOwnedListeners = () => {
    let failed = false;
    for (const [flag, type, listener] of [
      ['probeMayBeAdded', X_PAGE_RUNTIME_READY_EVENT_TYPE, state.probe],
      ['requestMayBeAdded', X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, state.respond],
      ['stopMayBeAdded', X_PAGE_RUNTIME_STOP_EVENT_TYPE, state.stopListener],
    ]) {
      if (!state[flag]) continue;
      try {
        Reflect.apply(state.remove, state.document, [type, listener]);
        state[flag] = false;
      } catch { failed = true; }
    }
    return failed;
  };
  const finalize = () => {
    if (state.finalized) return;
    state.finalized = true;
    state.active = false;
    removeOwnedListeners();
    try { state.capture?.stop(); } catch { /* contained */ }
    try { state.navigation?.stop(); } catch { /* contained */ }
    state.capture = null; state.navigation = null;
    if (installations.get(globalScope) === state) installations.delete(globalScope);
    state.scope = null; state.document = null; state.Event = null;
    state.add = null; state.remove = null; state.dispatch = null;
  };
  const stop = () => {
    if (state.finalized) return;
    state.claimed = true;
    finalize();
  };
  state.controller = Object.freeze({ stop, isActive: () => state.active });
  state.probe = () => { if (current()) state.crossBundleReady = true; };
  state.respond = () => { if (current() && state.active) { try { emit(X_PAGE_RUNTIME_READY_EVENT_TYPE); } catch { /* best effort */ } } };
  state.stopListener = stop;
  installations.set(globalScope, state);

  const fail = () => {
    state.claimed = true;
    finalize();
    try { Reflect.apply(dispatch, document, [new EventConstructor(X_PAGE_RUNTIME_ERROR_EVENT_TYPE,
      { bubbles: false, cancelable: false, composed: false })]); } catch { /* unavailable */ }
    throw new Error('Unable to install X page runtime');
  };
  const checkpoint = () => { if (!current()) throw new Error('installation claimed'); };
  try {
    state.probeMayBeAdded = true;
    Reflect.apply(add, document, [X_PAGE_RUNTIME_READY_EVENT_TYPE, state.probe]);
    if (!current()) {
      try { Reflect.apply(remove, document, [X_PAGE_RUNTIME_READY_EVENT_TYPE, state.probe]); } catch { /* best effort */ }
    }
    checkpoint();
    emit(X_PAGE_RUNTIME_REQUEST_EVENT_TYPE);
    checkpoint();
    const removalFailed = removeOwnedListeners();
    if (removalFailed) throw new Error();
    checkpoint();
    if (state.crossBundleReady) {
      state.claimed = true;
      finalize();
      return null;
    }
    state.navigation = installXNavigationSignal(globalScope);
    if (!current()) { try { state.navigation?.stop(); } catch { /* contained */ } }
    checkpoint();
    state.capture = installXAboutAccountRequestCapture(globalScope);
    if (!current()) { try { state.capture?.stop(); } catch { /* contained */ } }
    checkpoint();
    state.requestMayBeAdded = true;
    Reflect.apply(add, document, [X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, state.respond]);
    if (!current()) {
      try { Reflect.apply(remove, document, [X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, state.respond]); } catch { /* best effort */ }
    }
    checkpoint();
    state.stopMayBeAdded = true;
    Reflect.apply(add, document, [X_PAGE_RUNTIME_STOP_EVENT_TYPE, state.stopListener]);
    if (!current()) {
      try { Reflect.apply(remove, document, [X_PAGE_RUNTIME_STOP_EVENT_TYPE, state.stopListener]); } catch { /* best effort */ }
    }
    checkpoint();
    state.active = true;
    emit(X_PAGE_RUNTIME_READY_EVENT_TYPE);
    checkpoint();
    return state.controller;
  } catch { return fail(); }
}
