import { readXAccountIdentityFromLink } from './account-link-reader.js';
import { applyAccountAction, removeAccountAction } from './account-action-renderer.js';
import { presentXAccountLink, presentXAccountLinkInPost } from './account-presentation.js';
import { reconcilePostLocationHeader, removePostLocationHeader } from './post-location-header.js';
import { evaluateXAccountLink } from './account-evaluation.js';
import { ACCOUNT_TARGET_DISCOVERY_VERSION } from './account-target-discovery.js';
import { ACCOUNT_TARGET_OBSERVER_VERSION } from './account-target-observer.js';
import { findLocationBadge, removeLocationBadge } from './location-badge-renderer.js';
import { ACCOUNT_IDENTITY_SOURCES, createAccountIdentity } from '../shared/account-identity.js';
import { normalizeSettings } from '../shared/settings-schema.js';
import {
  createUnavailableXAboutAccountDetails, parseXAboutAccountDetailsPayload,
} from '../shared/x-about-account-details.js';
import { X_ABOUT_ACCOUNT_RECOVERY_CODES } from '../shared/x-about-account-recovery.js';

export const ACCOUNT_TARGET_PROCESSOR_VERSION = 1;

const EMPTY = Object.freeze([]);
const REASONS = new Set(['initial', 'mutation', 'manual']);
const hasOwn = (value, property) => Object.prototype.hasOwnProperty.call(value, property);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPlainObject = (value) => {
  if (!isObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null || prototype === Object.prototype) return true;
  // A different realm has a different Object.prototype identity. Its Object.prototype still
  // terminates the prototype chain directly, unlike a class prototype.
  return Object.getPrototypeOf(prototype) === null
    && hasOwn(prototype, 'constructor')
    && Function.prototype.toString.call(prototype.constructor)
      === Function.prototype.toString.call(Object);
};
const TARGET_KEYS = Object.freeze([
  'version', 'source', 'accountContainer', 'link', 'badgeContainer', 'identity',
]);
const IDENTITY_KEYS = Object.freeze([
  'handle', 'displayHandle', 'profileUrl', 'accountId', 'allowlistKey', 'source',
]);
const UPDATED_KEYS = Object.freeze(['previous', 'current']);
const DIAGNOSTIC_CODES = new Set(['PAGE_BRIDGE_UNAVAILABLE', 'NO_METADATA', 'METADATA_SYNC', 'NETWORK', 'INVALID_RESPONSE',
  'INVALID_PAYLOAD', 'BRIDGE_TIMEOUT', 'UNKNOWN', 'HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_429', 'HTTP_5XX']);
const DIAGNOSTIC_MESSAGES = Object.freeze({
  PAGE_BRIDGE_UNAVAILABLE: 'About Account request bridge unavailable.',
  BRIDGE_TIMEOUT: 'About Account request bridge timed out.',
  UNKNOWN: 'About Account request failed unexpectedly.',
  NO_METADATA: 'About Account metadata is unavailable.',
  METADATA_SYNC: 'About Account metadata synchronization failed.',
  NETWORK: 'About Account network request failed.', INVALID_RESPONSE: 'About Account response was invalid.',
  INVALID_PAYLOAD: 'About Account response payload was invalid.', HTTP_400: 'About Account request rejected.',
  HTTP_401: 'About Account authentication metadata rejected.', HTTP_403: 'About Account authentication metadata rejected.',
  HTTP_404: 'About Account query ID rejected.', HTTP_429: 'About Account lookup rate limited.',
  HTTP_5XX: 'About Account server request failed.',
});

function sanitizedDiagnosticError(error, fallback) {
  const code = typeof error?.code === 'string' && DIAGNOSTIC_CODES.has(error.code) ? error.code : null;
  const diagnostic = new Error(code === null ? fallback : DIAGNOSTIC_MESSAGES[code]);
  if (code !== null) Object.defineProperty(diagnostic, 'code', { value: code, enumerable: false });
  const status = error?.status;
  if (code !== null && Number.isInteger(status) && status >= 100 && status <= 599) {
    Object.defineProperty(diagnostic, 'status', { value: status, enumerable: false });
  }
  return diagnostic;
}

function hasExactlyOwnKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && keys.every((key) => hasOwn(value, key));
}

function normalizeOptions(options) {
  if (!isObject(options)) {
    throw new TypeError('account target processor options must be a plain object');
  }
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('account target processor options must be a plain object');
  }
  if (hasOwn(options, 'accountId')) {
    throw new TypeError('accountId is not supported by account target processing');
  }
  if (!hasOwn(options, 'source') || typeof options.source !== 'string') {
    throw new TypeError('Invalid account target processor source');
  }
  const source = options.source.trim().toLowerCase();
  if (!ACCOUNT_IDENTITY_SOURCES.includes(source)) {
    throw new TypeError('Invalid account target processor source');
  }
  // Normalize before retaining any callback or other caller-supplied reference. An inherited
  // value is deliberately read as absent.
  const suppliedSettings = hasOwn(options, 'settings') ? options.settings : undefined;
  const settings = normalizeSettings(suppliedSettings);
  if (!hasOwn(options, 'loadAboutAccountPayload')
    || typeof options.loadAboutAccountPayload !== 'function') {
    throw new TypeError('loadAboutAccountPayload must be a function');
  }
  if (!hasOwn(options, 'abortControllerFactory')
    || typeof options.abortControllerFactory !== 'function') {
    throw new TypeError('abortControllerFactory must be a function');
  }
  if (!hasOwn(options, 'onError') || typeof options.onError !== 'function') {
    throw new TypeError('onError must be a function');
  }
  if (hasOwn(options, 'resolveFlagAssetUrl') && typeof options.resolveFlagAssetUrl !== 'function') {
    throw new TypeError('resolveFlagAssetUrl must be a function');
  }
  return {
    source,
    settings,
    hasBaseUrl: hasOwn(options, 'baseUrl'),
    baseUrl: options.baseUrl,
    loadAboutAccountPayload: options.loadAboutAccountPayload,
    abortControllerFactory: options.abortControllerFactory,
    onError: options.onError,
    resolveFlagAssetUrl: options.resolveFlagAssetUrl ?? (() => ''),
  };
}

function validTarget(target, source) {
  if (!hasExactlyOwnKeys(target, TARGET_KEYS)
    || target.version !== ACCOUNT_TARGET_DISCOVERY_VERSION || target.source !== source
    || !isObject(target.accountContainer) || !isObject(target.link)
    || typeof target.link.tagName !== 'string' || target.link.tagName.toLowerCase() !== 'a'
    || !isObject(target.link.ownerDocument) || typeof target.link.getAttribute !== 'function'
    || !hasExactlyOwnKeys(target.identity, IDENTITY_KEYS)) return false;

  const identity = target.identity;
  let canonical;
  try {
    canonical = createAccountIdentity({
      handle: identity.handle,
      accountId: identity.accountId,
      source: identity.source,
    });
    // This invokes the existing renderer's non-mutating container validation boundary.
    findLocationBadge(target.badgeContainer);
  } catch { return false; }
  return identity.source === source && IDENTITY_KEYS.every((key) => identity[key] === canonical[key]);
}

function validAuxiliary(change, source) {
  if (!change.added.every((target) => validTarget(target, source))
    || !change.removed.every((target) => validTarget(target, source))) return false;
  return change.updated.every((update) => hasExactlyOwnKeys(update, UPDATED_KEYS)
    && validTarget(update.previous, source) && validTarget(update.current, source));
}

function validateChange(change, source) {
  let valid = false;
  try {
    valid = isPlainObject(change) && change.version === ACCOUNT_TARGET_OBSERVER_VERSION
      && REASONS.has(change.reason) && change.source === source
      && Array.isArray(change.current) && Array.isArray(change.added)
      && Array.isArray(change.updated) && Array.isArray(change.removed)
      && change.current.every((target) => validTarget(target, source))
      && validAuxiliary(change, source);
  } catch { valid = false; }
  if (!valid) {
    throw new TypeError('Invalid account target change');
  }
  let duplicate = true;
  try {
    const containers = new Set(change.current.map((target) => target.accountContainer));
    duplicate = containers.size !== change.current.length;
  } catch { /* Report the common validation error below. */ }
  if (duplicate) {
    throw new TypeError('Invalid account target change');
  }
}

/** Coordinates explicitly supplied account targets without starting observation or transport. */
export function createXAccountTargetProcessor(options) {
  const normalized = normalizeOptions(options);
  let settings = normalized.settings;
  let active = false;
  let generation = 0;
  let targets = EMPTY;
  let targetByContainer = new Map();
  let accounts = new Map();

  const report = (error) => {
    try { normalized.onError(error); } catch { /* The injected error boundary is intentionally silent. */ }
  };
  const readerOptions = () => (normalized.hasBaseUrl
    ? { source: normalized.source, baseUrl: normalized.baseUrl }
    : { source: normalized.source });
  const removeBadge = (target) => {
    const removed = removePostLocationHeader(target);
    return removed + removeLocationBadge(target.badgeContainer);
  };
  const removeAction = (target) => removeAccountAction(target.accountContainer);

  const present = (target, details) => {
    let identity;
    try { identity = readXAccountIdentityFromLink(target.link, readerOptions()); } catch {
      identity = null;
    }
    if (identity === null || identity.source !== target.identity.source
      || identity.allowlistKey !== target.identity.allowlistKey) {
      try { removeBadge(target); } catch { /* Link drift cleanup is best effort. */ }
      try { removeAction(target); } catch { /* Link drift cleanup is best effort. */ }
      return;
    }
    const observation = normalized.hasBaseUrl
      ? { source: normalized.source, location: details.location, baseUrl: normalized.baseUrl }
      : { source: normalized.source, location: details.location };
    try {
      const isPost = target.source === 'timeline' || target.source === 'reply';
      const host = isPost ? reconcilePostLocationHeader(target) : target.badgeContainer;
      const evaluation = isPost && host === null
        ? evaluateXAccountLink(target.link, observation, settings)
        : isPost && host !== target.badgeContainer
        ? presentXAccountLinkInPost(target.link, host, observation, settings,
          normalized.resolveFlagAssetUrl, details)
        : presentXAccountLink(target.link, host, observation, settings, normalized.resolveFlagAssetUrl);
      if (evaluation === null) removeAction(target);
      else applyAccountAction(target.accountContainer, evaluation.action);
    } catch {
      try { removeAction(target); } catch { /* Presentation cleanup is best effort. */ }
      report(new Error('Unable to present account location'));
    }
  };
  const presentEntry = (entry) => {
    for (const target of targets) {
      if (entry.targets.has(target) && entry.details !== null) present(target, entry.details);
    }
  };
  const isCurrent = (entry) => active && entry.live && entry.generation === generation
    && accounts.get(entry.key) === entry && entry.targets.size > 0;
  const resolveFailure = (entry, message, error = null) => {
    if (!isCurrent(entry)) return;
    entry.pending = null;
    entry.controller = null;
    if (error?.name === 'AbortError' || error?.code === 'ABORTED') return;
    const transient = ['HTTP_429', 'NETWORK', 'HTTP_5XX', 'BRIDGE_TIMEOUT',
      'PAGE_BRIDGE_UNAVAILABLE', 'NO_METADATA', 'METADATA_SYNC'].includes(error?.code);
    if (!transient) entry.details = createUnavailableXAboutAccountDetails();
    entry.recoverable = transient || error?.code === X_ABOUT_ACCOUNT_RECOVERY_CODES.AUTHENTICATION
      || error?.code === X_ABOUT_ACCOUNT_RECOVERY_CODES.QUERY;
    report(sanitizedDiagnosticError(error, message));
    if (!transient) presentEntry(entry);
  };
  const startLookup = (entry) => {
    let controller;
    let signal;
    let abort;
    let promise;
    try {
      controller = normalized.abortControllerFactory();
      if (!isObject(controller)) throw new TypeError('invalid abort controller');
      // AbortController members are prototype accessors/methods in browsers. Capture each
      // potentially caller-controlled property once and validate structurally across realms.
      signal = controller.signal;
      abort = controller.abort;
      if (!isObject(signal) || typeof signal.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function'
        || typeof signal.removeEventListener !== 'function'
        || typeof abort !== 'function') throw new TypeError('invalid abort controller');
      entry.controller = Object.freeze({ abort: () => abort.call(controller) });
      const context = Object.freeze({
        version: ACCOUNT_TARGET_PROCESSOR_VERSION,
        signal,
      });
      promise = Promise.resolve(normalized.loadAboutAccountPayload(entry.identity, context));
      entry.pending = promise;
    } catch {
      entry.controller = null;
      resolveFailure(entry, 'Unable to load account location');
      return;
    }
    promise.then((payload) => {
      if (!isCurrent(entry) || entry.pending !== promise) return;
      let details;
      try { details = parseXAboutAccountDetailsPayload(payload); } catch {
        resolveFailure(entry, 'Unable to parse account location');
        return;
      }
      if (!isCurrent(entry) || entry.pending !== promise) return;
      entry.pending = null;
      entry.controller = null;
      entry.details = details;
      presentEntry(entry);
    }, (error) => resolveFailure(entry, 'Unable to load account location', error));
  };
  const retireEmptyEntries = () => {
    for (const [key, entry] of accounts) {
      if (entry.targets.size !== 0) continue;
      entry.live = false;
      accounts.delete(key);
      const controller = entry.controller;
      entry.pending = null;
      entry.controller = null;
      entry.details = null;
      if (controller !== null) {
        try { controller.abort(); } catch { /* Cancellation failure is intentionally silent. */ }
      }
    }
  };

  const start = () => {
    if (active) return targets;
    active = true;
    generation += 1;
    return targets;
  };
  const stop = () => {
    if (!active) return;
    active = false;
    generation += 1;
    let failed = false;
    for (const entry of accounts.values()) {
      entry.live = false;
      const controller = entry.controller;
      entry.pending = null;
      entry.controller = null;
      entry.details = null;
      entry.targets.clear();
      if (controller !== null) {
        try { controller.abort(); } catch { failed = true; }
      }
    }
    for (const target of targets) {
      try { removeBadge(target); } catch { failed = true; }
      try { removeAction(target); } catch { failed = true; }
    }
    accounts.clear();
    targetByContainer.clear();
    targets = EMPTY;
    // Replace collections so no internal capacity continues to reference removed values.
    accounts = new Map();
    targetByContainer = new Map();
    if (failed) report(new Error('Unable to clean up account target processing'));
  };
  const processChange = (change) => {
    if (!active) throw new TypeError('account target processor is not active');
    validateChange(change, normalized.source);

    const nextTargets = change.current.length === 0 ? EMPTY : Object.freeze([...change.current]);
    const nextByContainer = new Map(nextTargets.map((target) => [target.accountContainer, target]));
    let cleanupFailed = false;
    let actionCleanupFailed = false;
    for (const previous of targets) {
      const next = nextByContainer.get(previous.accountContainer);
      if (next === previous) continue;
      const entry = accounts.get(previous.identity.allowlistKey);
      if (entry) entry.targets.delete(previous);
      try { removeBadge(previous); } catch { cleanupFailed = true; }
      try { removeAction(previous); } catch { actionCleanupFailed = true; }
    }

    targets = nextTargets;
    targetByContainer = nextByContainer;
    const entriesToStart = [];
    for (const target of targets) {
      // The map now contains the new snapshot; membership in an entry identifies stable records.
      let entry = accounts.get(target.identity.allowlistKey);
      if (entry?.targets.has(target)) continue;
      if (!entry) {
        entry = {
          key: target.identity.allowlistKey,
          identity: target.identity,
          targets: new Set(),
          pending: null,
          controller: null,
          details: null,
          generation,
          live: true,
          recoverable: false,
        };
        accounts.set(entry.key, entry);
        entriesToStart.push(entry);
      }
      entry.targets.add(target);
      if (entry.details !== null) present(target, entry.details);
    }
    retireEmptyEntries();
    for (const entry of entriesToStart) {
      if (isCurrent(entry) && entry.pending === null && entry.details === null) startLookup(entry);
    }
    if (cleanupFailed) report(new Error('Unable to remove account location badge'));
    if (actionCleanupFailed) report(new Error('Unable to remove account filter action'));
    return targets;
  };
  const setSettings = (value) => {
    const next = normalizeSettings(value);
    settings = next;
    if (active) {
      for (const target of targets) {
        const entry = accounts.get(target.identity.allowlistKey);
        if (entry?.details !== null && entry?.details !== undefined) present(target, entry.details);
      }
    }
    return settings;
  };
  const getTargets = () => targets;
  const retryRecoverable = () => {
    if (!active) return 0;
    let count = 0;
    for (const entry of accounts.values()) {
      if (!entry.recoverable || !isCurrent(entry) || entry.pending !== null) continue;
      entry.recoverable = false;
      entry.details = null;
      startLookup(entry);
      count += 1;
    }
    return count;
  };
  const isActive = () => active;

  return Object.freeze({ start, stop, processChange, setSettings, retryRecoverable, getTargets, isActive });
}
