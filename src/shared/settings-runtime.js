import { SETTINGS_STORAGE_KEY } from './settings-repository.js';

function validateDependencies(repository, changeAdapter, onError) {
  if (!repository || typeof repository.initializeSettings !== 'function') {
    throw new TypeError('repository.initializeSettings must be a function');
  }
  if (!changeAdapter || typeof changeAdapter.subscribe !== 'function') {
    throw new TypeError('changeAdapter.subscribe must be a function');
  }
  if (typeof onError !== 'function') throw new TypeError('onError must be a function');
}

function immutableCopy(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [key, child] of Object.entries(value)) copy[key] = immutableCopy(child, seen);
  return Object.freeze(copy);
}

function snapshotOf(settings) {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new TypeError('Settings repository returned invalid settings');
  }
  return immutableCopy(settings);
}

function structurallyEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createSettingsRuntime({ repository, changeAdapter, onError }) {
  validateDependencies(repository, changeAdapter, onError);

  const subscribers = new Set();
  let snapshot = null;
  let active = false;
  let generation = 0;
  let unsubscribeChanges = null;
  let startPromise = null;
  let refreshQueue = Promise.resolve();

  function notify(settings) {
    for (const listener of [...subscribers]) {
      try {
        listener(settings);
      } catch {
        // Subscriber failures are isolated and settings are never logged.
      }
    }
  }

  async function refresh(expectedGeneration) {
    if (!active || generation !== expectedGeneration) return;
    try {
      const next = snapshotOf(await repository.initializeSettings());
      if (!active || generation !== expectedGeneration) return;
      if (!structurallyEqual(snapshot, next)) {
        snapshot = next;
        notify(snapshot);
      }
    } catch {
      if (!active || generation !== expectedGeneration) return;
      onError(new Error('Unable to refresh extension settings'));
    }
  }

  function handleStorageChange(expectedGeneration, changes, areaName) {
    if (!active || generation !== expectedGeneration || areaName !== 'local') return;
    if (changes === null || typeof changes !== 'object'
      || !Object.prototype.hasOwnProperty.call(changes, SETTINGS_STORAGE_KEY)) return;

    refreshQueue = refreshQueue.then(() => refresh(expectedGeneration), () => refresh(expectedGeneration));
  }

  function start() {
    if (active && startPromise) return startPromise;

    active = true;
    const expectedGeneration = ++generation;
    try {
      unsubscribeChanges = changeAdapter.subscribe(
        (changes, areaName) => handleStorageChange(expectedGeneration, changes, areaName),
      );
    } catch (error) {
      active = false;
      unsubscribeChanges = null;
      return Promise.reject(error);
    }

    const initialization = Promise.resolve().then(() => repository.initializeSettings()).then((settings) => {
      if (!active || generation !== expectedGeneration) return snapshot;
      snapshot = snapshotOf(settings);
      notify(snapshot);
      return snapshot;
    });
    refreshQueue = initialization;
    startPromise = initialization.catch((error) => {
      if (active && generation === expectedGeneration) {
        active = false;
        unsubscribeChanges?.();
        unsubscribeChanges = null;
        startPromise = null;
      }
      throw error;
    });
    return startPromise;
  }

  function stop() {
    if (!active) return;
    active = false;
    generation += 1;
    unsubscribeChanges?.();
    unsubscribeChanges = null;
    startPromise = null;
    refreshQueue = Promise.resolve();
  }

  function getSettings() {
    return snapshot;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    subscribers.add(listener);
    if (snapshot !== null) {
      try {
        listener(snapshot);
      } catch {
        // Subscriber failures are isolated and settings are never logged.
      }
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      subscribers.delete(listener);
    };
  }

  return Object.freeze({ start, stop, getSettings, subscribe });
}
