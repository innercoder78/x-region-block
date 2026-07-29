import { PRODUCT_NAME } from '../shared/constants.js';
import { initializeBackgroundSettings } from './initialize-settings.js';
import { registerOpenOptionsMessageHandler } from './open-options-message-handler.js';

// Importing the shared scaffold metadata proves the background bundle initializes.
void PRODUCT_NAME;

registerOpenOptionsMessageHandler(globalThis, () => {
  console.warn('Unable to open Region Blocker options.');
});

initializeBackgroundSettings().catch(() => {
  console.error('Failed to initialize extension settings.');
});
