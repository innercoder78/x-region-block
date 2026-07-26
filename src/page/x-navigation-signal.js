import { X_NAVIGATION_EVENT_TYPE } from '../shared/x-navigation-event.js';

export const X_NAVIGATION_SIGNAL_VERSION = 1;

const installations = new WeakMap();

function invalidScope() {
  throw new TypeError('Invalid X navigation signal global scope');
}

export function installXNavigationSignal(globalScope) {
  let history;
  let document;
  let EventConstructor;
  let pushState;
  let replaceState;
  try {
    if (globalScope === null || typeof globalScope !== 'object' || Array.isArray(globalScope)) {
      invalidScope();
    }
    const existing = installations.get(globalScope);
    if (existing !== undefined) return existing;
    history = globalScope.history;
    document = globalScope.document;
    EventConstructor = globalScope.Event;
    pushState = history?.pushState;
    replaceState = history?.replaceState;
    if (history === null || typeof history !== 'object' || document === null
      || typeof document !== 'object' || typeof document.dispatchEvent !== 'function'
      || typeof EventConstructor !== 'function' || typeof pushState !== 'function'
      || typeof replaceState !== 'function') invalidScope();
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Invalid X navigation signal global scope') throw error;
    invalidScope();
  }

  let active = true;
  let scope = globalScope;
  let ownedHistory = history;
  let ownedDocument = document;
  let OwnedEvent = EventConstructor;
  let originalPush = pushState;
  let originalReplace = replaceState;
  let pushWrapper;
  let replaceWrapper;
  let controller;
  const signal = () => {
    try { ownedDocument.dispatchEvent(new OwnedEvent(X_NAVIGATION_EVENT_TYPE)); } catch { /* signaling is best effort */ }
  };
  pushWrapper = function (...args) {
    const result = Reflect.apply(originalPush, this, args);
    signal();
    return result;
  };
  replaceWrapper = function (...args) {
    const result = Reflect.apply(originalReplace, this, args);
    signal();
    return result;
  };
  const isActive = () => active;
  const clear = () => {
    scope = null; ownedHistory = null; ownedDocument = null; OwnedEvent = null;
    originalPush = null; originalReplace = null; pushWrapper = null; replaceWrapper = null;
    controller = null;
  };
  const stop = () => {
    if (!active) return;
    active = false;
    installations.delete(scope);
    try { if (ownedHistory.pushState === pushWrapper) ownedHistory.pushState = originalPush; } catch { /* best effort */ }
    try { if (ownedHistory.replaceState === replaceWrapper) ownedHistory.replaceState = originalReplace; } catch { /* best effort */ }
    clear();
  };
  controller = Object.freeze({ stop, isActive });
  let pushInstalled = false;
  try {
    ownedHistory.pushState = pushWrapper;
    pushInstalled = ownedHistory.pushState === pushWrapper;
    if (!pushInstalled) throw new Error();
    ownedHistory.replaceState = replaceWrapper;
    if (ownedHistory.replaceState !== replaceWrapper) throw new Error();
    installations.set(globalScope, controller);
    return controller;
  } catch {
    active = false;
    if (pushInstalled) {
      try { if (ownedHistory.pushState === pushWrapper) ownedHistory.pushState = originalPush; } catch { /* best effort */ }
    }
    try { if (ownedHistory.replaceState === replaceWrapper) ownedHistory.replaceState = originalReplace; } catch { /* best effort */ }
    clear();
    throw new Error('Unable to install X navigation signal');
  }
}
