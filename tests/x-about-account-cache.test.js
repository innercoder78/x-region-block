import { describe, expect, it, vi } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { createXAboutAccountCacheRepository, X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY } from '../src/content/x-about-account-cache.js';

const known = Object.freeze({ version: 2, accountBasedIn: 'Canada', source: 'Web', locationAccurate: true });
const identity = (source = 'timeline', accountId = null) => createAccountIdentity({ handle: 'OpenAI', accountId, source });
function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  return { data, get: vi.fn(async (key) => ({ [key]: data[key] })),
    set: vi.fn(async (values) => Object.assign(data, structuredClone(values))),
    remove: vi.fn(async (key) => { delete data[key]; }) };
}
const repository = (storage, options = {}) => createXAboutAccountCacheRepository({ storage,
  setTimeout, clearTimeout, ...options });

describe('persistent About Account cache', () => {
  it('survives recreation and a fresh hit avoids transport across sources', async () => {
    const storage = fakeStorage(); let time = 1_000;
    const first = repository(storage, { now: () => time }); await first.put(identity(), known); await first.flush(); await first.stop();
    const second = repository(storage, { now: () => time }); const loader = vi.fn();
    await expect(second.loadPayload(identity('notification'), { signal: new AbortController().signal }, loader)).resolves.toEqual(known);
    expect(loader).not.toHaveBeenCalled(); await second.stop();
  });

  it.each([[known, 24 * 60 * 60 * 1000],
    [{ ...known, accountBasedIn: null }, 60 * 60 * 1000],
    [{ ...known, accountBasedIn: '' }, 60 * 60 * 1000],
    [{ ...known, accountBasedIn: '  ' }, 60 * 60 * 1000],
    [{ ...known, accountBasedIn: 'unknown' }, 60 * 60 * 1000]])('uses the required TTL', async (value, ttl) => {
    const storage = fakeStorage(); const cache = repository(storage, { now: () => 5_000 });
    await cache.put(identity(), value); await cache.flush();
    expect(storage.data[X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY].entries[0].expiresAt).toBe(5_000 + ttl); await cache.stop();
  });

  it('expires once and concurrent misses remain coalescible by the caller broker', async () => {
    const storage = fakeStorage(); let time = 0; const cache = repository(storage, { now: () => time });
    await cache.put(identity(), known); time = 24 * 60 * 60 * 1000; const loader = vi.fn(async () => known);
    await expect(cache.loadPayload(identity(), {}, loader)).resolves.toEqual(known); expect(loader).toHaveBeenCalledOnce(); await cache.stop();
  });

  it('prefers account IDs, falls back to normalized handles, and evicts deterministically', async () => {
    const storage = fakeStorage(); let time = 0; const cache = repository(storage, { maximumEntries: 2, now: () => ++time });
    await cache.put(identity('timeline', '42'), known);
    await cache.put(createAccountIdentity({ handle: 'Second', source: 'reply' }), known);
    await cache.put(createAccountIdentity({ handle: 'Third', source: 'profile' }), known);
    expect(await cache.get(identity('search', '42'))).toBeNull();
    expect(await cache.get(createAccountIdentity({ handle: '@SECOND', source: 'notification' }))).toEqual(known); await cache.stop();
  });

  it('rejects malformed persisted data and contains storage failures', async () => {
    const storage = fakeStorage({ [X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY]: { schemaVersion: 1, entries: [{}] } });
    storage.set.mockRejectedValue(new Error('private details')); const onError = vi.fn();
    const cache = repository(storage, { onError }); await cache.initialize(); await cache.put(identity(), known); await cache.flush();
    expect(await cache.get(identity())).toEqual(known); expect(storage.remove).toHaveBeenCalled(); await cache.stop();
    expect(storage.set).toHaveBeenCalled();
  });

  it('never caches a rejected transient request', async () => {
    const storage = fakeStorage(); const cache = repository(storage); const failure = Object.assign(new Error(), { code: 'HTTP_429' });
    await expect(cache.loadPayload(identity(), {}, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(await cache.get(identity())).toBeNull(); await cache.stop();
  });
});
