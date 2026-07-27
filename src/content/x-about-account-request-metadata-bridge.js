import { createAccountIdentity } from '../shared/account-identity.js';
import {
  X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION,
} from '../shared/x-about-account-request-metadata-event.js';
import {
  METADATA_DETAIL_LIMIT, copyAndValidateJsonValue, deeplyFreezeMetadata,
  isMetadataPlainObject, metadataHeaderNames, validMetadataHeaderValue, validMetadataQueryId,
} from '../shared/x-about-account-request-metadata-policy.js';
import { X_ABOUT_ACCOUNT_REQUEST_TRANSPORT_VERSION } from './x-about-account-request-transport.js';
import { X_ABOUT_ACCOUNT_OPERATION_NAME } from '../shared/x-about-account-query.js';

export const X_ABOUT_ACCOUNT_REQUEST_METADATA_BRIDGE_VERSION = 1;

const supportedOrigins = new Set(['https://x.com', 'https://twitter.com']);
const IDENTITY_KEYS = Object.freeze([
  'handle', 'displayHandle', 'profileUrl', 'accountId', 'allowlistKey', 'source',
]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const SNAPSHOT_KEYS = Object.freeze([
  'version', 'origin', 'queryId', 'headers',
]);

function exactStringKeys(value, keys) {
  if (!isMetadataPlainObject(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === 'string')
    && keys.every((key) => hasOwn(value, key));
}

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
    || typeof candidate.version !== 'number'
    || candidate.version !== X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION
    || typeof candidate.origin !== 'string' || candidate.origin !== origin
    || typeof candidate.queryId !== 'string' || !validMetadataQueryId(candidate.queryId)
    || !isMetadataPlainObject(candidate.headers)) throw new TypeError();
  const snapshot = copyAndValidateJsonValue(candidate, { requireObject: true });
  const headerKeys = Reflect.ownKeys(snapshot.headers);
  if (headerKeys.some((key) => !metadataHeaderNames().includes(key))
    || !hasOwn(snapshot.headers, 'authorization') || !hasOwn(snapshot.headers, 'x-csrf-token')
    || headerKeys.some((key) => !validMetadataHeaderValue(snapshot.headers[key]))) throw new TypeError();
  return deeplyFreezeMetadata(snapshot);
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
    const documentAddEventListener = document.addEventListener;
    const documentRemoveEventListener = document.removeEventListener;
    const documentDispatchEvent = document.dispatchEvent;
    if (globalScope === null || typeof globalScope !== 'object' || Array.isArray(globalScope)
      || (prototype !== null && prototype !== Object.prototype) || !supportedOrigins.has(origin)
      || typeof Event !== 'function' || typeof URLSearchParams !== 'function'
      || typeof documentAddEventListener !== 'function'
      || typeof documentRemoveEventListener !== 'function'
      || typeof documentDispatchEvent !== 'function') throw new TypeError();
    dependencies = { document, documentAddEventListener, documentRemoveEventListener,
      documentDispatchEvent, Event, URLSearchParams, origin };
  } catch {
    throw new TypeError('Invalid X About Account request metadata bridge global scope');
  }
  const onError = validateOptions(options);
  let active = false;
  let generation = 0;
  let listener = null;
  let startup = null;
  let snapshot = null;
  let rejected = null;
  let refreshWaiters = new Set();
  const report = (error) => { try { onError(error); } catch { /* Error boundary is isolated. */ } };

  function start() {
    if (active) return;
    generation += 1;
    const ownedGeneration = generation;
    const candidateListener = (event) => {
      if (!active || ownedGeneration !== generation) return;
      try {
        const detail = event.detail;
        if (typeof detail !== 'string' || detail.length > METADATA_DETAIL_LIMIT) throw new TypeError();
        const parsed = JSON.parse(detail);
        const normalized = normalizeSnapshot(parsed, dependencies.origin);
        if (!active || ownedGeneration !== generation) return;
        if (rejected?.kind === 'authentication'
          && JSON.stringify(normalized.headers) === rejected.headers) return;
        if (rejected?.kind === 'query' && normalized.queryId === rejected.queryId) return;
        snapshot = normalized;
        rejected = null;
        const waiters = refreshWaiters;
        refreshWaiters = new Set();
        for (const resolve of waiters) resolve();
      } catch {
        if (active && ownedGeneration === generation) {
          report(new Error('Unable to accept X About Account request metadata'));
        }
      }
    };
    const transaction = { generation: ownedGeneration, listener: candidateListener };
    startup = transaction;
    listener = candidateListener;
    active = true;
    try {
      Reflect.apply(dependencies.documentAddEventListener, dependencies.document,
        [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, candidateListener]);
      if (!active || generation !== ownedGeneration || startup !== transaction) {
        try { Reflect.apply(dependencies.documentRemoveEventListener, dependencies.document,
          [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, candidateListener]); } catch { /* Stop owns cleanup. */ }
        return;
      }
      const replayEvent = new dependencies.Event(
        X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE,
        { bubbles: false, cancelable: false, composed: false },
      );
      if (!active || generation !== ownedGeneration || startup !== transaction) {
        try { Reflect.apply(dependencies.documentRemoveEventListener, dependencies.document,
          [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, candidateListener]); } catch { /* Stop owns cleanup. */ }
        return;
      }
      Reflect.apply(dependencies.documentDispatchEvent, dependencies.document, [replayEvent]);
      if (!active || generation !== ownedGeneration || startup !== transaction) {
        try { Reflect.apply(dependencies.documentRemoveEventListener, dependencies.document,
          [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, candidateListener]); } catch { /* Stop owns cleanup. */ }
        return;
      }
      startup = null;
    } catch {
      const stopped = !active || generation !== ownedGeneration || startup !== transaction;
      active = false;
      generation += 1;
      listener = null;
      startup = null;
      snapshot = null;
      try { Reflect.apply(dependencies.documentRemoveEventListener, dependencies.document,
        [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, candidateListener]); } catch { /* Startup rollback. */ }
      if (stopped) return;
      throw new Error('Unable to start X About Account request metadata bridge');
    }
  }

  function stop() {
    if (!active && listener === null && startup === null) return;
    active = false;
    generation += 1;
    snapshot = null;
    rejected = null;
    for (const resolve of refreshWaiters) resolve();
    refreshWaiters.clear();
    refreshWaiters = new Set();
    const ownedListener = listener;
    listener = null;
    startup = null;
    if (ownedListener) {
      try { Reflect.apply(dependencies.documentRemoveEventListener, dependencies.document,
        [X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, ownedListener]); }
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
      variables.screenName = identity.handle;
      const parameters = new dependencies.URLSearchParams();
      parameters.set('variables', JSON.stringify(variables));
      const headers = Object.create(null);
      for (const key of Object.keys(snapshot.headers)) headers[key] = snapshot.headers[key];
      deeplyFreezeMetadata(headers);
      return Object.freeze({
        url: `${snapshot.origin}/i/api/graphql/${snapshot.queryId}/${X_ABOUT_ACCOUNT_OPERATION_NAME}?${parameters}`,
        headers,
      });
    } catch {
      throw new TypeError('Invalid X About Account request metadata request');
    }
  }

  Object.defineProperty(createRequest, 'invalidateSnapshot', {
    value: (kind) => {
      if (snapshot === null) return;
      rejected = kind === 'query'
        ? { kind, queryId: snapshot.queryId }
        : { kind: 'authentication', headers: JSON.stringify(snapshot.headers) };
      snapshot = null;
    }, enumerable: false, configurable: false, writable: false,
  });
  Object.defineProperty(createRequest, 'waitForFreshSnapshot', {
    value: (signal) => new Promise((resolve, reject) => {
      if (snapshot !== null) { resolve(); return; }
      let settled = false;
      const finish = () => {
        if (settled) return; settled = true; refreshWaiters.delete(finish);
        try { signal?.removeEventListener('abort', cancel); } catch { /* best effort */ }
        resolve();
      };
      const cancel = () => {
        if (settled) return; settled = true; refreshWaiters.delete(finish);
        const error = new Error('The operation was aborted'); error.name = 'AbortError'; reject(error);
      };
      refreshWaiters.add(finish);
      try { signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel(); }
      catch { cancel(); }
    }), enumerable: false, configurable: false, writable: false,
  });

  return Object.freeze({ start, stop, createRequest, hasSnapshot: () => snapshot !== null, isActive: () => active });
}
