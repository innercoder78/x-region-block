import { createAccountIdentity } from '../shared/account-identity.js';
import { parseXAboutAccountDetailsPayload } from '../shared/x-about-account-details.js';

export const X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY = 'xAboutAccountCacheV1';
const LEGACY_SCHEMA_VERSION = 1;
const SCHEMA_VERSION = 2;
const RETENTION_PERIOD = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 10_000;
const WRITE_DELAY = 1_000;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactData = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every((key) => own(value, key)
    && own(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const read = (value, key) => Object.getOwnPropertyDescriptor(value, key).value;

function payload(value) {
  if (!exactData(value, ['version', 'accountBasedIn', 'source', 'locationAccurate'])) return null;
  const copy = { version: read(value, 'version'), accountBasedIn: read(value, 'accountBasedIn'),
    source: read(value, 'source'), locationAccurate: read(value, 'locationAccurate') };
  try { parseXAboutAccountDetailsPayload(copy); } catch { return null; }
  return Object.freeze(copy);
}

function keyFor(identity) {
  const canonical = createAccountIdentity(identity);
  return canonical.accountId === null ? `handle:${canonical.handle}` : `id:${canonical.accountId}`;
}

export function createXAboutAccountCacheRepository(options) {
  if (!plain(options) || typeof options.storage?.get !== 'function'
    || typeof options.storage?.set !== 'function' || typeof options.storage?.remove !== 'function') {
    throw new TypeError('Invalid About Account cache options');
  }
  const storage = options.storage;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimeout ?? setTimeout;
  const clearTimer = options.clearTimeout ?? clearTimeout;
  const onError = options.onError ?? (() => {});
  const maximum = options.maximumEntries ?? MAX_ENTRIES;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_ENTRIES) throw new TypeError('Invalid cache limit');
  let active = true; let initialized = false; let initializePromise = null; let timer = null;
  let entries = new Map(); let dirty = false;
  const report = () => { try { onError(new Error('About Account local cache storage failed')); } catch { /* local */ } };
  const serialize = () => ({ schemaVersion: SCHEMA_VERSION, entries: [...entries].map(([key, entry]) => ({
    key, createdAt: entry.createdAt, expiresAt: entry.expiresAt, lastAccessAt: entry.lastAccessAt,
    payload: entry.payload,
  })) });
  const flush = async () => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (!dirty || !active) return;
    dirty = false;
    try { await storage.set({ [X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY]: serialize() }); } catch { dirty = true; report(); }
  };
  const scheduleWrite = () => {
    dirty = true;
    if (timer === null && active) timer = setTimer(() => { timer = null; void flush(); }, WRITE_DELAY);
  };
  const purgeExpired = (timestamp) => {
    let removed = false;
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= timestamp) { entries.delete(key); removed = true; }
    }
    if (removed) scheduleWrite();
  };
  const initialize = () => {
    if (initialized) return Promise.resolve();
    if (initializePromise !== null) return initializePromise;
    initializePromise = Promise.resolve().then(() => storage.get(X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY)).then((stored) => {
      if (!active) return;
      const storedDescriptor = plain(stored)
        ? Object.getOwnPropertyDescriptor(stored, X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY) : null;
      const root = storedDescriptor && own(storedDescriptor, 'value') ? storedDescriptor.value : null;
      if (root === undefined) { initialized = true; return; }
      const schemaVersion = exactData(root, ['schemaVersion', 'entries']) ? read(root, 'schemaVersion') : null;
      if (schemaVersion !== SCHEMA_VERSION && schemaVersion !== LEGACY_SCHEMA_VERSION
        || !Array.isArray(read(root, 'entries')) || read(root, 'entries').length > MAX_ENTRIES) {
        initialized = true; void storage.remove(X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY).catch(report); return;
      }
      const loaded = []; let malformed = false;
      for (const item of read(root, 'entries')) {
        if (!exactData(item, ['key', 'createdAt', 'expiresAt', 'lastAccessAt', 'payload'])) { malformed = true; break; }
        const key = read(item, 'key'); const compact = payload(read(item, 'payload'));
        const times = ['createdAt', 'expiresAt', 'lastAccessAt'].map((name) => read(item, name));
        if (typeof key !== 'string' || key.length > 40 || !/^(?:id:\d+|handle:[a-z0-9_]{1,15})$/.test(key)
          || compact === null || times.some((time) => !Number.isSafeInteger(time) || time < 0)) { malformed = true; break; }
        const expiresAt = schemaVersion === LEGACY_SCHEMA_VERSION ? times[0] + RETENTION_PERIOD : times[1];
        if (!Number.isSafeInteger(expiresAt)
          || schemaVersion === SCHEMA_VERSION && expiresAt !== times[0] + RETENTION_PERIOD) { malformed = true; break; }
        loaded.push([key, { payload: compact, createdAt: times[0], expiresAt, lastAccessAt: times[2] }]);
      }
      if (malformed) {
        initialized = true; void storage.remove(X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY).catch(report); return;
      }
      loaded.sort((a, b) => a[1].lastAccessAt - b[1].lastAccessAt || a[1].createdAt - b[1].createdAt
        || a[0].localeCompare(b[0]));
      const timestamp = now();
      const retained = loaded.filter(([, entry]) => entry.expiresAt > timestamp).slice(-maximum);
      entries = new Map(retained); initialized = true;
      if (schemaVersion === LEGACY_SCHEMA_VERSION || retained.length !== loaded.length) scheduleWrite();
    }).catch(() => { if (active) initialized = true; report(); }).finally(() => { initializePromise = null; });
    return initializePromise;
  };
  const get = async (identity) => {
    const key = keyFor(identity); await initialize();
    if (!active) return null;
    const entry = entries.get(key);
    if (!entry) return null;
    const timestamp = now();
    if (entry.expiresAt <= timestamp) { entries.delete(key); scheduleWrite(); return null; }
    entries.delete(key); entry.lastAccessAt = timestamp; entries.set(key, entry); scheduleWrite();
    return entry.payload;
  };
  const put = async (identity, value) => {
    const key = keyFor(identity); const compact = payload(value);
    if (compact === null) throw new TypeError('Invalid About Account cache payload');
    await initialize(); if (!active) return compact;
    const timestamp = now();
    purgeExpired(timestamp);
    entries.delete(key); entries.set(key, { payload: compact, createdAt: timestamp,
      expiresAt: timestamp + RETENTION_PERIOD, lastAccessAt: timestamp });
    while (entries.size > maximum) entries.delete(entries.keys().next().value);
    scheduleWrite(); return compact;
  };
  const loadPayload = async (identity, context, loader) => {
    const hit = await get(identity); if (hit !== null) return hit;
    const result = await loader(identity, context); return put(identity, result);
  };
  return Object.freeze({ initialize, get, put, loadPayload, flush, stop: async () => {
    if (!active) return; await initialize(); await flush(); active = false;
    if (timer !== null) clearTimer(timer); timer = null; entries.clear(); entries = new Map();
  } });
}
