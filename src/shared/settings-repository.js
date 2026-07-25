import { createDefaultSettings, migrateSettings, normalizeSettings } from './settings-schema.js';

export const SETTINGS_STORAGE_KEY = 'xRegionBlock.settings';

function validateAdapter(adapter) {
  if (adapter === null || typeof adapter !== 'object') {
    throw new TypeError('storageAdapter must provide get, set, and remove methods');
  }
  for (const method of ['get', 'set', 'remove']) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`storageAdapter.${method} must be a function`);
    }
  }
}

function hasStoredSettings(values) {
  return values !== null
    && typeof values === 'object'
    && Object.prototype.hasOwnProperty.call(values, SETTINGS_STORAGE_KEY)
    && values[SETTINGS_STORAGE_KEY] !== undefined;
}

function persistedSettings(settings) {
  return JSON.parse(JSON.stringify(settings));
}

function structurallyEqual(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function createSettingsRepository(storageAdapter) {
  validateAdapter(storageAdapter);

  async function read() {
    const values = await storageAdapter.get(SETTINGS_STORAGE_KEY);
    return hasStoredSettings(values) ? { found: true, value: values[SETTINGS_STORAGE_KEY] } : { found: false };
  }

  async function persist(settings) {
    await storageAdapter.set({ [SETTINGS_STORAGE_KEY]: persistedSettings(settings) });
    return settings;
  }

  async function loadSettings() {
    const stored = await read();
    return stored.found ? migrateSettings(stored.value) : createDefaultSettings();
  }

  async function saveSettings(input) {
    return persist(normalizeSettings(input));
  }

  async function resetSettings() {
    return persist(createDefaultSettings());
  }

  async function initializeSettings() {
    const stored = await read();
    const canonical = stored.found ? migrateSettings(stored.value) : createDefaultSettings();
    if (!stored.found || !structurallyEqual(stored.value, canonical)) await persist(canonical);
    return canonical;
  }

  return Object.freeze({ loadSettings, saveSettings, resetSettings, initializeSettings });
}
