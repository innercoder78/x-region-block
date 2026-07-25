import { PRODUCT_NAME } from '../shared/constants.js';
import { initializeBackgroundSettings } from './initialize-settings.js';

// Importing the shared scaffold metadata proves the background bundle initializes.
void PRODUCT_NAME;

initializeBackgroundSettings().catch(() => {
  console.error('Failed to initialize extension settings.');
});
