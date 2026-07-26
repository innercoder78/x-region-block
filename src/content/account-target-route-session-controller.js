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
  if (hasOwn(options, 'accountId')) {
    throw new TypeError('accountId is not supported by account target route sessions');
  }
  let keys;
  try { keys = Reflect.ownKeys(options); } catch { throw new TypeError('Invalid account target route session options'); }
  if (keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.has(key))) {
    throw new TypeError('Invalid account target route session options');
  }
  const settingsRuntime = hasOwn(options, 'settingsRuntime') ? options.settingsRuntime : null;
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
  ]) if (!hasOwn(options, key) || typeof options[key] !== 'function') throw new TypeError(message);
  return {
    settingsRuntime, observerFactory: options.observerFactory, loadPayload: options.loadPayload,
    brokerAbortControllerFactory: options.brokerAbortControllerFactory,
    consumerAbortControllerFactory: options.consumerAbortControllerFactory,
    navigationObserverFactory: options.navigationObserverFactory, onError: options.onError,
    hasBaseUrl: hasOwn(options, 'baseUrl'), baseUrl: options.baseUrl,
  };
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
  let route = null;
  let plans = EMPTY;
  let records = null;
  let reconciling = false;
  let pendingUrl = null;
  let cleanupContext = null;

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
    const sessionOptions = {
      source: plan.source,
      settingsRuntime: dependencies.settingsRuntime,
      observerFactory: dependencies.observerFactory,
      loadAboutAccountPayload: expectedBroker.loadAboutAccountPayload,
      abortControllerFactory: dependencies.consumerAbortControllerFactory,
      onError: (error) => {
        if (cleanupContext !== null && cleanupContext.sessions.has(session)) cleanupContext.failed = true;
        else if (current(lifecycle) && broker === expectedBroker) report(error);
      },
    };
    if (hasOwn(plan, 'baseUrl')) sessionOptions.baseUrl = plan.baseUrl;
    session = createXAccountTargetSession(plan.root, sessionOptions);
    return { plan, session };
  };

  const applyUrl = (url, lifecycle, startup = false) => {
    const nextRoute = classifyXRoute(url);
    const nextPlans = createXAccountTargetSessionPlans(root, nextRoute, plannerOptions());
    const previous = records ?? [];
    const unused = new Set(previous);
    const desired = [];
    const candidates = [];
    try {
      for (const plan of nextPlans) {
        const reusable = previous.find((record) => unused.has(record) && samePlan(record.plan, plan));
        if (reusable !== undefined) {
          unused.delete(reusable);
          desired.push({ plan, session: reusable.session });
        } else {
          const candidate = createRecord(plan, lifecycle, broker);
          candidates.push(candidate);
          desired.push(candidate);
          candidate.session.start();
        }
      }
    } catch (error) {
      const context = { sessions: new Set(candidates.map(({ session }) => session)), failed: false };
      cleanupContext = context;
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        try { candidates[index].session.stop(); } catch { context.failed = true; }
      }
      cleanupContext = null;
      if (startup) throw error;
      report(new Error('Unable to reconcile X account target route'));
      return false;
    }
    if (!current(lifecycle)) {
      const context = { sessions: new Set(candidates.map(({ session }) => session)), failed: false };
      cleanupContext = context;
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        try { candidates[index].session.stop(); } catch { context.failed = true; }
      }
      cleanupContext = null;
      return false;
    }
    route = nextRoute;
    plans = nextPlans;
    records = desired;
    const obsolete = [...unused];
    const context = { sessions: new Set(obsolete.map(({ session }) => session)), failed: false };
    cleanupContext = context;
    for (let index = previous.length - 1; index >= 0; index -= 1) {
      if (!unused.has(previous[index])) continue;
      try { previous[index].session.stop(); } catch { context.failed = true; }
    }
    cleanupContext = null;
    if (context.failed && !startup) report(new Error('Unable to reconcile X account target route'));
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
    } finally { pendingUrl = null; reconciling = false; }
  };

  const start = () => {
    if (active) return getTargets();
    const lifecycle = generation + 1;
    let createdBroker = null;
    let createdNavigation = null;
    active = true; generation = lifecycle; records = [];
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
      if (createdNavigation === null || typeof createdNavigation !== 'object'
        || ['start', 'stop', 'getCurrentUrl', 'isActive'].some((key) => typeof createdNavigation[key] !== 'function')) {
        throw new TypeError('navigationObserverFactory returned an invalid observer');
      }
      navigationObserver = createdNavigation;
      const initialUrl = createdNavigation.start();
      processUrl(initialUrl, lifecycle, true);
      return getTargets();
    } catch (error) {
      active = false; generation += 1;
      const createdRecords = records ?? [];
      broker = null; navigationObserver = null; route = null; plans = EMPTY; records = null;
      pendingUrl = null; reconciling = false;
      const context = { sessions: new Set(createdRecords.map(({ session }) => session)), failed: false };
      cleanupContext = context;
      for (let index = createdRecords.length - 1; index >= 0; index -= 1) {
        try { createdRecords[index].session.stop(); } catch { /* preserve */ }
      }
      if (createdNavigation !== null) { try { createdNavigation.stop(); } catch { /* preserve */ } }
      if (createdBroker !== null) { try { createdBroker.stop(); } catch { /* preserve */ } }
      cleanupContext = null;
      throw error;
    }
  };

  const stop = () => {
    if (!active) return;
    const oldNavigation = navigationObserver;
    const oldBroker = broker;
    const oldRecords = records;
    active = false; generation += 1;
    navigationObserver = null; broker = null; route = null; plans = EMPTY; records = null;
    pendingUrl = null; reconciling = false;
    const context = { sessions: new Set(oldRecords.map(({ session }) => session)), failed: false };
    cleanupContext = context;
    try { oldNavigation.stop(); } catch { context.failed = true; }
    for (let index = oldRecords.length - 1; index >= 0; index -= 1) {
      try { oldRecords[index].session.stop(); } catch { context.failed = true; }
    }
    try { oldBroker.stop(); } catch { context.failed = true; }
    cleanupContext = null;
    if (context.failed) report(new Error('Unable to stop X account target route session controller'));
  };
  const reconcile = () => {
    if (!active) throw new TypeError('account target route session controller is not active');
    const lifecycle = generation;
    try {
      const url = navigationObserver.getCurrentUrl();
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
