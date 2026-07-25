import { describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/shared/settings-schema.js';
import { createSettingsRepository, SETTINGS_STORAGE_KEY } from '../src/shared/settings-repository.js';

function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    get: vi.fn(async (key) => key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: vi.fn(async (values) => Object.assign(data, structuredClone(values))),
    remove: vi.fn(async (key) => { delete data[key]; }),
  };
}

describe('settings repository', () => {
  it.each([null, {}, { get() {}, set() {} }])('rejects invalid adapters', (adapter) => {
    expect(() => createSettingsRepository(adapter)).toThrow(/storageAdapter/);
  });

  it('loads defaults without writing when the key is missing', async () => {
    const storage = fakeStorage();
    await expect(createSettingsRepository(storage).loadSettings()).resolves.toEqual(createDefaultSettings());
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('persists defaults once when missing and not again when canonical', async () => {
    const storage = fakeStorage();
    const repository = createSettingsRepository(storage);
    await repository.initializeSettings();
    expect(storage.set).toHaveBeenCalledOnce();
    await repository.initializeSettings();
    expect(storage.set).toHaveBeenCalledOnce();
  });

  it.each([
    ['unversioned', { country: { hide: ['us'] } }],
    ['version zero', { schemaVersion: 0, region: { highlight: ['EUROPE'] } }],
    ['current partial', { schemaVersion: 1, language: { highlight: [' EN '] } }],
  ])('migrates and writes canonical %s settings', async (name, value) => {
    const storage = fakeStorage({ [SETTINGS_STORAGE_KEY]: value });
    const result = await createSettingsRepository(storage).initializeSettings();
    expect(result.schemaVersion).toBe(1);
    if (name === 'version zero') expect(result.region.highlight).toEqual(['EUROPE']);
    expect(storage.set).toHaveBeenCalledOnce();
    expect(storage.data[SETTINGS_STORAGE_KEY]).toEqual(result);
  });

  it('removes unsupported fields during initialization', async () => {
    const value = { ...structuredClone(createDefaultSettings()), token: 'do-not-store' };
    const storage = fakeStorage({ [SETTINGS_STORAGE_KEY]: value });
    const result = await createSettingsRepository(storage).initializeSettings();
    expect(result).not.toHaveProperty('token');
    expect(storage.data[SETTINGS_STORAGE_KEY]).not.toHaveProperty('token');
  });

  it('does not rewrite exactly canonical settings', async () => {
    const storage = fakeStorage({ [SETTINGS_STORAGE_KEY]: createDefaultSettings() });
    await createSettingsRepository(storage).initializeSettings();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('normalizes saved settings without mutating input or retaining unsupported data', async () => {
    const input = { country: { hide: [' us ', 'US'] }, avatarUrl: 'https://example.invalid' };
    const original = structuredClone(input);
    const storage = fakeStorage();
    const result = await createSettingsRepository(storage).saveSettings(input);
    expect(input).toEqual(original);
    expect(result.country.hide).toEqual(['US']);
    expect(storage.data[SETTINGS_STORAGE_KEY]).not.toHaveProperty('avatarUrl');
  });

  it('resets to persisted defaults', async () => {
    const storage = fakeStorage({ [SETTINGS_STORAGE_KEY]: { schemaVersion: 1, allowlist: ['user'] } });
    await expect(createSettingsRepository(storage).resetSettings()).resolves.toEqual(createDefaultSettings());
    expect(storage.data[SETTINGS_STORAGE_KEY]).toEqual(createDefaultSettings());
  });

  it('returns deeply immutable settings and stores JSON arrays', async () => {
    const storage = fakeStorage();
    const result = await createSettingsRepository(storage).saveSettings({ allowlist: ['user'] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.country)).toBe(true);
    expect(Object.isFrozen(result.allowlist)).toBe(true);
    expect(Array.isArray(storage.data[SETTINGS_STORAGE_KEY].allowlist)).toBe(true);
    expect(JSON.parse(JSON.stringify(storage.data[SETTINGS_STORAGE_KEY]))).toEqual(storage.data[SETTINGS_STORAGE_KEY]);
  });

  it.each([
    ['malformed', { schemaVersion: 1, allowlist: 'user' }],
    ['future', { schemaVersion: 2 }],
  ])('rejects %s stored settings without writing', async (name, value) => {
    const storage = fakeStorage({ [SETTINGS_STORAGE_KEY]: value });
    await expect(createSettingsRepository(storage).initializeSettings()).rejects.toThrow();
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.data[SETTINGS_STORAGE_KEY]).toEqual(value);
  });

  it('propagates storage read and write failures', async () => {
    const readError = new Error('read failed');
    const writeError = new Error('write failed');
    const readStorage = fakeStorage();
    readStorage.get.mockRejectedValue(readError);
    await expect(createSettingsRepository(readStorage).loadSettings()).rejects.toBe(readError);
    const writeStorage = fakeStorage();
    writeStorage.set.mockRejectedValue(writeError);
    await expect(createSettingsRepository(writeStorage).resetSettings()).rejects.toBe(writeError);
  });

  it('stores only the explicit canonical settings categories', async () => {
    const storage = fakeStorage();
    await createSettingsRepository(storage).saveSettings({ accountId: '1', cookies: ['x'], requestMetadata: {} });
    expect(Object.keys(storage.data[SETTINGS_STORAGE_KEY])).toEqual([
      'schemaVersion', 'country', 'region', 'language', 'tag', 'other', 'allowlist',
    ]);
  });
});
