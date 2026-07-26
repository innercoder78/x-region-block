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
  if (typeof options.onNavigate !== 'function') throw new TypeError('onNavigate must be a function');
  if (typeof options.onError !== 'function') throw new TypeError('onError must be a function');
  const onNavigate = options.onNavigate;
  const onError = options.onError;
  let active = false;
  let generation = 0;
  let documentListener = null;
  let popstateListener = null;
  const report = (error) => { try { onError(error); } catch { /* silent boundary */ } };
  const start = () => {
    if (active) return location.href;
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
    let documentAdded = false;
    try {
      document.addEventListener(X_NAVIGATION_EVENT_TYPE, deliver);
      documentAdded = true;
      globalScope.addEventListener('popstate', deliver);
      const href = location.href;
      if (typeof href !== 'string') throw new TypeError('Invalid X navigation observer global scope');
      return href;
    } catch (error) {
      active = false; generation += 1;
      if (documentAdded) { try { document.removeEventListener(X_NAVIGATION_EVENT_TYPE, deliver); } catch { /* preserve */ } }
      try { globalScope.removeEventListener('popstate', deliver); } catch { /* preserve */ }
      documentListener = null; popstateListener = null;
      throw error;
    }
  };
  const stop = () => {
    if (!active) return;
    active = false; generation += 1;
    const oldDocument = documentListener;
    const oldPopstate = popstateListener;
    documentListener = null; popstateListener = null;
    let failed = false;
    try { document.removeEventListener(X_NAVIGATION_EVENT_TYPE, oldDocument); } catch { failed = true; }
    try { globalScope.removeEventListener('popstate', oldPopstate); } catch { failed = true; }
    if (failed) report(new Error('Unable to stop X navigation observer'));
  };
  const getCurrentUrl = () => {
    if (!active) throw new TypeError('X navigation observer is not active');
    return location.href;
  };
  const isActive = () => active;
  return Object.freeze({ start, stop, getCurrentUrl, isActive });
}
