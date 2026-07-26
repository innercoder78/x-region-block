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
  let candidates = null;
  let reconciling = false;
  let pendingUrl = null;
  let cleanupContext = null;
  let deferredStop = null;

  const report = (error) => { try { dependencies.onError(error); } catch { /* silent boundary */ } };
  const current = (lifecycle) => active && generation === lifecycle;
  const getTargets = () => {
    if (!active || records === null) return EMPTY;
    const targets = records.flatMap((record) => record.session.getTargets());
    return targets.length === 0 ? EMPTY : Object.freeze(targets);
  };
  const plannerOptions = () => (dependencies.hasBaseUrl ? { baseUrl: dependencies.baseUrl } : {});

  const createRecord = (plan, lifecycle, expectedBroker) => {
    let session = null;
    const sessionOptions = Object.assign(Object.create(null), {
      source: plan.source,
      settingsRuntime: dependencies.settingsRuntime,
      observerFactory: dependencies.observerFactory,
      loadAboutAccountPayload: expectedBroker.loadAboutAccountPayload,
      abortControllerFactory: dependencies.consumerAbortControllerFactory,
      onError: (error) => {
        if (cleanupContext !== null && cleanupContext.records.has(record)) cleanupContext.failed = true;
        else if (record.state === 'starting') record.pendingErrors.push(error);
        else if (current(lifecycle) && broker === expectedBroker
          && (record.state === 'candidate' || record.state === 'committed')) report(error);
      },
    });
    if (hasOwn(plan, 'baseUrl')) sessionOptions.baseUrl = plan.baseUrl;
    const record = { plan, session: null, state: 'candidate', pendingErrors: [] };
    session = createXAccountTargetSession(plan.root, sessionOptions);
    record.session = session;
    candidates.add(record);
    return record;
  };

  const cleanRecords = (cleanupRecords) => {
    const owned = cleanupRecords.filter((record) => !['retired', 'final-stop'].includes(record.state));
    const context = { records: new Set(owned), failed: false };
    cleanupContext = context;
    for (let index = owned.length - 1; index >= 0; index -= 1) {
      const record = owned[index];
      if (record.state === 'retired') continue;
      record.state = 'retiring';
      try { record.session.stop(); } catch { context.failed = true; }
      record.state = 'retired';
      record.pendingErrors.length = 0;
      candidates?.delete(record);
    }
    cleanupContext = null;
    context.records.clear();
    return context.failed;
  };

  const applyUrl = (url, lifecycle, startup = false) => {
    const nextRoute = classifyXRoute(url);
    const nextPlans = createXAccountTargetSessionPlans(root, nextRoute, plannerOptions());
    const previous = records ?? [];
    const unused = new Set(previous);
    const desired = [];
    const added = [];
    try {
      for (const plan of nextPlans) {
        const reusable = previous.find((record) => unused.has(record) && samePlan(record.plan, plan));
        if (reusable !== undefined) {
          unused.delete(reusable);
          desired.push(reusable);
        } else {
          const candidate = createRecord(plan, lifecycle, broker);
          added.push(candidate);
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
            const pendingErrors = candidate.pendingErrors.splice(0);
            for (const error of pendingErrors) {
              if (current(lifecycle)) report(error);
            }
          } else {
            candidate.pendingErrors.length = 0;
          }
        }
      }
    } catch (error) {
      cleanRecords(added);
      if (startup) throw error;
      report(new Error('Unable to reconcile X account target route'));
      return false;
    }
    if (!current(lifecycle)) {
      cleanRecords(added);
      return false;
    }
    for (let index = 0; index < desired.length; index += 1) {
      const record = desired[index];
      record.plan = nextPlans[index];
      record.state = 'committed';
      candidates.delete(record);
    }
    route = nextRoute;
    plans = nextPlans;
    records = desired;
    const obsolete = previous.filter((record) => unused.has(record));
    const failed = cleanRecords(obsolete);
    if (failed && !startup) report(new Error('Unable to reconcile X account target route'));
    return true;
  };

  const processUrl = (url, lifecycle, startup = false) => {
    if (reconciling) { pendingUrl = url; return; }
    reconciling = true;
    let next = url;
    try {
      while (current(lifecycle) && next !== null) {
        pendingUrl = null;
        if (startup) applyUrl(next, lifecycle, true);
        else {
          try { applyUrl(next, lifecycle); } catch { report(new Error('Unable to reconcile X account target route')); }
        }
        next = pendingUrl;
        startup = false;
      }
    } finally {
      pendingUrl = null;
      reconciling = false;
      if (deferredStop !== null) {
        const cleanup = deferredStop;
        deferredStop = null;
        cleanup.finish();
      }
    }
  };

  const start = () => {
    if (active) return getTargets();
    const lifecycle = generation + 1;
    let createdBroker = null;
    let createdNavigation = null;
    let createdNavigationMethods = null;
    active = true; generation = lifecycle; records = []; candidates = new Set();
    try {
      createdBroker = createXAboutAccountPayloadBroker({
        loadPayload: dependencies.loadPayload,
        abortControllerFactory: dependencies.brokerAbortControllerFactory,
        onError: (error) => {
          if (cleanupContext !== null) cleanupContext.failed = true;
          else if (current(lifecycle) && broker === createdBroker) report(error);
        },
      });
      broker = createdBroker;
      createdBroker.start();
      const observerOptions = Object.freeze({
        version: ACCOUNT_TARGET_ROUTE_SESSION_CONTROLLER_VERSION,
        onNavigate: (url) => { if (current(lifecycle)) processUrl(url, lifecycle); },
        onError: (error) => {
          if (cleanupContext !== null) cleanupContext.failed = true;
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
      const createdRecords = [...(records ?? []), ...(candidates ?? [])];
      broker = null; navigationObserver = null; navigationMethods = null;
      route = null; plans = EMPTY; records = null;
      candidates = null;
      pendingUrl = null; reconciling = false;
      const context = { records: new Set(createdRecords), failed: false };
      cleanupContext = context;
      for (let index = createdRecords.length - 1; index >= 0; index -= 1) {
        const record = createdRecords[index];
        if (record.state === 'retired') continue;
        record.state = 'retiring';
        try { record.session.stop(); } catch { /* preserve */ }
        record.state = 'retired';
        record.pendingErrors.length = 0;
      }
      if (createdNavigationMethods !== null) {
        try { Reflect.apply(createdNavigationMethods.stop, createdNavigation, []); } catch { /* preserve */ }
      }
      if (createdBroker !== null) { try { createdBroker.stop(); } catch { /* preserve */ } }
      cleanupContext = null;
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
    const oldCandidates = [...candidates];
    active = false; generation += 1;
    navigationObserver = null; navigationMethods = null;
    broker = null; route = null; plans = EMPTY; records = null;
    candidates = null;
    pendingUrl = null;
    const cleanupRecords = [...oldRecords, ...oldCandidates]
      .filter((record, index, all) => all.indexOf(record) === index && record.state !== 'retired');
    for (const record of cleanupRecords) record.state = 'final-stop';
    const context = { records: new Set(cleanupRecords), failed: false };
    cleanupContext = context;
    try { Reflect.apply(oldNavigationMethods.stop, oldNavigation, []); } catch { context.failed = true; }
    cleanupContext = null;
    const finish = () => {
      cleanupContext = context;
      for (let index = cleanupRecords.length - 1; index >= 0; index -= 1) {
        const record = cleanupRecords[index];
        if (record.state === 'retired') continue;
        record.state = 'retiring';
        try { record.session.stop(); } catch { context.failed = true; }
        record.state = 'retired';
        record.pendingErrors.length = 0;
      }
      try { oldBroker.stop(); } catch { context.failed = true; }
      cleanupContext = null;
      context.records.clear();
      if (context.failed) report(new Error('Unable to stop X account target route session controller'));
    };
    if (wasReconciling) deferredStop = { finish };
    else finish();
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
