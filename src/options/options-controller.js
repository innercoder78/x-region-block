import { formModelToSettingsInput, settingsToFormModel } from './settings-form.js';

export function createOptionsController({ repository, view, confirmReset }) {
  let busy = false;
  const fail = (message) => view.showStatus(message, 'error');

  async function load() {
    if (busy) return;
    busy = true; view.setEnabled(false); view.showStatus('', 'none');
    try {
      view.writeModel(settingsToFormModel(await repository.initializeSettings()));
      view.setEnabled(true); view.showStatus('Settings ready.', 'success');
    } catch {
      fail('Settings could not be loaded. Please try again.');
      console.error('Options settings load failed.');
    } finally { busy = false; }
  }

  async function save() {
    if (busy) return;
    busy = true; view.setActionsEnabled(false); view.showStatus('', 'none');
    try {
      const canonical = await repository.saveSettings(formModelToSettingsInput(view.readModel()));
      view.writeModel(settingsToFormModel(canonical));
      view.showStatus('Settings saved.', 'success');
    } catch (error) {
      fail(error instanceof TypeError || error instanceof RangeError
        ? error.message : 'Settings could not be saved because local storage is unavailable.');
    } finally { busy = false; view.setActionsEnabled(true); }
  }

  async function reset() {
    if (busy || !confirmReset('Reset all settings to their defaults?')) return;
    busy = true; view.setActionsEnabled(false); view.showStatus('', 'none');
    try {
      view.writeModel(settingsToFormModel(await repository.resetSettings()));
      view.showStatus('Settings reset to defaults.', 'success');
    } catch { fail('Settings could not be reset because local storage is unavailable.'); }
    finally { busy = false; view.setActionsEnabled(true); }
  }
  return Object.freeze({ load, save, reset });
}
