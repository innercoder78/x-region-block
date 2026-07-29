import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  LOCATION_DISPLAY_MODEL_VERSION,
  LOCATION_STATUS_LABELS,
  createLocationDisplayModel,
} from '../src/shared/location-display.js';

const topLevelKeys = ['version', 'status', 'country', 'region'];
const countryKeys = ['code', 'name', 'label', 'title', 'ariaLabel'];
const regionKeys = ['code', 'name', 'symbol', 'label', 'title', 'ariaLabel'];

describe('known location display model', () => {
  it.each([
    ['AO', 'Angola', 'AFRICA', 'Africa'],
    ['JP', 'Japan', 'ASIA', 'Asia'],
    ['GB', 'United Kingdom', 'EUROPE', 'Europe'],
    ['AE', 'United Arab Emirates', 'MIDDLE_EAST', 'Middle East'],
    ['CA', 'Canada', 'NORTH_AMERICA', 'North America'],
    ['AU', 'Australia', 'OCEANIA', 'Oceania'],
    ['BR', 'Brazil', 'SOUTH_AMERICA', 'South America'],
    ['JM', 'Jamaica', 'CARIBBEAN', 'Caribbean'],
    ['CR', 'Costa Rica', 'CENTRAL_AMERICA', 'Central America'],
  ])('creates exact country-only presentation data for %s', (code, name) => {
    const model = createLocationDisplayModel({ status: 'known', countryCode: code, countryName: name });
    expect(Object.keys(model)).toEqual(topLevelKeys);
    expect(Object.keys(model.country)).toEqual(countryKeys);
    expect(model.region).toBeNull();
    expect(model).toEqual({
      version: LOCATION_DISPLAY_MODEL_VERSION,
      status: 'known',
      country: { code, name, label: name, title: name, ariaLabel: `Country: ${name}` },
      region: null,
    });
  });

  it('creates exact presentation data for a region-only known location', () => {
    const model = createLocationDisplayModel({ status: 'known', countryCode: null,
      countryName: null, regionCode: 'NORTH_AMERICA', regionName: 'North America' });
    expect(model.country).toBeNull();
    expect(Object.keys(model.region)).toEqual(regionKeys);
    expect(model.region).toEqual({ code: 'NORTH_AMERICA', name: 'North America', symbol: '🌐',
      label: 'North America', title: 'North America', ariaLabel: 'Region: North America' });
  });

  it('normalizes code, trims names, and preserves internal punctuation and case', () => {
    const model = createLocationDisplayModel({
      status: 'known', countryCode: ' ca ', countryName: "  mC'Donald <Example>  ",
    });
    expect(model.country).toMatchObject({ code: 'CA', name: "mC'Donald <Example>", label: "mC'Donald <Example>" });
  });

  it('accepts matching region assertions and rejects mismatches through the location model', () => {
    expect(createLocationDisplayModel({
      status: 'known', countryCode: 'CA', countryName: 'Canada',
      regionCode: ' north_america ', regionName: 'North America',
    }).region).toBeNull();
    expect(() => createLocationDisplayModel({
      status: 'known', countryCode: 'CA', countryName: 'Canada', regionCode: 'EUROPE',
    })).toThrow('regionCode must match the country region');
  });

  it('keeps Antarctica known while presenting an unknown region', () => {
    const antarctica = createLocationDisplayModel({ status: 'known', countryCode: 'AQ', countryName: 'Antarctica' });
    const unknown = createLocationDisplayModel({ status: 'unknown' });
    expect(antarctica).toEqual({
      version: 1, status: 'known',
      country: { code: 'AQ', name: 'Antarctica', label: 'Antarctica', title: 'Antarctica', ariaLabel: 'Country: Antarctica' },
      region: null,
    });
    expect(antarctica).not.toEqual(unknown);
  });
});

describe('non-known location display model', () => {
  const cases = [
    ['hidden', 'Location hidden'], ['missing', 'Location not provided'],
    ['unavailable', 'Location unavailable'], ['unknown', 'Location unknown'],
  ];

  it('exports the exact deeply frozen status labels', () => {
    expect(LOCATION_STATUS_LABELS).toEqual(Object.fromEntries(cases));
    expect(Object.keys(LOCATION_STATUS_LABELS)).toEqual(cases.map(([status]) => status));
    expect(Object.isFrozen(LOCATION_STATUS_LABELS)).toBe(true);
  });

  it.each(cases)('preserves %s with its exact label', (status, label) => {
    const model = createLocationDisplayModel({ status, rawLocation: 'secret', source: 'private' });
    expect(model).toEqual({
      version: 1, status, country: null,
      region: { code: null, name: null, symbol: '🌐', label, title: label, ariaLabel: label },
    });
    expect('rawLocation' in model).toBe(false);
    expect('source' in model).toBe(false);
  });
});

describe('location display safety and immutability', () => {
  it('does not mutate frozen input and strips arbitrary and sensitive properties', () => {
    const input = Object.freeze({
      status: 'known', countryCode: 'ca', countryName: ' Canada ', token: 'secret',
      url: 'https://example.test', arbitrary: Object.freeze({ nested: true }),
    });
    const before = structuredClone(input);
    const model = createLocationDisplayModel(input);
    expect(input).toEqual(before);
    expect(Object.keys(model)).toEqual(topLevelKeys);
    expect(JSON.stringify(model)).not.toContain('secret');
  });

  it('returns fresh, deeply frozen, structurally equal models', () => {
    const input = { status: 'known', countryCode: 'CA', countryName: 'Canada' };
    const first = createLocationDisplayModel(input);
    const second = createLocationDisplayModel(structuredClone(input));
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.country).not.toBe(second.country);
    expect([first, first.country].every(Object.isFrozen)).toBe(true);
  });

  it('returns markup-like names unchanged as plain string data', () => {
    const model = createLocationDisplayModel({ status: 'known', countryCode: 'CA', countryName: '<Example>' });
    expect(model.country.name).toBe('<Example>');
    expect(model.country.title).toBe('<Example>');
  });

  it('rejects malformed locations through the canonical location model', () => {
    expect(() => createLocationDisplayModel({ status: 'known', countryCode: 'CA' })).toThrow(TypeError);
    expect(() => createLocationDisplayModel({ status: 'invented' })).toThrow(TypeError);
  });

  it('uses no browser, DOM, network, storage, messaging, navigation, or timer APIs', async () => {
    const fetchSpy = vi.fn();
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy;
    try {
      createLocationDisplayModel({ status: 'known', countryCode: 'CA', countryName: 'Canada' });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(timeoutSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      timeoutSpy.mockRestore();
    }
    const source = await readFile('src/shared/location-display.js', 'utf8');
    expect(source).not.toMatch(/globalThis\.document|globalThis\.window|MutationObserver|innerHTML|insertAdjacentHTML|DOMParser|fetch|XMLHttpRequest|localStorage|sessionStorage|runtime\.sendMessage|globalThis\.location|setTimeout|setInterval/);
  });
});
