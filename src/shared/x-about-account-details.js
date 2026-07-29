import { createLocationResult, createUnavailableLocation } from './location-model.js';
import {
  classifyXAboutAccountConnectionSource, X_ABOUT_ACCOUNT_SOURCE_LIMIT,
} from './x-about-account-connection.js';
import { parseXAboutAccountLocationPayload, X_ABOUT_ACCOUNT_LOCATION_SOURCE } from './x-about-account-location.js';

export const X_ABOUT_ACCOUNT_LOCATION_ACCURACY_STATES = Object.freeze([
  'accurate', 'vpn-proxy-detected', 'unknown',
]);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const data = (value, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !own(descriptor, 'value')) throw new TypeError('Accessors are not supported');
  return descriptor.value;
};
const exact = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length
  && Reflect.ownKeys(value).every((key) => typeof key === 'string')
  && keys.every((key) => own(value, key)
    && own(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));

const canonicalLocation = (location) => {
  const keys = ['status', 'countryCode', 'countryName', 'regionCode', 'regionName', 'rawLocation', 'source'];
  if (!exact(location, keys) || !Object.isFrozen(location)) throw new TypeError('Invalid canonical location');
  const input = Object.fromEntries(keys.map((key) => [key, data(location, key)]));
  const canonical = createLocationResult(input);
  if (keys.some((key) => canonical[key] !== input[key])) throw new TypeError('Invalid canonical location');
  return location;
};

const accuracy = (value) => value === false ? 'vpn-proxy-detected' : value === true ? 'accurate' : 'unknown';
export function createXAboutAccountDetails({ location, connection, locationAccuracy }) {
  if (!exact(connection, ['method', 'label', 'rawSource'])
    || !X_ABOUT_ACCOUNT_LOCATION_ACCURACY_STATES.includes(locationAccuracy)) throw new TypeError('Invalid About Account details');
  const method = data(connection, 'method');
  const label = data(connection, 'label');
  const suppliedRawSource = data(connection, 'rawSource');
  if (suppliedRawSource !== null && typeof suppliedRawSource !== 'string') throw new TypeError('Invalid raw source');
  const rawSource = suppliedRawSource === '' ? null : suppliedRawSource;
  if (rawSource !== null && (rawSource.length > X_ABOUT_ACCOUNT_SOURCE_LIMIT
    || rawSource.trim() !== rawSource)) throw new TypeError('Invalid raw source');
  const canonicalConnection = classifyXAboutAccountConnectionSource(rawSource);
  if (method !== canonicalConnection.method || label !== canonicalConnection.label) {
    throw new TypeError('Invalid canonical connection');
  }
  return Object.freeze({ location: canonicalLocation(location), connection: canonicalConnection, locationAccuracy });
}
export function createUnavailableXAboutAccountDetails() {
  return createXAboutAccountDetails({
    location: createUnavailableLocation({ source: X_ABOUT_ACCOUNT_LOCATION_SOURCE }),
    connection: classifyXAboutAccountConnectionSource(null), locationAccuracy: 'unknown',
  });
}
export function parseXAboutAccountDetailsPayload(payload) {
  if (!plain(payload)) throw new TypeError('X About Account payload must be a plain object');
  const versionDescriptor = Object.getOwnPropertyDescriptor(payload, 'version');
  if (versionDescriptor && !own(versionDescriptor, 'value')) throw new TypeError('Accessors are not supported');
  const version = versionDescriptor?.value;
  if (version === 1) {
    if (!exact(payload, ['version', 'accountBasedIn'])) throw new TypeError('Invalid version 1 payload');
    return createXAboutAccountDetails({ location: parseXAboutAccountLocationPayload(payload),
      connection: classifyXAboutAccountConnectionSource(null), locationAccuracy: 'unknown' });
  }
  // Retain the established direct GraphQL parser path used by non-MAIN-world consumers.
  if (!own(payload, 'version')) return createXAboutAccountDetails({
    location: parseXAboutAccountLocationPayload(payload),
    connection: classifyXAboutAccountConnectionSource(null), locationAccuracy: 'unknown',
  });
  if (version !== 2 || !exact(payload,
    ['version', 'accountBasedIn', 'source', 'locationAccurate'])) throw new TypeError('Invalid version 2 payload');
  const accountBasedIn = data(payload, 'accountBasedIn');
  const source = data(payload, 'source');
  const locationAccurate = data(payload, 'locationAccurate');
  if ((accountBasedIn !== null && typeof accountBasedIn !== 'string')
    || (source !== null && typeof source !== 'string')
    || (locationAccurate !== null && typeof locationAccurate !== 'boolean')) {
    throw new TypeError('Invalid version 2 field type');
  }
  return createXAboutAccountDetails({
    location: parseXAboutAccountLocationPayload({ version: 1, accountBasedIn }),
    connection: classifyXAboutAccountConnectionSource(source), locationAccuracy: accuracy(locationAccurate),
  });
}
