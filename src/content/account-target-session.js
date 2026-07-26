import { createXAccountTargetObserver } from './account-target-observer.js';
import { createXAccountTargetProcessor } from './account-target-processor.js';
import { ACCOUNT_IDENTITY_SOURCES } from '../shared/account-identity.js';

export const ACCOUNT_TARGET_SESSION_VERSION = 1;

const EMPTY = Object.freeze([]);
const hasOwn = (value, property) => Object.prototype.hasOwnProperty.call(value, property);

function normalizeOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || (Object.getPrototypeOf(options) !== Object.prototype
      && Object.getPrototypeOf(options) !== null)) {
    throw new TypeError('account target session options must be a plain object');
  }
  if (hasOwn(options, 'accountId')) {
    throw new TypeError('accountId is not supported by account target sessions');
  }
  if (!hasOwn(options, 'source') || typeof options.source !== 'string') {
    throw new TypeError('Invalid account target session source');
  }
  const source = options.source.trim().toLowerCase();
  if (!ACCOUNT_IDENTITY_SOURCES.includes(source)) {
    throw new TypeError('Invalid account target session source');
  }
  const settingsRuntime = hasOwn(options, 'settingsRuntime') ? options.settingsRuntime : null;
  if (settingsRuntime === null || typeof settingsRuntime !== 'object'
    || typeof settingsRuntime.getSettings !== 'function'
    || typeof settingsRuntime.subscribe !== 'function') {
    throw new TypeError('settingsRuntime must provide getSettings and subscribe');
  }
  for (const [property, message] of [
    ['observerFactory', 'observerFactory must be a function'],
    ['loadAboutAccountPayload', 'loadAboutAccountPayload must be a function'],
    ['abortControllerFactory', 'abortControllerFactory must be a function'],
    ['onError', 'onError must be a function'],
  ]) {
    if (!hasOwn(options, property) || typeof options[property] !== 'function') {
      throw new TypeError(message);
    }
  }
  return {
    source,
    hasBaseUrl: hasOwn(options, 'baseUrl'),
    baseUrl: options.baseUrl,
    settingsRuntime,
    observerFactory: options.observerFactory,
    loadAboutAccountPayload: options.loadAboutAccountPayload,
    abortControllerFactory: options.abortControllerFactory,
    onError: options.onError,
  };
}

/** Composes one explicit root and source with account observation and processing. */
export function createXAccountTargetSession(root, options) {
  if (root === null || typeof root !== 'object' || Array.isArray(root)
    || typeof root.querySelectorAll !== 'function') {
    throw new TypeError('Invalid account target session root');
  }
  const normalized = normalizeOptions(options);
  let active = false;
  let generation = 0;
  let processor = null;
  let observer = null;
  let unsubscribe = null;

  const report = (error) => {
    try { normalized.onError(error); } catch { /* The injected error boundary is intentionally silent. */ }
  };
  const current = (expectedGeneration, expectedProcessor) => active
    && generation === expectedGeneration && processor === expectedProcessor;

  const start = () => {
    if (active) return processor.getTargets();
    const lifecycle = generation + 1;
    let createdProcessor = null;
    let createdObserver = null;
    let createdUnsubscribe = null;
    active = true;
    generation = lifecycle;
    try {
      const settings = normalized.settingsRuntime.getSettings();
      if (settings === null || settings === undefined) {
        throw new TypeError('settings runtime has no current settings');
      }
      const processorOptions = {
        source: normalized.source,
        settings,
        loadAboutAccountPayload: normalized.loadAboutAccountPayload,
        abortControllerFactory: normalized.abortControllerFactory,
        onError: (error) => {
          if (current(lifecycle, createdProcessor)) report(error);
        },
      };
      if (normalized.hasBaseUrl) processorOptions.baseUrl = normalized.baseUrl;
      createdProcessor = createXAccountTargetProcessor(processorOptions);
      processor = createdProcessor;
      createdProcessor.start();

      createdUnsubscribe = normalized.settingsRuntime.subscribe((nextSettings) => {
        if (!current(lifecycle, createdProcessor)) return;
        try { createdProcessor.setSettings(nextSettings); } catch {
          report(new Error('Unable to apply account target settings'));
        }
      });
      if (typeof createdUnsubscribe !== 'function') {
        throw new TypeError('settingsRuntime.subscribe must return an unsubscribe function');
      }
      unsubscribe = createdUnsubscribe;

      const observerOptions = {
        source: normalized.source,
        observerFactory: normalized.observerFactory,
        onChange: (change) => {
          if (current(lifecycle, createdProcessor)) createdProcessor.processChange(change);
        },
        onError: (error) => {
          if (current(lifecycle, createdProcessor)) report(error);
        },
      };
      if (normalized.hasBaseUrl) observerOptions.baseUrl = normalized.baseUrl;
      createdObserver = createXAccountTargetObserver(root, observerOptions);
      observer = createdObserver;
      createdObserver.start();
      return createdProcessor.getTargets();
    } catch (error) {
      active = false;
      generation += 1;
      if (createdObserver !== null) {
        try { createdObserver.stop(); } catch { /* Preserve the startup error. */ }
      }
      if (typeof createdUnsubscribe === 'function') {
        try { createdUnsubscribe(); } catch { /* Preserve the startup error. */ }
      }
      if (createdProcessor !== null) {
        try { createdProcessor.stop(); } catch { /* Preserve the startup error. */ }
      }
      observer = null;
      unsubscribe = null;
      processor = null;
      throw error;
    }
  };

  const stop = () => {
    if (!active) return;
    const currentObserver = observer;
    const currentUnsubscribe = unsubscribe;
    const currentProcessor = processor;
    active = false;
    generation += 1;
    observer = null;
    unsubscribe = null;
    processor = null;
    let failed = false;
    try { currentObserver.stop(); } catch { failed = true; }
    try { currentUnsubscribe(); } catch { failed = true; }
    try { currentProcessor.stop(); } catch { failed = true; }
    if (failed) report(new Error('Unable to stop account target session'));
  };
  const rescan = () => {
    if (!active) throw new TypeError('account target session is not active');
    observer.rescan();
    return processor.getTargets();
  };
  const getTargets = () => (active ? processor.getTargets() : EMPTY);
  const isActive = () => active;

  return Object.freeze({ start, stop, rescan, getTargets, isActive });
}
