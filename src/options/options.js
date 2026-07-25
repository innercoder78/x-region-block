import { createBrowserStorageAdapter } from '../shared/browser-storage-adapter.js';
import { PRODUCT_NAME } from '../shared/constants.js';
import { createSettingsRepository } from '../shared/settings-repository.js';
import { createOptionsController } from './options-controller.js';
import { createOptionsView } from './options-view.js';

document.title = `${PRODUCT_NAME} options`;
const view = createOptionsView(document);
const controller = createOptionsController({
  repository: createSettingsRepository(createBrowserStorageAdapter()),
  view,
  confirmReset: (message) => globalThis.confirm(message),
});
view.onSubmit(controller.save);
view.onReset(controller.reset);
void controller.load();
