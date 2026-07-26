import { X_NAVIGATION_EVENT_TYPE } from '../shared/x-navigation-event.js';

export const X_NAVIGATION_OBSERVER_VERSION = 1;
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try { return [Object.prototype, null].includes(Object.getPrototypeOf(value)); } catch { return false; }
}

export function createXNavigationObserver(globalScope, options) {
  let location;
  let document;
  try {
    location = globalScope?.location;
    document = globalScope?.document;
    if (globalScope === null || typeof globalScope !== 'object' || Array.isArray(globalScope)
      || location === null || typeof location !== 'object' || typeof location.href !== 'string'
      || typeof globalScope.addEventListener !== 'function'
      || typeof globalScope.removeEventListener !== 'function'
      || document === null || typeof document !== 'object'
      || typeof document.addEventListener !== 'function'
      || typeof document.removeEventListener !== 'function') throw new Error();
  } catch { throw new TypeError('Invalid X navigation observer global scope'); }
  if (!plain(options)) throw new TypeError('X navigation observer options must be a plain object');
  let keys;
  try { keys = Reflect.ownKeys(options); } catch { throw new TypeError('Invalid X navigation observer options'); }
  if (keys.length !== 2 || keys.some((key) => typeof key !== 'string')
    || !hasOwn(options, 'onNavigate') || !hasOwn(options, 'onError')) {
    throw new TypeError('Invalid X navigation observer options');
  }
  let onNavigate;
  let onError;
  try {
    onNavigate = options.onNavigate;
    onError = options.onError;
  } catch { throw new TypeError('Invalid X navigation observer options'); }
  if (typeof onNavigate !== 'function') throw new TypeError('onNavigate must be a function');
  if (typeof onError !== 'function') throw new TypeError('onError must be a function');
  let active = false;
  let generation = 0;
  let documentListener = null;
  let popstateListener = null;
  let registration = null;
  const report = (error) => { try { onError(error); } catch { /* silent boundary */ } };
  const readStartUrl = () => {
    const href = location.href;
    if (typeof href !== 'string') throw new TypeError('Invalid X navigation observer global scope');
    return href;
  };
  const start = () => {
    if (active) return readStartUrl();
    const lifecycle = generation + 1;
    const deliver = () => {
      if (!active || generation !== lifecycle) return;
      let href;
      try { href = location.href; } catch { report(new Error('Unable to read X navigation URL')); return; }
      if (typeof href !== 'string') { report(new Error('Unable to read X navigation URL')); return; }
      try { onNavigate(href); } catch { report(new Error('Unable to deliver X navigation')); }
    };
    active = true;
    generation = lifecycle;
    documentListener = deliver;
    popstateListener = deliver;
    const currentRegistration = {
      lifecycle,
      documentMayBeRegistered: false,
      globalMayBeRegistered: false,
      documentRemoved: false,
      globalRemoved: false,
      complete: false,
    };
    registration = currentRegistration;
    const stillCurrent = () => active && generation === lifecycle
      && registration === currentRegistration;
    const removeRegistered = () => {
      if (currentRegistration.documentMayBeRegistered
        && !currentRegistration.documentRemoved) {
        currentRegistration.documentRemoved = true;
        try { document.removeEventListener(X_NAVIGATION_EVENT_TYPE, deliver); } catch { /* rollback */ }
      }
      if (currentRegistration.globalMayBeRegistered && !currentRegistration.globalRemoved) {
        currentRegistration.globalRemoved = true;
        try { globalScope.removeEventListener('popstate', deliver); } catch { /* rollback */ }
      }
    };
    const interrupted = () => {
      removeRegistered();
      if (registration === currentRegistration) registration = null;
      documentListener = null;
      popstateListener = null;
      throw new Error('X navigation observer start was interrupted');
    };
    try {
      currentRegistration.documentMayBeRegistered = true;
      document.addEventListener(X_NAVIGATION_EVENT_TYPE, deliver);
      if (!stillCurrent()) interrupted();
      currentRegistration.globalMayBeRegistered = true;
      globalScope.addEventListener('popstate', deliver);
      if (!stillCurrent()) interrupted();
      const href = readStartUrl();
      if (!stillCurrent()) interrupted();
      currentRegistration.complete = true;
      return href;
    } catch (error) {
      if (stillCurrent()) { active = false; generation += 1; }
      removeRegistered();
      if (registration === currentRegistration) registration = null;
      documentListener = null; popstateListener = null;
      throw error;
    }
  };
  const stop = () => {
    if (!active) return;
    active = false; generation += 1;
    const oldDocument = documentListener;
    const oldPopstate = popstateListener;
    const currentRegistration = registration;
    documentListener = null; popstateListener = null;
    registration = null;
    let failed = false;
    if (currentRegistration === null || (currentRegistration.documentMayBeRegistered
      && !currentRegistration.documentRemoved)) {
      if (currentRegistration !== null) currentRegistration.documentRemoved = true;
      try { document.removeEventListener(X_NAVIGATION_EVENT_TYPE, oldDocument); } catch { failed = true; }
    }
    if (currentRegistration === null || (currentRegistration.globalMayBeRegistered
      && !currentRegistration.globalRemoved)) {
      if (currentRegistration !== null) currentRegistration.globalRemoved = true;
      try { globalScope.removeEventListener('popstate', oldPopstate); } catch { failed = true; }
    }
    if (failed && (currentRegistration === null || currentRegistration.complete)) {
      report(new Error('Unable to stop X navigation observer'));
    }
  };
  const getCurrentUrl = () => {
    if (!active) throw new TypeError('X navigation observer is not active');
    return location.href;
  };
  const isActive = () => active;
  return Object.freeze({ start, stop, getCurrentUrl, isActive });
}
