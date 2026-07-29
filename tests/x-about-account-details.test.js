import { describe, expect, it, vi } from 'vitest';
import { classifyXAboutAccountConnectionSource } from '../src/shared/x-about-account-connection.js';
import {
  createXAboutAccountDetails, parseXAboutAccountDetailsPayload,
} from '../src/shared/x-about-account-details.js';
import { createKnownLocation } from '../src/shared/location-model.js';

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
  const canada = () => createKnownLocation({ countryCode: 'CA', countryName: 'Canada',
    rawLocation: 'Canada', source: 'x-about-account' });

  it.each([
    ['Web', 'web', 'Connection: Web'], ['App Store', 'ios', 'Connection: iOS app'],
    ['Google Play', 'android', 'Connection: Android app'], [null, 'unknown', 'Unknown connection method'],
  ])('constructs canonical %s connection details', (rawSource, method, label) => {
    const details = createXAboutAccountDetails({ location: canada(),
      connection: { method, label, rawSource }, locationAccuracy: 'unknown' });
    expect(details.connection).toEqual({ method, label, rawSource });
    expect(Object.isFrozen(details.location)).toBe(true);
  });

  it.each([
    { method: 'web', label: 'Connection: Android app', rawSource: 'Web' },
    { method: 'unknown', label: 'Connection: Web', rawSource: null },
    { method: 'unknown', label: 'Unknown connection method', rawSource: `x${'a'.repeat(256)}` },
    { method: 'web', label: 'Connection: Web', rawSource: ' Web ' },
  ])('rejects a noncanonical connection %#', (connection) => {
    expect(() => createXAboutAccountDetails({ location: canada(), connection,
      locationAccuracy: 'unknown' })).toThrow(TypeError);
  });

  it('normalizes an empty unknown raw source and rejects arbitrary frozen locations', () => {
    expect(createXAboutAccountDetails({ location: canada(), connection: {
      method: 'unknown', label: 'Unknown connection method', rawSource: '',
    }, locationAccuracy: 'unknown' }).connection.rawSource).toBeNull();
    expect(() => createXAboutAccountDetails({ location: Object.freeze({}), connection: {
      method: 'unknown', label: 'Unknown connection method', rawSource: null,
    }, locationAccuracy: 'unknown' })).toThrow(TypeError);
  });

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

  it.each([
    ['accountBasedIn', {}], ['accountBasedIn', []], ['accountBasedIn', 1],
    ['accountBasedIn', () => {}], ['accountBasedIn', Symbol('location')],
    ['source', {}], ['source', []], ['source', 1], ['source', () => {}], ['source', Symbol('source')],
    ['locationAccurate', {}], ['locationAccurate', []], ['locationAccurate', 0],
    ['locationAccurate', 'false'], ['locationAccurate', () => {}], ['locationAccurate', Symbol('accuracy')],
  ])('rejects malformed version-2 %s value', (field, value) => {
    const payload = { version: 2, accountBasedIn: 'Canada', source: 'Web', locationAccurate: false };
    payload[field] = value;
    expect(() => parseXAboutAccountDetailsPayload(payload)).toThrow(TypeError);
  });

  it('rejects accessors without invoking them', () => {
    const getter = vi.fn(() => 'Web');
    const payload = { version: 2, accountBasedIn: 'Canada', locationAccurate: null };
    Object.defineProperty(payload, 'source', { enumerable: true, get: getter });
    expect(() => parseXAboutAccountDetailsPayload(payload)).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
  });
});
