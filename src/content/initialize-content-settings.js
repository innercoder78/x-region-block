import { createBrowserStorageAdapter } from '../shared/browser-storage-adapter.js';
import { SUPPORTED_HOSTNAMES } from '../shared/constants.js';
import { createSettingsRepository } from '../shared/settings-repository.js';
import { createSettingsRuntime } from '../shared/settings-runtime.js';
import { createBrowserStorageChangeAdapter } from '../shared/storage-change-adapter.js';

export async function initializeContentSettings(globalScope = globalThis) {
  const hostname = typeof globalScope.location?.hostname === 'string'
    ? globalScope.location.hostname.toLowerCase()
    : '';
  if (!SUPPORTED_HOSTNAMES.includes(hostname)) return null;

  const storageAdapter = createBrowserStorageAdapter(globalScope);
  const repository = createSettingsRepository(storageAdapter);
  const changeAdapter = createBrowserStorageChangeAdapter(globalScope);
  const runtime = createSettingsRuntime({
    repository,
    changeAdapter,
    onError: () => globalScope.console?.error?.('Unable to refresh extension settings'),
  });
  try {
    await runtime.start();
  } catch {
    runtime.stop();
    throw new Error('Unable to initialize extension settings');
  }
  return runtime;
}
