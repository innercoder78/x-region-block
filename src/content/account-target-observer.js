import { discoverXAccountPresentationTargets } from './account-target-discovery.js';
import { ACCOUNT_IDENTITY_SOURCES } from '../shared/account-identity.js';

export const ACCOUNT_TARGET_OBSERVER_VERSION = 1;

const EMPTY = Object.freeze([]);
const hasOwn = (value, property) => Object.prototype.hasOwnProperty.call(value, property);

function normalizeOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || (Object.getPrototypeOf(options) !== Object.prototype
      && Object.getPrototypeOf(options) !== null)) {
    throw new TypeError('account target observer options must be a plain object');
  }
  if (hasOwn(options, 'accountId')) {
    throw new TypeError('accountId is not supported by account target observation');
  }
  if (!hasOwn(options, 'source') || typeof options.source !== 'string') {
    throw new TypeError('Invalid account target observer source');
  }
  const source = options.source.trim().toLowerCase();
  if (!ACCOUNT_IDENTITY_SOURCES.includes(source)) {
    throw new TypeError('Invalid account target observer source');
  }
  if (!hasOwn(options, 'observerFactory') || typeof options.observerFactory !== 'function') {
    throw new TypeError('observerFactory must be a function');
  }
  if (!hasOwn(options, 'onChange') || typeof options.onChange !== 'function') {
    throw new TypeError('onChange must be a function');
  }
  if (!hasOwn(options, 'onError') || typeof options.onError !== 'function') {
    throw new TypeError('onError must be a function');
  }
  return {
    source,
    hasBaseUrl: hasOwn(options, 'baseUrl'),
    baseUrl: options.baseUrl,
    observerFactory: options.observerFactory,
    onChange: options.onChange,
    onError: options.onError,
  };
}

function hasPostHeader(target) {
  const siblings = target.badgeContainer?.parentElement?.children;
  const siblingList = siblings && typeof siblings[Symbol.iterator] === 'function' ? [...siblings] : [];
  const index = siblingList.indexOf(target.badgeContainer);
  return index > 0 && siblingList[index - 1]
    ?.getAttribute?.('data-x-region-block-location-header') === '1';
}

function equivalent(previous, current, previousParent, previousHadHeader) {
  if (previousHadHeader && (previousParent !== current.badgeContainer?.parentElement
    || !hasPostHeader(current))) return false;
  return previous.version === current.version && previous.source === current.source
    && previous.link === current.link && previous.badgeContainer === current.badgeContainer
    && previous.identity.handle === current.identity.handle
    && previous.identity.displayHandle === current.identity.displayHandle
    && previous.identity.profileUrl === current.identity.profileUrl
    && previous.identity.accountId === current.identity.accountId
    && previous.identity.allowlistKey === current.identity.allowlistKey
    && previous.identity.source === current.identity.source;
}

/** Creates an isolated lifecycle around static X account-target discovery. */
export function createXAccountTargetObserver(root, options) {
  if (root === null || typeof root !== 'object' || Array.isArray(root)
    || typeof root.querySelectorAll !== 'function') {
    throw new TypeError('Invalid account target observer root');
  }
  const normalized = normalizeOptions(options);
  let activeRoot = null;
  let observer = null;
  let active = false;
  let targets = EMPTY;
  let generation = 0;
  let scheduled = false;
  let parentSnapshots = new WeakMap();
  let headerSnapshots = new WeakMap();

  const report = (error) => {
    try { normalized.onError(error); } catch { /* The error boundary is intentionally silent. */ }
  };
  const deliver = (change) => {
    try { normalized.onChange(change); } catch {
      report(new Error('Unable to deliver account target changes'));
    }
  };
  const scan = () => discoverXAccountPresentationTargets(activeRoot,
    normalized.hasBaseUrl
      ? { source: normalized.source, baseUrl: normalized.baseUrl }
      : { source: normalized.source });

  const reconcile = (discovered, reason, initial = false) => {
    const previousByContainer = new Map(targets.map((target) => [target.accountContainer, target]));
    const current = [];
    const added = [];
    const updated = [];
    for (const discoveredTarget of discovered) {
      const previous = previousByContainer.get(discoveredTarget.accountContainer);
      if (previous === undefined) {
        current.push(discoveredTarget);
        added.push(discoveredTarget);
      } else {
        previousByContainer.delete(discoveredTarget.accountContainer);
        if (equivalent(previous, discoveredTarget, parentSnapshots.get(previous),
          headerSnapshots.get(previous) === true)) current.push(previous);
        else {
          current.push(discoveredTarget);
          updated.push(Object.freeze({ previous, current: discoveredTarget }));
        }
      }
    }
    const removed = [...previousByContainer.values()];
    const orderChanged = current.length !== targets.length
      || current.some((target, index) => target !== targets[index]);
    if (!initial && added.length === 0 && updated.length === 0 && removed.length === 0
      && !orderChanged) {
      for (const target of targets) {
        parentSnapshots.set(target, target.badgeContainer?.parentElement ?? null);
        headerSnapshots.set(target, hasPostHeader(target));
      }
      return targets;
    }
    targets = Object.freeze(current);
    const nextParents = new WeakMap(); const nextHeaders = new WeakMap();
    for (const target of targets) {
      nextParents.set(target, target.badgeContainer?.parentElement ?? null);
      nextHeaders.set(target, hasPostHeader(target));
    }
    parentSnapshots = nextParents; headerSnapshots = nextHeaders;
    deliver(Object.freeze({
      version: ACCOUNT_TARGET_OBSERVER_VERSION,
      reason,
      source: normalized.source,
      current: targets,
      added: Object.freeze(added),
      updated: Object.freeze(updated),
      removed: Object.freeze(removed),
    }));
    return targets;
  };

  const handleMutations = (records) => {
    if (!active || records == null || records.length === 0 || scheduled) return;
    scheduled = true;
    const scheduledGeneration = generation;
    Promise.resolve().then(() => {
      if (!active || generation !== scheduledGeneration) return;
      scheduled = false;
      try { reconcile(scan(), 'mutation'); } catch {
        report(new Error('Unable to refresh account targets'));
      }
    });
  };

  const start = () => {
    if (active) return targets;
    let created;
    try {
      created = normalized.observerFactory(handleMutations);
      if (created === null || typeof created !== 'object'
        || typeof created.observe !== 'function' || typeof created.disconnect !== 'function') {
        throw new TypeError('observerFactory returned an invalid observer');
      }
      activeRoot = root;
      observer = created;
      active = true;
      generation += 1;
      created.observe(activeRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-testid', 'href'],
      });
      return reconcile(scan(), 'initial', true);
    } catch (error) {
      if (created && typeof created.disconnect === 'function') {
        try { created.disconnect(); } catch { /* Preserve the initialization error. */ }
      }
      active = false;
      activeRoot = null;
      observer = null;
      targets = EMPTY;
      scheduled = false;
      generation += 1;
      throw error;
    }
  };
  const stop = () => {
    if (!active) return;
    const currentObserver = observer;
    active = false;
    generation += 1;
    scheduled = false;
    targets = EMPTY;
    parentSnapshots = new WeakMap(); headerSnapshots = new WeakMap();
    activeRoot = null;
    observer = null;
    currentObserver.disconnect();
  };
  const rescan = () => {
    if (!active) throw new TypeError('account target observer is not active');
    return reconcile(scan(), 'manual');
  };
  const getTargets = () => targets;
  const isActive = () => active;
  return Object.freeze({ start, stop, rescan, getTargets, isActive });
}
