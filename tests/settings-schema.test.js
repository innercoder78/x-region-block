import { describe, expect, it } from 'vitest';
import { decideFilterAction } from '../src/shared/filter-engine.js';
import { createKnownLocation, createUnknownLocation } from '../src/shared/location-model.js';
import {
  createDefaultSettings,
  DEFAULT_SETTINGS,
  migrateSettings,
  normalizeSettings,
  SETTINGS_SCHEMA_VERSION,
} from '../src/shared/settings-schema.js';

const shape = {
  schemaVersion: 2,
  country: { hide: [], highlight: [], alwaysShow: [] },
  region: { hide: [], highlight: [] },
  other: { hide: [], highlight: [] },
  allowlist: [],
};

function expectDeeplyFrozen(value) {
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') expectDeeplyFrozen(child);
  }
}

const knownSubject = {
  allowlistKey: 'Account-A',
  location: createKnownLocation({
    countryCode: 'CA',
    countryName: 'Canada',
    regionCode: 'NORTH_AMERICA',
  }),
};

describe('settings schema defaults', () => {
  it('exports schema version 2 and the complete canonical default shape', () => {
    expect(SETTINGS_SCHEMA_VERSION).toBe(2);
    expect(DEFAULT_SETTINGS).toEqual(shape);
    expect(createDefaultSettings()).toEqual(shape);
  });

  it('deeply freezes defaults without sharing their nested values', () => {
    const first = createDefaultSettings();
    const second = createDefaultSettings();
    expectDeeplyFrozen(DEFAULT_SETTINGS);
    expectDeeplyFrozen(first);
    expect(first).not.toBe(second);
    expect(first.country).not.toBe(second.country);
    expect(first.country.hide).not.toBe(second.country.hide);
  });
});

describe('settings normalization', () => {
  it('fills partial input, sets the current version, and deeply freezes the result', () => {
    const result = normalizeSettings({ country: { hide: [' ca '] } });
    expect(result).toEqual({ ...shape, country: { ...shape.country, hide: ['CA'] } });
    expectDeeplyFrozen(result);
  });

  it('normalizes countries and removes duplicates in first-seen order', () => {
    expect(normalizeSettings({ country: { hide: [' us ', 'CA', 'Us', 'mx'] } }).country.hide).toEqual([
      'US',
      'CA',
      'MX',
    ]);
  });

  it.each([['USA'], ['1A'], [''], [null]])('rejects invalid country entries in %j', (hide) => {
    expect(() => normalizeSettings({ country: { hide } })).toThrow(TypeError);
  });

  it.each(['ZZ', 'UK', 'XK', 'EU'])('rejects unsupported country code %s in every country list', (code) => {
    for (const field of ['hide', 'highlight', 'alwaysShow']) {
      expect(() => normalizeSettings({ country: { [field]: [code] } })).toThrow(TypeError);
    }
  });

  it('uses region lookup and stores canonical region codes', () => {
    expect(
      normalizeSettings({ region: { hide: [' north_america ', 'EUROPE', 'North_America'] } }).region.hide,
    ).toEqual(['NORTH_AMERICA', 'EUROPE']);
  });

  it.each(['invalid', 'UNKNOWN', 42])('rejects invalid or unknown region %j', (entry) => {
    expect(() => normalizeSettings({ region: { hide: [entry] } })).toThrow(TypeError);
  });

  it('discards removed and unknown properties, even when malformed', () => {
    const result = normalizeSettings({
      language: { highlight: 'EN' }, tag: null, languages: ['en'], tags: ['news'],
    });
    expect(result).toEqual(shape);
  });

  it('keeps every unknown-location status distinct and rejects known', () => {
    const statuses = [' Hidden ', 'MISSING', 'Unavailable', 'unknown'];
    expect(normalizeSettings({ other: { hide: statuses } }).other.hide).toEqual([
      'hidden',
      'missing',
      'unavailable',
      'unknown',
    ]);
    expect(() => normalizeSettings({ other: { hide: ['known'] } })).toThrow(TypeError);
    expect(() => normalizeSettings({ other: { hide: ['other'] } })).toThrow(TypeError);
  });

  it('preserves allowlist case and removes only exact duplicates', () => {
    expect(normalizeSettings({ allowlist: [' User ', 'user', 'User', 'Other'] }).allowlist).toEqual([
      'User',
      'user',
      'Other',
    ]);
  });

  it('discards unsupported properties at every level', () => {
    const result = normalizeSettings({
      display: { theme: 'dark' },
      country: { hide: [], database: ['CA'] },
      other: { highlight: [], history: true },
    });
    expect(result).toEqual(shape);
    expect('display' in result).toBe(false);
    expect('database' in result.country).toBe(false);
  });

  it.each([
    null,
    [],
    'settings',
    { country: [] },
    { region: null },
    { allowlist: new Set(['user']) },
  ])('rejects recognized malformed data %#', (input) => {
    expect(() => normalizeSettings(input)).toThrow(TypeError);
  });

  it('does not mutate its input and produces JSON-safe arrays', () => {
    const input = { country: { hide: [' ca '] }, extra: { retained: true } };
    const before = structuredClone(input);
    const result = normalizeSettings(input);
    expect(input).toEqual(before);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result.country.hide).toBeInstanceOf(Array);
  });
});

describe('settings migration', () => {
  it('returns defaults for missing settings', () => {
    expect(migrateSettings()).toEqual(shape);
    expect(migrateSettings(null)).toEqual(shape);
  });

  it('migrates unversioned and explicit version-0 settings while discarding removed rules', () => {
    expect(migrateSettings({ country: { hide: ['ca'] } }).country.hide).toEqual(['CA']);
    const explicit = migrateSettings({ schemaVersion: 0, tag: { highlight: ['News'] } });
    expect(explicit).toEqual(shape);
  });

  it('migrates version 1 and preserves location rules and allowlist only', () => {
    const result = migrateSettings({
      schemaVersion: 1,
      country: { hide: ['ca'], highlight: ['GB'], alwaysShow: ['NZ'] },
      region: { hide: ['AFRICA'], highlight: ['EUROPE'] },
      language: { highlight: ['en'] }, tag: { highlight: ['news'] },
      other: { hide: ['missing'], highlight: ['unknown'] }, allowlist: ['@Account'],
    });
    expect(result).toEqual({
      ...shape,
      country: { hide: ['CA'], highlight: ['GB'], alwaysShow: ['NZ'] },
      region: { hide: ['AFRICA'], highlight: ['EUROPE'] },
      other: { hide: ['missing'], highlight: ['unknown'] }, allowlist: ['@Account'],
    });
    expect(result).not.toHaveProperty('language');
    expect(result).not.toHaveProperty('tag');
  });

  it('normalizes current settings and drops unsupported fields', () => {
    expect(migrateSettings({ schemaVersion: 2, unsupported: true, allowlist: [' A '] })).toEqual({
      ...shape,
      allowlist: ['A'],
    });
  });

  it.each([-1, 3])('rejects unsupported schema version %j', (schemaVersion) => {
    expect(() => migrateSettings({ schemaVersion })).toThrow(RangeError);
  });

  it.each([1.5, '1', NaN])('rejects malformed schema version %j', (schemaVersion) => {
    expect(() => migrateSettings({ schemaVersion })).toThrow(TypeError);
  });
});

describe('filter-engine compatibility', () => {
  it('uses normalized settings directly for filter decisions', () => {
    const settings = normalizeSettings({ region: { hide: ['north_america'] } });
    expect(decideFilterAction(knownSubject, settings)).toBe('hide');
  });

  it('preserves always-show country precedence after normalization', () => {
    const settings = normalizeSettings({
      country: { alwaysShow: ['ca'], hide: ['CA'] },
      region: { hide: ['NORTH_AMERICA'] },
    });
    expect(decideFilterAction(knownSubject, settings)).toBe('show');
  });

  it('preserves allowlist precedence after migration', () => {
    const settings = migrateSettings({
      schemaVersion: 0,
      allowlist: ['Account-A'],
      country: { hide: ['CA'] },
    });
    expect(decideFilterAction(knownSubject, settings)).toBe('show');
  });

  it('filters unknown locations after normalization', () => {
    const settings = normalizeSettings({ other: { hide: [' UNKNOWN '] } });
    expect(decideFilterAction({ location: createUnknownLocation() }, settings)).toBe('hide');
  });
});
