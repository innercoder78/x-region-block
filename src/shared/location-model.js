import { getRegion } from './regions.js';

export const LOCATION_STATUSES = Object.freeze({
  KNOWN: 'known',
  HIDDEN: 'hidden',
  MISSING: 'missing',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
});

const validStatuses = new Set(Object.values(LOCATION_STATUSES));

function optionalText(value, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string or null`);
  return value;
}

/**
 * Creates the complete, immutable, deliberately minimal location-result value.
 * Only the seven documented properties are copied, preventing request/account
 * metadata supplied alongside them from leaking into the domain result.
 */
export function createLocationResult(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('location input must be an object');
  }

  const status = input.status;
  if (!validStatuses.has(status)) {
    throw new TypeError(`Unsupported location status: ${String(status)}`);
  }

  const rawLocation = optionalText(input.rawLocation, 'rawLocation');
  const source = optionalText(input.source, 'source');
  let countryCode = null;
  let countryName = null;
  let regionCode = null;
  let regionName = null;

  if (status === LOCATION_STATUSES.KNOWN) {
    if (typeof input.countryCode !== 'string' || !/^[a-z]{2}$/i.test(input.countryCode)) {
      throw new TypeError('A known location requires a two-letter countryCode');
    }
    if (typeof input.countryName !== 'string' || input.countryName.trim() === '') {
      throw new TypeError('A known location requires a countryName');
    }
    countryCode = input.countryCode.toUpperCase();
    countryName = input.countryName;

    if (input.regionCode != null || input.regionName != null) {
      const region = getRegion(input.regionCode);
      if (!region || region.code === 'UNKNOWN') {
        throw new TypeError('A known region requires a supported regionCode');
      }
      if (input.regionName != null && input.regionName !== region.name) {
        throw new TypeError('regionName must match regionCode');
      }
      regionCode = region.code;
      regionName = region.name;
    }
  }

  return Object.freeze({
    status,
    countryCode,
    countryName,
    regionCode,
    regionName,
    rawLocation,
    source,
  });
}

/** Status predicates preserve the reason why a location is not classified. */
export function isLocationStatus(result, status) {
  if (!validStatuses.has(status)) return false;
  return result?.status === status;
}

export const createKnownLocation = (input) => createLocationResult({ ...input, status: 'known' });
export const createHiddenLocation = (input = {}) => createLocationResult({ ...input, status: 'hidden' });
export const createMissingLocation = (input = {}) => createLocationResult({ ...input, status: 'missing' });
export const createUnavailableLocation = (input = {}) =>
  createLocationResult({ ...input, status: 'unavailable' });
export const createUnknownLocation = (input = {}) => createLocationResult({ ...input, status: 'unknown' });
