import { classifyXRoute } from './x-route-classifier.js';
import { createXAccountTargetSessionPlans } from './account-target-route-planner.js';
import { createXAboutAccountPayloadBroker } from './x-about-account-payload-broker.js';
import { createXAccountTargetSession } from './account-target-session.js';

export const ACCOUNT_TARGET_ROUTE_SESSION_CONTROLLER_VERSION = 1;
const EMPTY = Object.freeze([]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const OPTION_KEYS = new Set([
  'settingsRuntime', 'observerFactory', 'loadPayload', 'brokerAbortControllerFactory',
  'consumerAbortControllerFactory', 'navigationObserverFactory', 'onError', 'baseUrl',
]);

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try { return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null; } catch { return false; }
}

function normalizeOptions(options) {
  if (!plain(options)) throw new TypeError('account target route session options must be a plain object');
  let keys;
  try { keys = Reflect.ownKeys(options); } catch { throw new TypeError('Invalid account target route session options'); }
  if (keys.includes('accountId')) {
    throw new TypeError('accountId is not supported by account target route sessions');
  }
  if (keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.has(key))) {
    throw new TypeError('Invalid account target route session options');
  }
  const values = {};
  const hasBaseUrl = keys.includes('baseUrl');
  try {
    for (const key of keys) values[key] = options[key];
  } catch { throw new TypeError('Invalid account target route session options'); }
  const settingsRuntime = keys.includes('settingsRuntime') ? values.settingsRuntime : null;
  if (settingsRuntime === null || typeof settingsRuntime !== 'object'
    || typeof settingsRuntime.getSettings !== 'function' || typeof settingsRuntime.subscribe !== 'function') {
    throw new TypeError('settingsRuntime must provide getSettings and subscribe');
  }
  for (const [key, message] of [
    ['observerFactory', 'observerFactory must be a function'],
    ['loadPayload', 'loadPayload must be a function'],
    ['brokerAbortControllerFactory', 'brokerAbortControllerFactory must be a function'],
    ['consumerAbortControllerFactory', 'consumerAbortControllerFactory must be a function'],
    ['navigationObserverFactory', 'navigationObserverFactory must be a function'],
    ['onError', 'onError must be a function'],
  ]) if (!keys.includes(key) || typeof values[key] !== 'function') throw new TypeError(message);
  const normalized = {
    settingsRuntime, observerFactory: values.observerFactory, loadPayload: values.loadPayload,
    brokerAbortControllerFactory: values.brokerAbortControllerFactory,
    consumerAbortControllerFactory: values.consumerAbortControllerFactory,
    navigationObserverFactory: values.navigationObserverFactory, onError: values.onError,
    hasBaseUrl,
  };
  if (hasBaseUrl) normalized.baseUrl = values.baseUrl;
  return normalized;
}

function samePlan(left, right) {
  const leftBase = hasOwn(left, 'baseUrl');
  const rightBase = hasOwn(right, 'baseUrl');
  return left.root === right.root && left.source === right.source && leftBase === rightBase
    && (!leftBase || Object.is(left.baseUrl, right.baseUrl));
}

export function createXAccountTargetRouteSessionController(root, options) {
  let validRoot = false;
  try {
    validRoot = root !== null && typeof root === 'object' && !Array.isArray(root)
      && typeof root.querySelectorAll === 'function';
  } catch { /* standard root error */ }
  if (!validRoot) throw new TypeError('Invalid account target route session root');
  const dependencies = normalizeOptions(options);
  let active = false;
  let generation = 0;
  let broker = null;
  let navigationObserver = null;
  let navigationMethods = null;
  let route = null;
  let plans = EMPTY;
  let records = null;
  let reconciling = false;
  let pendingUrl = null;
  let transaction = null;
  let finalStop = null;

  const report = (error) => { try { dependencies.onError(error); } catch { /* silent boundary */ } };
  const current = (lifecycle) => active && generation === lifecycle;
  const getTargets = () => {
    if (!active || records === null) return EMPTY;
    const targets = records.flatMap((record) => record.session.getTargets());
    return targets.length === 0 ? EMPTY : Object.freeze(targets);
  };
  const plannerOptions = () => (dependencies.hasBaseUrl ? { baseUrl: dependencies.baseUrl } : {});

  const transactionCurrent = (candidate) => current(candidate.lifecycle)
    && transaction === candidate && !candidate.claimed && broker === candidate.broker;

  const createRecord = (plan, candidateTransaction) => {
    let session = null;
    const record = {
      plan, session: null, state: 'constructing', pendingErrors: [], cleanup: null,
    };
    candidateTransaction.owned.add(record);
    candidateTransaction.added.push(record);
    const sessionOptions = Object.assign(Object.create(null), {
      source: plan.source,
      settingsRuntime: dependencies.settingsRuntime,
      observerFactory: dependencies.observerFactory,
      loadAboutAccountPayload: candidateTransaction.broker.loadAboutAccountPayload,
      abortControllerFactory: dependencies.consumerAbortControllerFactory,
      onError: (error) => {
        if (record.cleanup !== null) record.cleanup.failed = true;
        else if (record.state === 'starting' || record.state === 'candidate') {
          record.pendingErrors.push(error);
        } else if (current(candidateTransaction.lifecycle)
          && broker === candidateTransaction.broker
          && record.state === 'committed' && records?.includes(record)) report(error);
      },
    });
    if (hasOwn(plan, 'baseUrl')) sessionOptions.baseUrl = plan.baseUrl;
    session = createXAccountTargetSession(plan.root, sessionOptions);
    record.session = session;
    if (record.state === 'constructing') record.state = 'candidate';
    return record;
  };

  const cleanRecords = (cleanupRecords) => {
    const owned = cleanupRecords.filter((record) => record.state !== 'retired');
    const context = { failed: false };
    for (let index = owned.length - 1; index >= 0; index -= 1) {
      const record = owned[index];
      if (record.state === 'retired' || record.state === 'final-stop') continue;
      if (record.state === 'retiring') continue;
      record.state = 'retiring';
      record.cleanup = context;
      if (record.session !== null) {
        try { record.session.stop(); } catch { context.failed = true; }
      }
      record.cleanup = null;
      record.state = 'retired';
      record.pendingErrors.length = 0;
    }
    if (finalStop !== null) finalStop.failed ||= context.failed;
    return context.failed;
  };

  const applyUrl = (url, lifecycle, startup = false) => {
    const transactionBroker = broker;
    const nextRoute = classifyXRoute(url);
    const nextPlans = createXAccountTargetSessionPlans(root, nextRoute, plannerOptions());
    const previous = records ?? [];
    const candidateTransaction = {
      lifecycle,
      broker: transactionBroker,
      claimed: false,
      added: [],
      owned: new Set(previous),
    };
    transaction = candidateTransaction;
    const unused = new Set(previous);
    const desired = [];
    try {
      for (const plan of nextPlans) {
        if (!transactionCurrent(candidateTransaction)) return false;
        const reusable = previous.find((record) => unused.has(record) && samePlan(record.plan, plan));
        if (reusable !== undefined) {
          unused.delete(reusable);
          desired.push(reusable);
        } else {
          const candidate = createRecord(plan, candidateTransaction);
          if (!transactionCurrent(candidateTransaction)) return false;
          desired.push(candidate);
          candidate.state = 'starting';
          try {
            candidate.session.start();
          } catch (error) {
            candidate.pendingErrors.length = 0;
            if (candidate.state === 'starting') candidate.state = 'candidate';
            throw error;
          }
          if (candidate.state === 'starting') {
            candidate.state = 'candidate';
          } else {
            candidate.pendingErrors.length = 0;
          }
          if (!transactionCurrent(candidateTransaction)) return false;
        }
      }
    } catch (error) {
      if (candidateTransaction.claimed || !current(lifecycle)) return false;
      cleanRecords(candidateTransaction.added);
      if (!transactionCurrent(candidateTransaction)) return false;
      if (startup) throw error;
      report(new Error('Unable to reconcile X account target route'));
      return false;
    }
    if (!transactionCurrent(candidateTransaction)) return false;
    for (let index = 0; index < desired.length; index += 1) {
      const record = desired[index];
      record.plan = nextPlans[index];
      record.state = 'committed';
    }
    route = nextRoute;
    plans = nextPlans;
    records = desired;
    const obsolete = previous.filter((record) => unused.has(record));
    const failed = cleanRecords(obsolete);
    if (failed && !startup && transactionCurrent(candidateTransaction)) {
      report(new Error('Unable to reconcile X account target route'));
    }
    const mayForwardCandidateErrors = !failed && pendingUrl === null
      && transactionCurrent(candidateTransaction);
    for (const record of candidateTransaction.added) {
      const buffered = record.pendingErrors.splice(0);
      if (!mayForwardCandidateErrors || record.state !== 'committed'
        || !records.includes(record)) continue;
      for (const error of buffered) {
        if (!current(lifecycle) || record.state !== 'committed'
          || broker !== transactionBroker || !records.includes(record)) break;
        report(error);
      }
    }
    return true;
  };

  const releaseTransaction = () => {
    if (transaction !== null && !transaction.claimed) {
      transaction.added.length = 0;
      transaction.owned.clear();
    }
    transaction = null;
  };

  const processUrl = (url, lifecycle, startup = false) => {
    if (reconciling) { pendingUrl = url; return; }
    reconciling = true;
    let next = url;
    try {
      while (current(lifecycle) && next !== null) {
        pendingUrl = null;
        try {
          if (startup) applyUrl(next, lifecycle, true);
          else {
            try { applyUrl(next, lifecycle); } catch {
              if (current(lifecycle)) report(new Error('Unable to reconcile X account target route'));
            }
          }
        } finally {
          releaseTransaction();
        }
        next = pendingUrl;
        startup = false;
      }
    } finally {
      pendingUrl = null;
      reconciling = false;
      if (finalStop !== null && !finalStop.finished) {
        finalStop.finish();
      }
    }
  };

  const start = () => {
    if (active) return getTargets();
    const lifecycle = generation + 1;
    let createdBroker = null;
    let createdNavigation = null;
    let createdNavigationMethods = null;
    active = true; generation = lifecycle; records = [];
    try {
      createdBroker = createXAboutAccountPayloadBroker({
        loadPayload: dependencies.loadPayload,
        abortControllerFactory: dependencies.brokerAbortControllerFactory,
        onError: (error) => {
          if (finalStop !== null && finalStop.broker === createdBroker) finalStop.failed = true;
          else if (current(lifecycle) && broker === createdBroker) report(error);
        },
      });
      broker = createdBroker;
      createdBroker.start();
      const observerOptions = Object.freeze({
        version: ACCOUNT_TARGET_ROUTE_SESSION_CONTROLLER_VERSION,
        onNavigate: (url) => { if (current(lifecycle)) processUrl(url, lifecycle); },
        onError: (error) => {
          if (finalStop !== null && finalStop.navigation === createdNavigation) {
            finalStop.failed = true;
          }
          else if (current(lifecycle)) report(error);
        },
      });
      createdNavigation = dependencies.navigationObserverFactory(observerOptions);
      try {
        if (createdNavigation === null || typeof createdNavigation !== 'object') throw new Error();
        const methodKeys = ['start', 'stop', 'getCurrentUrl', 'isActive'];
        if (methodKeys.some((key) => !hasOwn(createdNavigation, key))) throw new Error();
        createdNavigationMethods = Object.fromEntries(
          methodKeys.map((key) => [key, createdNavigation[key]]),
        );
        if (methodKeys.some((key) => typeof createdNavigationMethods[key] !== 'function')) {
          throw new Error();
        }
      } catch {
        throw new TypeError('navigationObserverFactory returned an invalid observer');
      }
      navigationObserver = createdNavigation;
      navigationMethods = createdNavigationMethods;
      const initialUrl = Reflect.apply(createdNavigationMethods.start, createdNavigation, []);
      processUrl(initialUrl, lifecycle, true);
      return getTargets();
    } catch (error) {
      active = false; generation += 1;
      const createdRecords = records ?? [];
      broker = null; navigationObserver = null; navigationMethods = null;
      route = null; plans = EMPTY; records = null;
      pendingUrl = null; reconciling = false;
      cleanRecords(createdRecords);
      if (createdNavigationMethods !== null) {
        try { Reflect.apply(createdNavigationMethods.stop, createdNavigation, []); } catch { /* preserve */ }
      }
      if (createdBroker !== null) { try { createdBroker.stop(); } catch { /* preserve */ } }
      throw error;
    }
  };

  const stop = () => {
    if (!active) return;
    const wasReconciling = reconciling;
    const oldNavigation = navigationObserver;
    const oldNavigationMethods = navigationMethods;
    const oldBroker = broker;
    const oldRecords = records;
    const claimedTransaction = transaction;
    if (claimedTransaction !== null) claimedTransaction.claimed = true;
    const cleanupRecords = [...oldRecords];
    if (claimedTransaction !== null) {
      for (const record of claimedTransaction.owned) {
        if (!cleanupRecords.includes(record)) cleanupRecords.push(record);
      }
    }
    active = false; generation += 1;
    navigationObserver = null; navigationMethods = null;
    broker = null; route = null; plans = EMPTY; records = null;
    pendingUrl = null;
    const context = {
      broker: oldBroker,
      navigation: oldNavigation,
      failed: false,
      finished: false,
      finish: null,
    };
    finalStop = context;
    for (const record of cleanupRecords) {
      if (!['retiring', 'retired'].includes(record.state)) record.state = 'final-stop';
      record.pendingErrors.length = 0;
    }
    try { Reflect.apply(oldNavigationMethods.stop, oldNavigation, []); } catch { context.failed = true; }
    context.finish = () => {
      if (context.finished) return;
      context.finished = true;
      for (let index = cleanupRecords.length - 1; index >= 0; index -= 1) {
        const record = cleanupRecords[index];
        if (record.state === 'retired' || record.state === 'retiring') continue;
        record.state = 'retiring';
        record.cleanup = context;
        if (record.session !== null) {
          try { record.session.stop(); } catch { context.failed = true; }
        }
        record.cleanup = null;
        record.state = 'retired';
        record.pendingErrors.length = 0;
      }
      try { oldBroker.stop(); } catch { context.failed = true; }
      if (claimedTransaction !== null) {
        claimedTransaction.added.length = 0;
        claimedTransaction.owned.clear();
      }
      cleanupRecords.length = 0;
      finalStop = null;
      if (context.failed) report(new Error('Unable to stop X account target route session controller'));
    };
    if (!wasReconciling) context.finish();
  };
  const reconcile = () => {
    if (!active) throw new TypeError('account target route session controller is not active');
    const lifecycle = generation;
    try {
      const url = Reflect.apply(navigationMethods.getCurrentUrl, navigationObserver, []);
      processUrl(url, lifecycle);
    } catch { report(new Error('Unable to reconcile X account target route')); }
    return getTargets();
  };
  const rescan = () => {
    if (!active) throw new TypeError('account target route session controller is not active');
    let failed = false;
    for (const { session } of records) { try { session.rescan(); } catch { failed = true; } }
    if (failed) report(new Error('Unable to rescan X account target route sessions'));
    return getTargets();
  };
  const getRoute = () => route;
  const getPlans = () => plans;
  const getInFlightCount = () => (active ? broker.getInFlightCount() : 0);
  const isActive = () => active;
  return Object.freeze({
    start, stop, reconcile, rescan, getRoute, getPlans, getTargets, getInFlightCount, isActive,
  });
}
