import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { createXAboutAccountCacheRepository, X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY } from '../src/content/x-about-account-cache.js';

const DAY = 24 * 60 * 60 * 1000;
const TTL = 7 * DAY;
const known = Object.freeze({ version: 2, accountBasedIn: 'Canada', source: 'Web', locationAccurate: true });
const identity = (source = 'timeline', accountId = null, handle = 'OpenAI') => createAccountIdentity({ handle, accountId, source });
function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  return { data, get: vi.fn(async (key) => ({ [key]: data[key] })),
    set: vi.fn(async (values) => Object.assign(data, structuredClone(values))),
    remove: vi.fn(async (key) => { delete data[key]; }) };
}
const repository = (storage, options = {}) => createXAboutAccountCacheRepository({ storage,
  setTimeout, clearTimeout, ...options });
const storedEntry = (key, createdAt, expiresAt, lastAccessAt = createdAt, value = known) => ({
  key, createdAt, expiresAt, lastAccessAt, payload: value,
});

afterEach(() => vi.useRealTimers());

describe('persistent About Account cache', () => {
  it.each([
    ['known country', known],
    ['known region', { ...known, accountBasedIn: 'North America' }],
    ['canonical unknown', { ...known, accountBasedIn: 'Somewhere' }],
    ['blank', { ...known, accountBasedIn: '' }],
    ['null', { ...known, accountBasedIn: null }],
    ['whitespace-only', { ...known, accountBasedIn: '  ' }],
    ['unrecognized', { ...known, accountBasedIn: 'Atlantis' }],
  ])('gives a successful %s payload exactly seven days of retention', async (_label, value) => {
    const storage = fakeStorage(); const cache = repository(storage, { now: () => 5_000 });
    await cache.put(identity(), value); await cache.flush();
    expect(storage.data[X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY]).toMatchObject({ schemaVersion: 2,
      entries: [{ createdAt: 5_000, expiresAt: 5_000 + TTL }] });
    await cache.stop();
  });

  it('returns a value one millisecond before expiration and expires it exactly at seven days', async () => {
    const storage = fakeStorage(); let time = 100; const cache = repository(storage, { now: () => time });
    await cache.put(identity(), known); time = 100 + TTL - 1;
    await expect(cache.get(identity())).resolves.toEqual(known);
    time += 1; await expect(cache.get(identity())).resolves.toBeNull(); await cache.stop();
  });

  it('does not extend expiration when a hit updates in-memory LRU access ordering', async () => {
    const storage = fakeStorage(); let time = 1_000; const cache = repository(storage, { now: () => time });
    await cache.put(identity(), known); await cache.flush(); time += 6 * DAY; await cache.get(identity());
    expect(storage.data[X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY].entries[0]).toMatchObject({
      createdAt: 1_000, expiresAt: 1_000 + TTL, lastAccessAt: 1_000,
    });
    time = 1_000 + TTL; await expect(cache.get(identity())).resolves.toBeNull(); await cache.stop();
  });

  it('repeated fresh hits neither write storage nor create a debounced write timer', async () => {
    const storage = fakeStorage({ [X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY]: { schemaVersion: 2,
      entries: [storedEntry('handle:openai', 0, TTL)] } });
    const setTimer = vi.fn(); const cache = repository(storage, { now: () => DAY, setTimeout: setTimer });
    await cache.initialize();
    await expect(cache.get(identity())).resolves.toEqual(known);
    await expect(cache.get(identity())).resolves.toEqual(known);
    await expect(cache.get(identity())).resolves.toEqual(known);
    expect(storage.set).not.toHaveBeenCalled(); expect(setTimer).not.toHaveBeenCalled(); await cache.stop();
  });

  it('persists read-updated ordering and timestamps naturally with the next genuine mutation', async () => {
    const storage = fakeStorage({ [X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY]: { schemaVersion: 2, entries: [
      storedEntry('handle:first', 0, TTL, 10), storedEntry('handle:second', 0, TTL, 20),
    ] } });
    let time = 100; const cache = repository(storage, { maximumEntries: 2, now: () => time }); await cache.initialize();
    await cache.get(identity('timeline', null, 'First')); expect(storage.set).not.toHaveBeenCalled();
    time = 200; await cache.put(identity('timeline', null, 'Third'), known); await cache.flush();
    expect(storage.data[X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY].entries).toEqual([
      storedEntry('handle:first', 0, TTL, 100), storedEntry('handle:third', 200, 200 + TTL),
    ]);
    await expect(cache.get(identity('profile', null, 'Second'))).resolves.toBeNull(); await cache.stop();
  });

  it('expires rolling cohorts independently', async () => {
    const storage = fakeStorage(); let time = DAY; const cache = repository(storage, { now: () => time });
    await cache.put(identity('timeline', null, 'First'), known); time = 2 * DAY;
    await cache.put(identity('timeline', null, 'Second'), known); time = 8 * DAY;
    await expect(cache.get(identity('profile', null, 'First'))).resolves.toBeNull();
    await expect(cache.get(identity('profile', null, 'Second'))).resolves.toEqual(known);
    time = 9 * DAY; await expect(cache.get(identity('profile', null, 'Second'))).resolves.toBeNull(); await cache.stop();
  });

  it('removes expired entries during initialization and eventually persists the cleanup', async () => {
    vi.useFakeTimers(); const storage = fakeStorage({ [X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY]: { schemaVersion: 2,
      entries: [storedEntry('handle:openai', 0, TTL)] } });
    const cache = repository(storage, { now: () => TTL }); await cache.initialize();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(storage.data[X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY]).toEqual({ schemaVersion: 2, entries: [] }); await cache.stop();
  });

  it('removes an entry expired during get and eventually persists its deletion', async () => {
    vi.useFakeTimers(); const storage = fakeStorage(); let time = 0; const cache = repository(storage, { now: () => time });
    await cache.put(identity(), known); await cache.flush(); time = TTL;
    await expect(cache.get(identity())).resolves.toBeNull(); await vi.advanceTimersByTimeAsync(1_000);
    expect(storage.data[X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY].entries).toEqual([]); await cache.stop();
  });

  it.each([DAY, 60 * 60 * 1000])('migrates a valid legacy %i ms entry to createdAt plus seven days', async (legacyTtl) => {
    const storage = fakeStorage({ [X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY]: { schemaVersion: 1,
      entries: [storedEntry('handle:openai', DAY, DAY + legacyTtl)] } });
    const cache = repository(storage, { now: () => 2 * DAY }); await cache.initialize(); await cache.flush();
    expect(storage.data[X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY]).toMatchObject({ schemaVersion: 2,
      entries: [{ createdAt: DAY, expiresAt: 8 * DAY }] }); await cache.stop();
  });

  it('discards legacy entries older than seven days without resetting age at migration time', async () => {
    const storage = fakeStorage({ [X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY]: { schemaVersion: 1, entries: [
      storedEntry('handle:expired', DAY, DAY + 60 * 60 * 1000),
      storedEntry('handle:current', 2 * DAY, 2 * DAY + DAY),
    ] } });
    const cache = repository(storage, { now: () => 8 * DAY }); await cache.initialize(); await cache.flush();
    expect(storage.data[X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY].entries).toEqual([
      storedEntry('handle:current', 2 * DAY, 9 * DAY),
    ]); await cache.stop();
  });

  it('purges expired entries before applying the 10,000-entry capacity limit', async () => {
    const entries = Array.from({ length: 10_000 }, (_, index) => storedEntry(`id:${index + 1}`,
      index === 0 ? 0 : 1, index === 0 ? TTL : TTL + 1, index));
    const storage = fakeStorage({ [X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY]: { schemaVersion: 2, entries } });
    const cache = repository(storage, { now: () => TTL }); await cache.initialize();
    await cache.put(identity('timeline', '10001'), known); await cache.flush();
    expect(storage.data[X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY].entries).toHaveLength(10_000);
    expect(storage.data[X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY].entries.some(({ key }) => key === 'id:1')).toBe(false);
    expect(storage.data[X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY].entries.some(({ key }) => key === 'id:2')).toBe(true);
    await cache.stop();
  });

  it('retains deterministic LRU eviction after expiration cleanup', async () => {
    const storage = fakeStorage({ [X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY]: { schemaVersion: 2, entries: [
      storedEntry('handle:expired', 0, TTL, 10), storedEntry('handle:first', DAY, 8 * DAY, 20),
      storedEntry('handle:second', 2 * DAY, 9 * DAY, 30),
    ] } });
    let time = TTL; const cache = repository(storage, { maximumEntries: 2, now: () => time }); await cache.initialize();
    await cache.put(identity('timeline', null, 'Third'), known);
    await expect(cache.get(identity('search', null, 'First'))).resolves.toBeNull();
    await expect(cache.get(identity('reply', null, 'Second'))).resolves.toEqual(known);
    await expect(cache.get(identity('profile', null, 'Third'))).resolves.toEqual(known); await cache.stop();
  });

  it('a persistent hit avoids live transport across every supported source', async () => {
    const storage = fakeStorage(); const first = repository(storage, { now: () => 1_000 });
    await first.put(identity(), known); await first.flush(); await first.stop();
    const second = repository(storage, { now: () => 2_000 }); const loader = vi.fn();
    for (const source of ['timeline', 'profile', 'reply', 'search', 'notification']) {
      await expect(second.loadPayload(identity(source), {}, loader)).resolves.toEqual(known);
    }
    expect(loader).not.toHaveBeenCalled(); await second.stop();
  });

  it('never caches a rejected transient request', async () => {
    const storage = fakeStorage(); const cache = repository(storage); const failure = Object.assign(new Error(), { code: 'HTTP_429' });
    await expect(cache.loadPayload(identity(), {}, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(await cache.get(identity())).toBeNull(); await cache.stop();
  });

  it('rejects malformed persisted data and contains storage failures', async () => {
    const accessor = {}; Object.defineProperty(accessor, 'entries', { get: () => { throw new Error('private details'); } });
    const storage = fakeStorage(); storage.data[X_ABOUT_ACCOUNT_CACHE_STORAGE_KEY] = accessor;
    storage.set.mockRejectedValue(new Error('private details')); const onError = vi.fn();
    const cache = repository(storage, { onError }); await cache.initialize(); await cache.put(identity(), known); await cache.flush();
    expect(await cache.get(identity())).toEqual(known); expect(storage.remove).toHaveBeenCalled();
    expect(storage.set).toHaveBeenCalled(); expect(onError).toHaveBeenCalled(); await cache.stop();
  });
});
