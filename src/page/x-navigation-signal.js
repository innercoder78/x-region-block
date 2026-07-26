import { X_NAVIGATION_EVENT_TYPE } from '../shared/x-navigation-event.js';

export const X_NAVIGATION_SIGNAL_VERSION = 1;

const installations = new WeakMap();

function invalidScope() {
  throw new TypeError('Invalid X navigation signal global scope');
}

function restore(history, property, wrapper, original, attempted) {
  if (!attempted) return;
  let current;
  try {
    current = history[property];
  } catch {
    // A write-only or temporarily failing facade cannot be compared. Since this
    // transaction assigned the property, make a best-effort rollback.
    try { history[property] = original; } catch { /* continue rollback */ }
    return;
  }
  if (current === wrapper) {
    try { history[property] = original; } catch { /* continue rollback */ }
  }
}

export function installXNavigationSignal(globalScope) {
  let history;
  let document;
  let EventConstructor;
  let pushState;
  let replaceState;
  try {
    if (globalScope === null || typeof globalScope !== 'object' || Array.isArray(globalScope)) {
      throw new Error();
    }
    const existing = installations.get(globalScope);
    if (existing !== undefined) return existing;
    history = globalScope.history;
    document = globalScope.document;
    EventConstructor = globalScope.Event;
    pushState = history.pushState;
    replaceState = history.replaceState;
    if (history === null || typeof history !== 'object' || document === null
      || typeof document !== 'object' || typeof document.dispatchEvent !== 'function'
      || typeof EventConstructor !== 'function' || typeof pushState !== 'function'
      || typeof replaceState !== 'function') throw new Error();
  } catch { invalidScope(); }

  // Wrapper-local delegates intentionally survive stop if page code retained a
  // wrapper. Only the small signaling state is disabled and detached.
  const signalState = { active: true, document, EventConstructor };
  function emit() {
    if (!signalState.active) return;
    try {
      signalState.document.dispatchEvent(
        new signalState.EventConstructor(X_NAVIGATION_EVENT_TYPE),
      );
    } catch { /* signaling is best effort */ }
  }
  const pushWrapper = function (...args) {
    const result = Reflect.apply(pushState, this, args);
    emit();
    return result;
  };
  const replaceWrapper = function (...args) {
    const result = Reflect.apply(replaceState, this, args);
    emit();
    return result;
  };

  let active = true;
  let ownedScope = globalScope;
  let ownedHistory = history;
  let controller;
  const isActive = () => active;
  const stop = () => {
    if (!active) return;
    active = false;
    signalState.active = false;
    signalState.document = null;
    signalState.EventConstructor = null;
    installations.delete(ownedScope);
    restore(ownedHistory, 'pushState', pushWrapper, pushState, true);
    restore(ownedHistory, 'replaceState', replaceWrapper, replaceState, true);
    ownedScope = null;
    ownedHistory = null;
    controller = null;
  };
  controller = Object.freeze({ stop, isActive });

  let pushAttempted = false;
  let replaceAttempted = false;
  try {
    pushAttempted = true;
    history.pushState = pushWrapper;
    if (history.pushState !== pushWrapper) throw new Error();
    replaceAttempted = true;
    history.replaceState = replaceWrapper;
    if (history.replaceState !== replaceWrapper) throw new Error();
    installations.set(globalScope, controller);
    return controller;
  } catch {
    active = false;
    signalState.active = false;
    signalState.document = null;
    signalState.EventConstructor = null;
    installations.delete(globalScope);
    restore(history, 'replaceState', replaceWrapper, replaceState, replaceAttempted);
    restore(history, 'pushState', pushWrapper, pushState, pushAttempted);
    ownedScope = null;
    ownedHistory = null;
    controller = null;
    throw new Error('Unable to install X navigation signal');
  }
}
