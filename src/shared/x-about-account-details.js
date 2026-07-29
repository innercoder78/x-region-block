import { createUnavailableLocation } from './location-model.js';
import { classifyXAboutAccountConnectionSource } from './x-about-account-connection.js';
import { parseXAboutAccountLocationPayload, X_ABOUT_ACCOUNT_LOCATION_SOURCE } from './x-about-account-location.js';

export const X_ABOUT_ACCOUNT_LOCATION_ACCURACY_STATES = Object.freeze([
  'accurate', 'vpn-proxy-detected', 'unknown',
]);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length
  && Reflect.ownKeys(value).every((key) => typeof key === 'string') && keys.every((key) => own(value, key));

const accuracy = (value) => value === false ? 'vpn-proxy-detected' : value === true ? 'accurate' : 'unknown';
export function createXAboutAccountDetails({ location, connection, locationAccuracy }) {
  if (!location || !Object.isFrozen(location) || !exact(connection, ['method', 'label', 'rawSource'])
    || !['web', 'ios', 'android', 'unknown'].includes(connection.method)
    || typeof connection.label !== 'string'
    || (connection.rawSource !== null && typeof connection.rawSource !== 'string')
    || !X_ABOUT_ACCOUNT_LOCATION_ACCURACY_STATES.includes(locationAccuracy)) throw new TypeError('Invalid About Account details');
  return Object.freeze({ location, connection: Object.freeze({ ...connection }), locationAccuracy });
}
export function createUnavailableXAboutAccountDetails() {
  return createXAboutAccountDetails({
    location: createUnavailableLocation({ source: X_ABOUT_ACCOUNT_LOCATION_SOURCE }),
    connection: classifyXAboutAccountConnectionSource(null), locationAccuracy: 'unknown',
  });
}
export function parseXAboutAccountDetailsPayload(payload) {
  if (!plain(payload)) throw new TypeError('X About Account payload must be a plain object');
  if (payload.version === 1) {
    if (!exact(payload, ['version', 'accountBasedIn'])) throw new TypeError('Invalid version 1 payload');
    return createXAboutAccountDetails({ location: parseXAboutAccountLocationPayload(payload),
      connection: classifyXAboutAccountConnectionSource(null), locationAccuracy: 'unknown' });
  }
  // Retain the established direct GraphQL parser path used by non-MAIN-world consumers.
  if (!own(payload, 'version')) return createXAboutAccountDetails({
    location: parseXAboutAccountLocationPayload(payload),
    connection: classifyXAboutAccountConnectionSource(null), locationAccuracy: 'unknown',
  });
  if (payload.version !== 2 || !exact(payload,
    ['version', 'accountBasedIn', 'source', 'locationAccurate'])) throw new TypeError('Invalid version 2 payload');
  const accountBasedIn = typeof payload.accountBasedIn === 'string' || payload.accountBasedIn === null
    ? payload.accountBasedIn : null;
  const source = typeof payload.source === 'string' || payload.source === null ? payload.source : null;
  const locationAccurate = typeof payload.locationAccurate === 'boolean' || payload.locationAccurate === null
    ? payload.locationAccurate : null;
  return createXAboutAccountDetails({
    location: parseXAboutAccountLocationPayload({ version: 1, accountBasedIn }),
    connection: classifyXAboutAccountConnectionSource(source), locationAccuracy: accuracy(locationAccurate),
  });
}
