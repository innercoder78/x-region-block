import { createAccountIdentity } from '../shared/account-identity.js';
import {
  X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION,
} from '../shared/x-about-account-request-metadata-event.js';
import {
  HEADER_NAMES, METADATA_LIMIT, QUERY_ID_PATTERN, SNAPSHOT_KEYS, copyJsonSafe, deepFreeze,
  exactStringKeys, isPlainObject, validHeaderValue,
} from '../shared/x-about-account-request-metadata-policy.js';
import { X_ABOUT_ACCOUNT_REQUEST_TRANSPORT_VERSION } from './x-about-account-request-transport.js';

export const X_ABOUT_ACCOUNT_REQUEST_METADATA_BRIDGE_VERSION = 1;

const supportedOrigins = new Set(['https://x.com', 'https://twitter.com']);
const IDENTITY_KEYS = Object.freeze([
  'handle', 'displayHandle', 'profileUrl', 'accountId', 'allowlistKey', 'source',
]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function validateOptions(options) {
  let prototype;
  try { prototype = Object.getPrototypeOf(options); } catch { prototype = undefined; }
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || (prototype !== null && prototype !== Object.prototype)) {
    throw new TypeError('X About Account request metadata bridge options must be a plain object');
  }
  let keys;
  try { keys = Reflect.ownKeys(options); } catch {
    throw new TypeError('Invalid X About Account request metadata bridge options');
  }
  if (keys.length !== 1 || keys[0] !== 'onError' || !hasOwn(options, 'onError')) {
    throw new TypeError('Invalid X About Account request metadata bridge options');
  }
  let onError;
  try { onError = options.onError; } catch {
    throw new TypeError('Invalid X About Account request metadata bridge options');
  }
  if (typeof onError !== 'function') throw new TypeError('onError must be a function');
  return onError;
}

function normalizeSnapshot(candidate, origin) {
  if (!exactStringKeys(candidate, SNAPSHOT_KEYS)
    || candidate.version !== X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION
    || candidate.origin !== origin || !QUERY_ID_PATTERN.test(candidate.queryId)
    || !isPlainObject(candidate.variables) || hasOwn(candidate.variables, 'screen_name')
    || (candidate.features !== null && !isPlainObject(candidate.features))
    || (candidate.fieldToggles !== null && !isPlainObject(candidate.fieldToggles))
    || !isPlainObject(candidate.headers)) throw new TypeError();
  const snapshot = copyJsonSafe(candidate);
  const headerKeys = Reflect.ownKeys(snapshot.headers);
  if (headerKeys.some((key) => !HEADER_NAMES.includes(key))
    || !hasOwn(snapshot.headers, 'authorization') || !hasOwn(snapshot.headers, 'x-csrf-token')
    || headerKeys.some((key) => !validHeaderValue(snapshot.headers[key]))) throw new TypeError();
  return deepFreeze(snapshot);
}

function validIdentity(identity) {
  if (!exactStringKeys(identity, IDENTITY_KEYS)) return false;
  const canonical = createAccountIdentity({
    handle: identity.handle, accountId: identity.accountId, source: identity.source,
  });
  return canonical.source === null && IDENTITY_KEYS.every((key) => canonical[key] === identity[key]);
}

export function createXAboutAccountRequestMetadataBridge(globalScope, options) {
  let dependencies;
  try {
    const prototype = Object.getPrototypeOf(globalScope);
    const location = globalScope.location;
    const document = globalScope.document;
    const Event = globalScope.Event;
    const URLSearchParams = globalScope.URLSearchParams;
    const origin = location.origin;
    if (globalScope === null || typeof globalScope !== 'object' || Array.isArray(globalScope)
      || (prototype !== null && prototype !== Object.prototype) || !supportedOrigins.has(origin)
      || typeof Event !== 'function' || typeof URLSearchParams !== 'function'
      || typeof document.addEventListener !== 'function'
      || typeof document.removeEventListener !== 'function' || typeof document.dispatchEvent !== 'function') throw new TypeError();
    dependencies = { document, Event, URLSearchParams, origin };
  } catch {
    throw new TypeError('Invalid X About Account request metadata bridge global scope');
  }
  const onError = validateOptions(options);
  let active = false;
  let generation = 0;
  let listener = null;
  let snapshot = null;
  const report = (error) => { try { onError(error); } catch { /* Error boundary is isolated. */ } };

  function start() {
    if (active) return;
    generation += 1;
    const ownedGeneration = generation;
    const candidateListener = (event) => {
      if (!active || ownedGeneration !== generation) return;
      try {
        const detail = event.detail;
        if (typeof detail !== 'string' || detail.length > METADATA_LIMIT) throw new TypeError();
        const parsed = JSON.parse(detail);
        const normalized = normalizeSnapshot(parsed, dependencies.origin);
        if (!active || ownedGeneration !== generation) return;
        snapshot = normalized;
      } catch {
        report(new Error('Unable to accept X About Account request metadata'));
      }
    };
    let registrationAttempted = false;
    try {
      registrationAttempted = true;
      dependencies.document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, candidateListener);
      listener = candidateListener;
      active = true;
      dependencies.document.dispatchEvent(new dependencies.Event(
        X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE,
        { bubbles: false, cancelable: false, composed: false },
      ));
    } catch {
      active = false;
      generation += 1;
      listener = null;
      snapshot = null;
      if (registrationAttempted) {
        try { dependencies.document.removeEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, candidateListener); } catch { /* Startup rollback. */ }
      }
      throw new Error('Unable to start X About Account request metadata bridge');
    }
  }

  function stop() {
    if (!active && listener === null) return;
    active = false;
    generation += 1;
    snapshot = null;
    const ownedListener = listener;
    listener = null;
    if (ownedListener) {
      try { dependencies.document.removeEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, ownedListener); }
      catch { report(new Error('Unable to stop X About Account request metadata bridge')); }
    }
  }

  function createRequest(identity, context) {
    if (!active) throw new TypeError('X About Account request metadata bridge is not active');
    if (snapshot === null) throw new Error('X About Account request metadata is unavailable');
    try {
      if (!validIdentity(identity) || !exactStringKeys(context, ['version'])
        || context.version !== X_ABOUT_ACCOUNT_REQUEST_TRANSPORT_VERSION) throw new TypeError();
      const variables = Object.create(null);
      variables.screen_name = identity.handle;
      for (const key of Object.keys(snapshot.variables)) variables[key] = copyJsonSafe(snapshot.variables[key]);
      const parameters = new dependencies.URLSearchParams();
      parameters.set('variables', JSON.stringify(variables));
      if (snapshot.features !== null) parameters.set('features', JSON.stringify(snapshot.features));
      if (snapshot.fieldToggles !== null) parameters.set('fieldToggles', JSON.stringify(snapshot.fieldToggles));
      const headers = Object.create(null);
      for (const key of Object.keys(snapshot.headers)) headers[key] = snapshot.headers[key];
      deepFreeze(headers);
      return Object.freeze({
        url: `${snapshot.origin}/i/api/graphql/${snapshot.queryId}/UserByScreenName?${parameters}`,
        headers,
      });
    } catch {
      throw new TypeError('Invalid X About Account request metadata request');
    }
  }

  return Object.freeze({ start, stop, createRequest, hasSnapshot: () => snapshot !== null, isActive: () => active });
}
