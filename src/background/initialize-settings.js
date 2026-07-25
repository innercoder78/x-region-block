import { createBrowserStorageAdapter } from '../shared/browser-storage-adapter.js';
import { createSettingsRepository } from '../shared/settings-repository.js';

export async function initializeBackgroundSettings(globalScope = globalThis) {
  const storageAdapter = createBrowserStorageAdapter(globalScope);
  return createSettingsRepository(storageAdapter).initializeSettings();
}
