import { describe, expect, it } from 'vitest';
import {
  LOCATION_STATUSES,
  createHiddenLocation,
  createKnownLocation,
  createLocationResult,
  createMissingLocation,
  createUnavailableLocation,
  createUnknownLocation,
  isLocationStatus,
} from '../src/shared/location-model.js';

describe('location model', () => {
  it('normalizes a known country and region', () => {
    expect(
      createKnownLocation({
        countryCode: 'gb',
        countryName: 'United Kingdom',
        regionCode: 'europe',
        rawLocation: 'London',
        source: 'profile-display',
      }),
    ).toEqual({
      status: 'known',
      countryCode: 'GB',
      countryName: 'United Kingdom',
      regionCode: 'EUROPE',
      regionName: 'Europe',
      rawLocation: 'London',
      source: 'profile-display',
    });
  });

  it.each([
    ['AO', 'AFRICA'], ['JP', 'ASIA'], ['CY', 'EUROPE'], ['EG', 'MIDDLE_EAST'],
    ['CA', 'NORTH_AMERICA'], ['AU', 'OCEANIA'], ['GF', 'SOUTH_AMERICA'],
    ['PR', 'CARIBBEAN'], ['MX', 'CENTRAL_AMERICA'],
  ])('derives %s as %s', (countryCode, regionCode) => {
    expect(createKnownLocation({ countryCode, countryName: 'Name' }).regionCode).toBe(regionCode);
  });

  it.each([
    ['EG', 'MIDDLE_EAST'], ['IR', 'MIDDLE_EAST'], ['TR', 'MIDDLE_EAST'],
    ['PS', 'MIDDLE_EAST'], ['CY', 'EUROPE'], ['RU', 'EUROPE'], ['AM', 'ASIA'],
    ['AZ', 'ASIA'], ['GE', 'ASIA'], ['KZ', 'ASIA'], ['AW', 'CARIBBEAN'],
    ['FK', 'SOUTH_AMERICA'], ['BM', 'NORTH_AMERICA'], ['GL', 'NORTH_AMERICA'],
    ['PM', 'NORTH_AMERICA'],
  ])('preserves the explicit policy decision for %s', (countryCode, regionCode) => {
    expect(createKnownLocation({ countryCode, countryName: 'Name' }).regionCode).toBe(regionCode);
  });

  it('keeps Antarctica known with null region fields', () => {
    expect(createKnownLocation({ countryCode: 'AQ', countryName: 'Antarctica' })).toMatchObject({
      status: 'known', countryCode: 'AQ', regionCode: null, regionName: null,
    });
  });

  it('creates a minimal frozen region-only known location', () => {
    const result = createKnownLocation({ regionCode: 'north_america', regionName: 'North America',
      rawLocation: 'North America', source: 'x-about-account', connectedVia: 'Web' });
    expect(result).toEqual({ status: 'known', countryCode: null, countryName: null,
      regionCode: 'NORTH_AMERICA', regionName: 'North America', rawLocation: 'North America',
      source: 'x-about-account' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty('connectedVia');
  });

  it('rejects malformed region-only locations and partial countries', () => {
    expect(() => createKnownLocation({ regionCode: 'UNKNOWN', regionName: 'Unknown' })).toThrow();
    expect(() => createKnownLocation({ regionCode: 'ATLANTIS', regionName: 'Atlantis' })).toThrow();
    expect(() => createKnownLocation({ regionCode: 'EUROPE', regionName: 'Asia' })).toThrow();
    expect(() => createKnownLocation({ countryName: 'Canada', regionCode: 'NORTH_AMERICA',
      regionName: 'North America' })).toThrow();
  });

  it('accepts matching assertions and rejects conflicting assertions', () => {
    expect(createKnownLocation({
      countryCode: 'CA', countryName: 'Canada', regionCode: ' north_america ',
      regionName: 'North America',
    }).regionCode).toBe('NORTH_AMERICA');
    expect(() => createKnownLocation({
      countryCode: 'CA', countryName: 'Canada', regionCode: 'EUROPE',
    })).toThrow('regionCode must match');
    expect(() => createKnownLocation({
      countryCode: 'CA', countryName: 'Canada', regionName: 'Northern America',
    })).toThrow('regionName must match');
    expect(() => createKnownLocation({
      countryCode: 'AQ', countryName: 'Antarctica', regionCode: 'UNKNOWN',
    })).toThrow('does not support a region assertion');
  });

  it.each(['ZZ', 'UK', 'XK', 'EU'])('rejects unsupported known country code %s', (countryCode) => {
    expect(() => createKnownLocation({ countryCode, countryName: 'Name' })).toThrow(TypeError);
  });

  it.each([
    ['hidden', createHiddenLocation, 'private'],
    ['missing', createMissingLocation, null],
    ['unavailable', createUnavailableLocation, null],
    ['unknown', createUnknownLocation, 'Somewhere'],
  ])('keeps the %s state distinct', (status, factory, rawLocation) => {
    const result = factory({ rawLocation });
    expect(result.status).toBe(status);
    expect(isLocationStatus(result, status)).toBe(true);
    expect(result.rawLocation).toBe(rawLocation);
  });

  it('rejects invalid status values and incomplete known locations', () => {
    expect(() => createLocationResult({ status: 'maybe' })).toThrow('Unsupported location status');
    expect(() => createLocationResult({ status: 'known', countryCode: 'US' })).toThrow(
      'requires a countryName',
    );
  });

  it('is immutable and strips unrelated sensitive properties', () => {
    const result = createHiddenLocation({ token: 'secret', avatarUrl: 'https://example.test/a' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).toEqual([
      'status',
      'countryCode',
      'countryName',
      'regionCode',
      'regionName',
      'rawLocation',
      'source',
    ]);
  });

  it('removes geographic fields from every non-known result', () => {
    const result = createLocationResult({
      status: LOCATION_STATUSES.UNKNOWN,
      countryCode: 'US',
      countryName: 'United States',
      regionCode: 'NORTH_AMERICA',
      regionName: 'North America',
    });
    expect(result).toMatchObject({
      countryCode: null,
      countryName: null,
      regionCode: null,
      regionName: null,
    });
  });

  it('does not mutate its input', () => {
    const input = Object.freeze({ status: 'known', countryCode: 'ca', countryName: 'Canada' });
    createLocationResult(input);
    expect(input).toEqual({ status: 'known', countryCode: 'ca', countryName: 'Canada' });
  });
});
