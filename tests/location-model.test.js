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
