import { initializeContentSettings } from './initialize-content-settings.js';

initializeContentSettings().catch(() => {
  globalThis.console?.error?.('Unable to initialize extension settings');
});
