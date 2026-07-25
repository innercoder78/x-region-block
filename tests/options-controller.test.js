import { describe, expect, it, vi } from 'vitest';
import { createOptionsController } from '../src/options/options-controller.js';
import { createDefaultSettings, normalizeSettings } from '../src/shared/settings-schema.js';

function setup(overrides = {}) {
  const model = { countryHide: 'bad input', countryHighlight: '', countryAlwaysShow: '', regionHide: [], regionHighlight: [], languageHighlight: '', tagHighlight: '', otherHide: [], otherHighlight: [], allowlist: '' };
  const defaults = createDefaultSettings();
  const repository = { initializeSettings: vi.fn().mockResolvedValue(defaults), saveSettings: vi.fn().mockResolvedValue(defaults), resetSettings: vi.fn().mockResolvedValue(defaults), ...overrides };
  const view = { setEnabled: vi.fn(), setActionsEnabled: vi.fn(), showStatus: vi.fn(), readModel: vi.fn(() => structuredClone(model)), writeModel: vi.fn() };
  return { repository, view, model, controller: createOptionsController({ repository, view, confirmReset: overrides.confirmReset ?? (() => true) }) };
}

describe('options controller', () => {
  it('disables during load, initializes missing settings through the repository, then populates and enables', async () => {
    const { controller, repository, view } = setup(); const pending = controller.load();
    expect(view.setEnabled).toHaveBeenCalledWith(false); await pending;
    expect(repository.initializeSettings).toHaveBeenCalledOnce(); expect(view.writeModel).toHaveBeenCalled();
    expect(view.setEnabled).toHaveBeenLastCalledWith(true); expect(view.showStatus).toHaveBeenLastCalledWith('Settings ready.', 'success');
  });
  it('keeps the form disabled and exposes no stored contents on load failure', async () => {
    const secret = 'SECRET_SETTING'; const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { controller, view } = setup({ initializeSettings: vi.fn().mockRejectedValue(new Error(secret)) }); await controller.load();
    expect(view.setEnabled).not.toHaveBeenCalledWith(true); expect(view.showStatus.mock.calls.flat().join(' ')).not.toContain(secret); expect(consoleSpy).toHaveBeenCalledOnce(); consoleSpy.mockRestore();
  });
  it('saves and displays repository-normalized canonical values', async () => {
    const canonical = normalizeSettings({ country: { hide: ['us'] } }); const { controller, repository, view } = setup({ saveSettings: vi.fn().mockResolvedValue(canonical) }); await controller.save();
    expect(repository.saveSettings).toHaveBeenCalled(); expect(view.writeModel.mock.calls[0][0].countryHide).toBe('US'); expect(view.showStatus).toHaveBeenLastCalledWith('Settings saved.', 'success'); expect(view.setActionsEnabled).toHaveBeenLastCalledWith(true);
  });
  it.each([[new TypeError('country.hide entries must be two-letter country codes'), 'two-letter'], [new Error('SECRET'), 'local storage']])('preserves input and reports safe save errors', async (error, message) => {
    const { controller, view } = setup({ saveSettings: vi.fn().mockRejectedValue(error) }); await controller.save();
    expect(view.writeModel).not.toHaveBeenCalled(); expect(view.showStatus.mock.calls.at(-1)[0]).toContain(message);
  });
  it('prevents duplicate saves and cleans up busy state', async () => {
    let resolve; const saveSettings = vi.fn(() => new Promise((done) => { resolve = done; })); const { controller, view } = setup({ saveSettings }); const first = controller.save(); await controller.save(); expect(saveSettings).toHaveBeenCalledOnce(); resolve(createDefaultSettings()); await first; expect(view.setActionsEnabled).toHaveBeenLastCalledWith(true);
  });
  it('resets after confirmation and repopulates defaults', async () => {
    const { controller, repository, view } = setup(); await controller.reset(); expect(repository.resetSettings).toHaveBeenCalledOnce(); expect(view.writeModel).toHaveBeenCalled(); expect(view.showStatus).toHaveBeenLastCalledWith('Settings reset to defaults.', 'success');
  });
  it('does nothing when reset is cancelled', async () => {
    const { controller, repository } = setup({ confirmReset: () => false }); await controller.reset(); expect(repository.resetSettings).not.toHaveBeenCalled();
  });
  it('reports reset storage failure and cleans up busy state', async () => {
    const { controller, view } = setup({ resetSettings: vi.fn().mockRejectedValue(new Error('SECRET')) }); await controller.reset(); expect(view.writeModel).not.toHaveBeenCalled(); expect(view.showStatus.mock.calls.at(-1)[0]).not.toContain('SECRET'); expect(view.setActionsEnabled).toHaveBeenLastCalledWith(true);
  });
});
