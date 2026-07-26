import { ACCOUNT_IDENTITY_SOURCES } from '../shared/account-identity.js';
import { createXAccountTargetSession } from './account-target-session.js';
import { createXAboutAccountPayloadBroker } from './x-about-account-payload-broker.js';

export const ACCOUNT_TARGET_SESSION_GROUP_VERSION = 1;

const EMPTY = Object.freeze([]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function normalizePlans(plans) {
  if (!Array.isArray(plans) || plans.length === 0) {
    throw new TypeError('account target session group plans must be a non-empty array');
  }
  const normalized = [];
  const rootsBySource = new Map();
  for (const plan of plans) {
    let keys;
    try { keys = Reflect.ownKeys(plan); } catch { keys = []; }
    const validKeys = isPlainObject(plan)
      && (keys.length === 2 || keys.length === 3)
      && keys.every((key) => key === 'root' || key === 'source' || key === 'baseUrl')
      && hasOwn(plan, 'root') && hasOwn(plan, 'source')
      && (keys.length === 2 || hasOwn(plan, 'baseUrl'));
    if (!validKeys) throw new TypeError('Invalid account target session group plan');

    let root;
    let source;
    try {
      root = plan.root;
      source = typeof plan.source === 'string' ? plan.source.trim().toLowerCase() : null;
    } catch {
      throw new TypeError('Invalid account target session group plan');
    }
    let validRoot = false;
    try {
      validRoot = root !== null && typeof root === 'object' && !Array.isArray(root)
        && typeof root.querySelectorAll === 'function';
    } catch { /* Invalid facade roots use the standard plan error. */ }
    if (!validRoot || !ACCOUNT_IDENTITY_SOURCES.includes(source)) {
      throw new TypeError('Invalid account target session group plan');
    }
    let roots = rootsBySource.get(source);
    if (roots === undefined) {
      roots = new Set();
      rootsBySource.set(source, roots);
    }
    if (roots.has(root)) {
      throw new TypeError('Duplicate account target session group plan');
    }
    roots.add(root);
    const canonical = { root, source, hasBaseUrl: hasOwn(plan, 'baseUrl') };
    if (canonical.hasBaseUrl) {
      try { canonical.baseUrl = plan.baseUrl; } catch {
        throw new TypeError('Invalid account target session group plan');
      }
    }
    normalized.push(Object.freeze(canonical));
  }
  return Object.freeze(normalized);
}

function normalizeOptions(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('account target session group options must be a plain object');
  }
  if (hasOwn(options, 'accountId')) {
    throw new TypeError('accountId is not supported by account target session groups');
  }
  const settingsRuntime = hasOwn(options, 'settingsRuntime') ? options.settingsRuntime : null;
  if (settingsRuntime === null || typeof settingsRuntime !== 'object'
    || typeof settingsRuntime.getSettings !== 'function'
    || typeof settingsRuntime.subscribe !== 'function') {
    throw new TypeError('settingsRuntime must provide getSettings and subscribe');
  }
  for (const [property, message] of [
    ['observerFactory', 'observerFactory must be a function'],
    ['loadPayload', 'loadPayload must be a function'],
    ['brokerAbortControllerFactory', 'brokerAbortControllerFactory must be a function'],
    ['consumerAbortControllerFactory', 'consumerAbortControllerFactory must be a function'],
    ['onError', 'onError must be a function'],
  ]) {
    if (!hasOwn(options, property) || typeof options[property] !== 'function') {
      throw new TypeError(message);
    }
  }
  return Object.freeze({
    settingsRuntime,
    observerFactory: options.observerFactory,
    loadPayload: options.loadPayload,
    brokerAbortControllerFactory: options.brokerAbortControllerFactory,
    consumerAbortControllerFactory: options.consumerAbortControllerFactory,
    onError: options.onError,
  });
}

/** Composes explicit account-target sessions around one lifecycle-owned payload broker. */
export function createXAccountTargetSessionGroup(plans, options) {
  const canonicalPlans = normalizePlans(plans);
  const dependencies = normalizeOptions(options);
  let active = false;
  let generation = 0;
  let broker = null;
  let sessions = null;
  let stopContext = null;

  const report = (error) => {
    try { dependencies.onError(error); } catch { /* The injected error boundary is silent. */ }
  };
  const current = (lifecycle, expectedBroker) => active
    && generation === lifecycle && broker === expectedBroker;

  const getTargets = () => {
    if (!active || sessions === null) return EMPTY;
    const targets = sessions.flatMap((session) => session.getTargets());
    return targets.length === 0 ? EMPTY : Object.freeze(targets);
  };

  const start = () => {
    if (active) return getTargets();
    const lifecycle = generation + 1;
    let createdBroker = null;
    const createdSessions = [];
    active = true;
    generation = lifecycle;
    try {
      createdBroker = createXAboutAccountPayloadBroker({
        loadPayload: dependencies.loadPayload,
        abortControllerFactory: dependencies.brokerAbortControllerFactory,
        onError: (error) => {
          if (stopContext !== null && stopContext.lifecycle === lifecycle
            && stopContext.broker === createdBroker) {
            stopContext.failed = true;
          } else if (current(lifecycle, createdBroker)) report(error);
        },
      });
      broker = createdBroker;
      sessions = createdSessions;
      createdBroker.start();
      for (const plan of canonicalPlans) {
        let createdSession = null;
        const sessionOptions = {
          source: plan.source,
          settingsRuntime: dependencies.settingsRuntime,
          observerFactory: dependencies.observerFactory,
          loadAboutAccountPayload: createdBroker.loadAboutAccountPayload,
          abortControllerFactory: dependencies.consumerAbortControllerFactory,
          onError: (error) => {
            if (stopContext !== null && stopContext.lifecycle === lifecycle
              && stopContext.broker === createdBroker
              && stopContext.sessionSet.has(createdSession)
              && stopContext.child === createdSession) {
              stopContext.failed = true;
            } else if (current(lifecycle, createdBroker)) report(error);
          },
        };
        if (plan.hasBaseUrl) sessionOptions.baseUrl = plan.baseUrl;
        createdSession = createXAccountTargetSession(plan.root, sessionOptions);
        createdSessions.push(createdSession);
        createdSession.start();
      }
      return getTargets();
    } catch (error) {
      active = false;
      generation += 1;
      broker = null;
      sessions = null;
      for (let index = createdSessions.length - 1; index >= 0; index -= 1) {
        try { createdSessions[index].stop(); } catch { /* Preserve the startup error. */ }
      }
      if (createdBroker !== null) {
        try { createdBroker.stop(); } catch { /* Preserve the startup error. */ }
      }
      createdSessions.length = 0;
      throw error;
    }
  };

  const stop = () => {
    if (!active) return;
    const currentBroker = broker;
    const currentSessions = sessions;
    active = false;
    generation += 1;
    broker = null;
    sessions = null;
    const cleanup = {
      lifecycle: generation - 1,
      broker: currentBroker,
      sessionSet: new Set(currentSessions),
      child: null,
      failed: false,
    };
    stopContext = cleanup;
    for (let index = currentSessions.length - 1; index >= 0; index -= 1) {
      cleanup.child = currentSessions[index];
      try { currentSessions[index].stop(); } catch { cleanup.failed = true; }
    }
    cleanup.child = currentBroker;
    try { currentBroker.stop(); } catch { cleanup.failed = true; }
    cleanup.child = null;
    stopContext = null;
    cleanup.sessionSet.clear();
    currentSessions.length = 0;
    if (cleanup.failed) report(new Error('Unable to stop account target session group'));
  };

  const rescan = () => {
    if (!active) throw new TypeError('account target session group is not active');
    let failed = false;
    for (const session of sessions) {
      try { session.rescan(); } catch { failed = true; }
    }
    if (failed) report(new Error('Unable to rescan account target sessions'));
    return getTargets();
  };
  const getInFlightCount = () => (active ? broker.getInFlightCount() : 0);
  const isActive = () => active;

  return Object.freeze({ start, stop, rescan, getTargets, getInFlightCount, isActive });
}
