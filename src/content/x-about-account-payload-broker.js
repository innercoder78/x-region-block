import { createAccountIdentity } from '../shared/account-identity.js';
import { ACCOUNT_TARGET_PROCESSOR_VERSION } from './account-target-processor.js';

export const X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION = 1;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const REQUEST_ERROR = 'Invalid X About Account payload broker request';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null || prototype === Object.prototype) return true;
    return Object.getPrototypeOf(prototype) === null
      && hasOwn(prototype, 'constructor')
      && Function.prototype.toString.call(prototype.constructor)
        === Function.prototype.toString.call(Object);
  } catch {
    return false;
  }
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  try {
    const ownKeys = Reflect.ownKeys(value);
    return ownKeys.length === keys.length && keys.every((key) => hasOwn(value, key));
  } catch {
    return false;
  }
}

function abortError() {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function validateRequest(identity, context) {
  const identityKeys = [
    'handle', 'displayHandle', 'profileUrl', 'accountId', 'allowlistKey', 'source',
  ];
  const contextKeys = ['version', 'signal'];
  try {
    if (!hasExactKeys(identity, identityKeys) || !hasExactKeys(context, contextKeys)) return null;
    const canonical = createAccountIdentity({
      handle: identity.handle,
      accountId: identity.accountId,
      source: identity.source,
    });
    if (canonical.source === null
      || identityKeys.some((key) => identity[key] !== canonical[key])
      || context.version !== ACCOUNT_TARGET_PROCESSOR_VERSION) return null;
    const signal = context.signal;
    if (signal === null || typeof signal !== 'object'
      || typeof signal.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function'
      || typeof signal.removeEventListener !== 'function') return null;
    return {
      handle: canonical.handle,
      accountId: canonical.accountId,
      signal,
      aborted: signal.aborted,
    };
  } catch {
    return null;
  }
}

export function createXAboutAccountPayloadBroker(options) {
  let optionsPrototype;
  try { optionsPrototype = Object.getPrototypeOf(options); } catch { optionsPrototype = undefined; }
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || (optionsPrototype !== null && optionsPrototype !== Object.prototype)) {
    throw new TypeError('X About Account payload broker options must be a plain object');
  }
  if (!hasOwn(options, 'loadPayload') || typeof options.loadPayload !== 'function') {
    throw new TypeError('loadPayload must be a function');
  }
  if (!hasOwn(options, 'abortControllerFactory')
    || typeof options.abortControllerFactory !== 'function') {
    throw new TypeError('abortControllerFactory must be a function');
  }
  if (!hasOwn(options, 'onError') || typeof options.onError !== 'function') {
    throw new TypeError('onError must be a function');
  }
  const loadPayload = options.loadPayload;
  const abortControllerFactory = options.abortControllerFactory;
  const onError = options.onError;
  let active = false;
  let generation = 0;
  let entries = new Map();

  function report(error) {
    try { onError(error); } catch { /* The error boundary must not disrupt cleanup. */ }
  }

  function start() {
    if (!active) {
      active = true;
      generation += 1;
      entries = new Map();
    }
    return controller;
  }

  function retireEntry(entry) {
    if (entry.key !== null && entries.get(entry.key) === entry) entries.delete(entry.key);
    entry.live = false;
    const consumers = [...entry.consumers];
    entry.consumers.clear();
    const abortShared = entry.abort;
    entry.key = null;
    entry.generation = null;
    entry.controller = null;
    entry.abort = null;
    entry.promise = null;
    entry.identity = null;
    return { consumers, abortShared };
  }

  function stop() {
    if (!active) return controller;
    active = false;
    generation += 1;
    const retired = entries;
    entries = new Map();
    const cleanup = [];
    for (const entry of retired.values()) {
      cleanup.push(retireEntry(entry));
    }
    retired.clear();
    let failed = false;
    for (const { consumers, abortShared } of cleanup) {
      for (const consumer of consumers) {
        consumer.active = false;
        try { consumer.signal.removeEventListener('abort', consumer.listener); } catch { failed = true; }
        consumer.signal = null;
        consumer.listener = null;
        consumer.reject(abortError());
        consumer.resolve = null;
        consumer.reject = null;
      }
      try { abortShared(); } catch { failed = true; }
    }
    cleanup.length = 0;
    if (failed) report(new Error('Unable to stop X About Account payload broker'));
    return controller;
  }

  function settle(entry, completingPromise, succeeded, value) {
    if (!active || entry.generation !== generation || !entry.live
      || entries.get(entry.key) !== entry || entry.promise !== completingPromise) return;
    const { consumers } = retireEntry(entry);
    let failed = false;
    for (const consumer of consumers) {
      if (!consumer.active) continue;
      consumer.active = false;
      try { consumer.signal.removeEventListener('abort', consumer.listener); } catch { failed = true; }
      consumer.signal = null;
      consumer.listener = null;
      const deliver = succeeded ? consumer.resolve : consumer.reject;
      consumer.resolve = null;
      consumer.reject = null;
      deliver(value);
    }
    if (failed) report(new Error('Unable to clean up X About Account payload broker'));
  }

  function addConsumer(entry, signal) {
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const consumer = {
      active: true, signal, listener: null, resolve: resolvePromise, reject: rejectPromise,
    };
    function cancelConsumer() {
      if (!consumer.active) return;
      consumer.active = false;
      entry.consumers.delete(consumer);
      try { signal.removeEventListener('abort', consumer.listener); } catch {
        // Cancellation is expected control flow and never reaches the error boundary.
      }
      consumer.signal = null;
      consumer.listener = null;
      const reject = consumer.reject;
      consumer.resolve = null;
      consumer.reject = null;
      reject(abortError());
      if (entry.live && entry.consumers.size === 0) {
        const { abortShared } = retireEntry(entry);
        try { abortShared(); } catch {
          report(new Error('Unable to cancel shared About Account lookup'));
        }
      }
    }
    consumer.listener = cancelConsumer;
    entry.consumers.add(consumer);
    try {
      signal.addEventListener('abort', consumer.listener, { once: true });
      if (consumer.active && signal.aborted) cancelConsumer();
    } catch (error) {
      if (consumer.active) {
        consumer.active = false;
        entry.consumers.delete(consumer);
        try { signal.removeEventListener('abort', consumer.listener); } catch {
          // Registration failure cleanup is best-effort and exposes no signal details.
        }
        consumer.signal = null;
        consumer.listener = null;
        consumer.resolve = null;
        consumer.reject = null;
        rejectPromise(error);
        if (entry.live && entry.consumers.size === 0) {
          const { abortShared } = retireEntry(entry);
          try { abortShared(); } catch {
            report(new Error('Unable to cancel shared About Account lookup'));
          }
        }
      }
    }
    return promise;
  }

  function loadAboutAccountPayload(identity, context) {
    if (!active) throw new TypeError('X About Account payload broker is not active');
    const request = validateRequest(identity, context);
    if (request === null) throw new TypeError(REQUEST_ERROR);
    if (request.aborted) return Promise.reject(abortError());
    const key = JSON.stringify([request.handle, request.accountId]);
    const existing = entries.get(key);
    if (existing) return addConsumer(existing, request.signal);

    let sharedController;
    try {
      sharedController = abortControllerFactory();
    } catch (error) {
      return Promise.reject(error);
    }
    let sharedSignal;
    let sharedAbort;
    try {
      if (sharedController === null || typeof sharedController !== 'object'
        || Array.isArray(sharedController)) throw new TypeError();
      // Native browser members are inherited. Read each possibly hostile getter only once,
      // then use cross-realm structural validation rather than instanceof.
      sharedSignal = sharedController.signal;
      sharedAbort = sharedController.abort;
      if (sharedSignal === null || typeof sharedSignal !== 'object'
        || typeof sharedSignal.aborted !== 'boolean'
        || typeof sharedSignal.addEventListener !== 'function'
        || typeof sharedSignal.removeEventListener !== 'function'
        || typeof sharedAbort !== 'function') throw new TypeError();
    } catch {
      return Promise.reject(
        new TypeError('abortControllerFactory returned an invalid controller'),
      );
    }
    const entry = {
      key,
      generation,
      live: true,
      controller: sharedController,
      abort: () => sharedAbort.call(sharedController),
      promise: null,
      identity: createAccountIdentity({
        handle: request.handle, accountId: request.accountId, source: null,
      }),
      consumers: new Set(),
    };
    entries.set(key, entry);
    const consumerPromise = addConsumer(entry, request.signal);
    if (!entry.live || entry.consumers.size === 0) return consumerPromise;
    const underlyingContext = Object.freeze({
      version: X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION,
      signal: sharedSignal,
    });
    let result;
    try { result = loadPayload(entry.identity, underlyingContext); } catch (error) {
      result = Promise.reject(error);
    }
    const pending = Promise.resolve(result);
    entry.promise = pending;
    pending.then(
      (payload) => settle(entry, pending, true, payload),
      (error) => settle(entry, pending, false, error),
    );
    return consumerPromise;
  }

  function getInFlightCount() { return active ? entries.size : 0; }
  function isActive() { return active; }

  const controller = Object.freeze({
    start,
    stop,
    loadAboutAccountPayload,
    getInFlightCount,
    isActive,
  });
  return controller;
}
