import { describe, expect, it } from 'vitest';
import { createDefaultSettings, normalizeSettings } from '../src/shared/settings-schema.js';
import { formModelToSettingsInput, settingsToFormModel, splitRuleList } from '../src/options/settings-form.js';

describe('settings form conversion', () => {
  it('splits comma, line, and mixed lists while trimming, removing empties, and retaining order', () => {
    expect(splitRuleList(' US, CA\n\nGB,US, ,MX\r\nCA ')).toEqual(['US', 'CA', 'GB', 'MX']);
  });

  it('converts every field without mutating the form model', () => {
    const model = { countryHide: 'us, ca', countryHighlight: 'gb', countryAlwaysShow: 'nz', regionHide: ['AFRICA'], regionHighlight: ['ASIA'], languageHighlight: 'EN, fr', tagHighlight: 'News\nLocal', otherHide: ['hidden', 'missing'], otherHighlight: ['unavailable', 'unknown'], allowlist: 'UserOne,userTwo' };
    const before = structuredClone(model);
    expect(formModelToSettingsInput(model)).toEqual({ country: { hide: ['us', 'ca'], highlight: ['gb'], alwaysShow: ['nz'] }, region: { hide: ['AFRICA'], highlight: ['ASIA'] }, language: { highlight: ['EN', 'fr'] }, tag: { highlight: ['News', 'Local'] }, other: { hide: ['hidden', 'missing'], highlight: ['unavailable', 'unknown'] }, allowlist: ['UserOne', 'userTwo'] });
    expect(model).toEqual(before);
  });

  it('populates every control from canonical settings without mutation', () => {
    const settings = normalizeSettings({ country: { hide: ['us'], highlight: ['ca'], alwaysShow: ['gb'] }, region: { hide: ['AFRICA'], highlight: ['EUROPE'] }, language: { highlight: ['EN'] }, tag: { highlight: ['NEWS'] }, other: { hide: ['hidden', 'missing'], highlight: ['unavailable', 'unknown'] }, allowlist: ['CaseKey'] });
    const model = settingsToFormModel(settings);
    expect(model).toEqual({ countryHide: 'US', countryHighlight: 'CA', countryAlwaysShow: 'GB', regionHide: ['AFRICA'], regionHighlight: ['EUROPE'], languageHighlight: 'en', tagHighlight: 'news', otherHide: ['hidden', 'missing'], otherHighlight: ['unavailable', 'unknown'], allowlist: 'CaseKey' });
    model.regionHide.push('ASIA');
    expect(settings.region.hide).toEqual(['AFRICA']);
  });

  it('populates empty defaults', () => expect(settingsToFormModel(createDefaultSettings()).allowlist).toBe(''));
});
