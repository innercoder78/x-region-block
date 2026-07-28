import { getCountryCodeByName, getCountryName } from './country-names.js';
import {
  createKnownLocation,
  createMissingLocation,
  createUnavailableLocation,
  createUnknownLocation,
} from './location-model.js';

export const X_ABOUT_ACCOUNT_LOCATION_PARSER_VERSION = 1;
export const X_ABOUT_ACCOUNT_LOCATION_SOURCE = 'x-about-account';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readOwn(object, property) {
  if (!isPlainObject(object) || !Object.prototype.hasOwnProperty.call(object, property)) {
    return { usable: false };
  }
  return { usable: true, value: object[property] };
}

const unavailable = () => createUnavailableLocation({ source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });

/** Parses only the versioned, observed About Account response path. */
export function parseXAboutAccountLocationPayload(payload) {
  let topLevelIsPlain;
  try {
    topLevelIsPlain = isPlainObject(payload);
  } catch {
    topLevelIsPlain = false;
  }
  if (!topLevelIsPlain) throw new TypeError('X About Account payload must be a plain object');

  try {
    // MAIN-world lookups reduce the GraphQL response before it crosses into the extension world.
    if (payload.version === 1 && Object.prototype.hasOwnProperty.call(payload, 'accountBasedIn')) {
      if (Reflect.ownKeys(payload).length !== 2) return unavailable();
      const value = payload.accountBasedIn;
      if (value == null || (typeof value === 'string' && value.trim() === '')) {
        return createMissingLocation({ source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });
      }
      if (typeof value !== 'string') return unavailable();
      const rawLocation = value.trim();
      const countryCode = getCountryCodeByName(rawLocation);
      if (countryCode === null) {
        return createUnknownLocation({ rawLocation, source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });
      }
      return createKnownLocation({ countryCode, countryName: getCountryName(countryCode), rawLocation,
        source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });
    }
    let current = payload;
    for (const property of ['data', 'user_result_by_screen_name', 'result', 'about_profile']) {
      const next = readOwn(current, property);
      if (!next.usable) return unavailable();
      current = next.value;
    }
    if (!isPlainObject(current)) return unavailable();

    if (!Object.prototype.hasOwnProperty.call(current, 'account_based_in')) {
      return createMissingLocation({ source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });
    }
    const accountBasedIn = current.account_based_in;
    if (accountBasedIn == null) {
      return createMissingLocation({ source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });
    }
    if (typeof accountBasedIn !== 'string') return unavailable();

    const rawLocation = accountBasedIn.trim();
    if (rawLocation === '') {
      return createMissingLocation({ source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });
    }
    const countryCode = getCountryCodeByName(rawLocation);
    if (countryCode === null) {
      return createUnknownLocation({ rawLocation, source: X_ABOUT_ACCOUNT_LOCATION_SOURCE });
    }
    return createKnownLocation({
      countryCode,
      countryName: getCountryName(countryCode),
      rawLocation,
      source: X_ABOUT_ACCOUNT_LOCATION_SOURCE,
    });
  } catch {
    return unavailable();
  }
}
