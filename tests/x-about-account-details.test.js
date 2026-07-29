import { describe, expect, it } from 'vitest';
import { classifyXAboutAccountConnectionSource } from '../src/shared/x-about-account-connection.js';
import { parseXAboutAccountDetailsPayload } from '../src/shared/x-about-account-details.js';

describe('About Account connection source classifier', () => {
  it.each([
    ['Web', 'web'], ['WEB', 'web'], ['  Web  ', 'web'],
    ['United States App Store', 'ios'], ['Portugal App Store', 'ios'], ['App Store', 'ios'],
    ['iOS', 'ios'], ['iPhone', 'ios'], ['iPad', 'ios'],
    ['Google Play', 'android'], ['Play Store', 'android'], ['Android', 'android'],
    [null, 'unknown'], [undefined, 'unknown'], ['', 'unknown'], ['unknown', 'unknown'],
    ['Linux Mint', 'unknown'], ['Browser maybe', 'unknown'], ['x'.repeat(257), 'unknown'],
  ])('classifies %s strictly as %s', (source, method) => {
    expect(classifyXAboutAccountConnectionSource(source).method).toBe(method);
  });
});

describe('immutable About Account details parsing', () => {
  it('keeps location independent from source and classifies false accuracy', () => {
    const details = parseXAboutAccountDetailsPayload({ version: 2, accountBasedIn: 'Canada',
      source: 'United States App Store', locationAccurate: false });
    expect(details.location.countryCode).toBe('CA');
    expect(details.connection).toEqual({ method: 'ios', label: 'Connection: iOS app',
      rawSource: 'United States App Store' });
    expect(details.locationAccuracy).toBe('vpn-proxy-detected');
    expect(Object.isFrozen(details)).toBe(true);
    expect(Object.isFrozen(details.connection)).toBe(true);
  });

  it('keeps regions independent and maps accuracy without coercion', () => {
    const region = parseXAboutAccountDetailsPayload({ version: 2, accountBasedIn: 'North America',
      source: 'Google Play', locationAccurate: true });
    expect(region.location).toMatchObject({ regionCode: 'NORTH_AMERICA', countryCode: null });
    expect(region.connection.method).toBe('android');
    expect(region.locationAccuracy).toBe('accurate');
    expect(parseXAboutAccountDetailsPayload({ version: 2, accountBasedIn: null,
      source: null, locationAccurate: null }).locationAccuracy).toBe('unknown');
  });

  it('reads compact version 1 with unknown metadata and requires exact compact keys', () => {
    expect(parseXAboutAccountDetailsPayload({ version: 1, accountBasedIn: 'Japan' }))
      .toMatchObject({ connection: { method: 'unknown' }, locationAccuracy: 'unknown',
        location: { countryCode: 'JP' } });
    expect(() => parseXAboutAccountDetailsPayload({ version: 2, accountBasedIn: 'Japan',
      source: null, locationAccurate: null, connectedVia: 'Web' })).toThrow();
  });
});
