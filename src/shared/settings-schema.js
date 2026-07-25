import { getRegion, REGION_CODES } from './regions.js';
import { normalizeCountryCode } from './country-regions.js';

export const SETTINGS_SCHEMA_VERSION = 1;

const OTHER_STATUSES = new Set(['hidden', 'missing', 'unavailable', 'unknown']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function freezeSettings(settings) {
  for (const category of ['country', 'region', 'language', 'tag', 'other']) {
    for (const values of Object.values(settings[category])) Object.freeze(values);
    Object.freeze(settings[category]);
  }
  Object.freeze(settings.allowlist);
  return Object.freeze(settings);
}

function emptySettings() {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    country: { hide: [], highlight: [], alwaysShow: [] },
    region: { hide: [], highlight: [] },
    language: { highlight: [] },
    tag: { highlight: [] },
    other: { hide: [], highlight: [] },
    allowlist: [],
  };
}

/** Returns a new complete default tree; no mutable values are shared with callers. */
export function createDefaultSettings() {
  return freezeSettings(emptySettings());
}

export const DEFAULT_SETTINGS = createDefaultSettings();

function category(input, name) {
  if (!(name in input)) return {};
  if (!isPlainObject(input[name])) throw new TypeError(`${name} must be a plain object`);
  return input[name];
}

function list(input, name) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new TypeError(`${name} must be an array`);
  return input;
}

function unique(values, normalize, name) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalize(value, name);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function stringValue(value, name, transform) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} entries must be non-empty strings`);
  }
  return transform(value.trim());
}

function countryCode(value, name) {
  try {
    return normalizeCountryCode(value);
  } catch {
    throw new TypeError(`${name} entries must be supported country codes`);
  }
}

function regionCode(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} entries must be supported region codes`);
  const region = getRegion(value);
  if (region === null || region.code === REGION_CODES.UNKNOWN) {
    throw new TypeError(`${name} entries must be supported non-UNKNOWN region codes`);
  }
  return region.code;
}

function otherStatus(value, name) {
  const status = stringValue(value, name, (entry) => entry.toLowerCase());
  if (!OTHER_STATUSES.has(status)) throw new TypeError(`${name} contains unsupported location status: ${status}`);
  return status;
}

/**
 * Recognized fields are strict: malformed categories, lists, and entries throw.
 * Unknown properties are intentionally omitted from the canonical result.
 */
export function normalizeSettings(input) {
  if (!isPlainObject(input)) throw new TypeError('settings must be a plain object');

  const country = category(input, 'country');
  const region = category(input, 'region');
  const language = category(input, 'language');
  const tag = category(input, 'tag');
  const other = category(input, 'other');
  const normalizeText = (value, name) => stringValue(value, name, (entry) => entry.toLowerCase());
  const settings = emptySettings();

  settings.country.hide = unique(list(country.hide, 'country.hide'), countryCode, 'country.hide');
  settings.country.highlight = unique(
    list(country.highlight, 'country.highlight'),
    countryCode,
    'country.highlight',
  );
  settings.country.alwaysShow = unique(
    list(country.alwaysShow, 'country.alwaysShow'),
    countryCode,
    'country.alwaysShow',
  );
  settings.region.hide = unique(list(region.hide, 'region.hide'), regionCode, 'region.hide');
  settings.region.highlight = unique(
    list(region.highlight, 'region.highlight'),
    regionCode,
    'region.highlight',
  );
  settings.language.highlight = unique(
    list(language.highlight, 'language.highlight'),
    normalizeText,
    'language.highlight',
  );
  settings.tag.highlight = unique(list(tag.highlight, 'tag.highlight'), normalizeText, 'tag.highlight');
  settings.other.hide = unique(list(other.hide, 'other.hide'), otherStatus, 'other.hide');
  settings.other.highlight = unique(
    list(other.highlight, 'other.highlight'),
    otherStatus,
    'other.highlight',
  );
  settings.allowlist = unique(
    list(input.allowlist, 'allowlist'),
    (value, name) => stringValue(value, name, (entry) => entry),
    'allowlist',
  );

  return freezeSettings(settings);
}

/** Migrates only the defined unversioned/version-0 shape into the current schema. */
export function migrateSettings(input) {
  if (input === undefined || input === null) return createDefaultSettings();
  if (!isPlainObject(input)) throw new TypeError('settings must be a plain object');

  const version = 'schemaVersion' in input ? input.schemaVersion : 0;
  if (!Number.isInteger(version)) throw new TypeError('schemaVersion must be an integer');
  if (version < 0 || version > SETTINGS_SCHEMA_VERSION) {
    throw new RangeError(`unsupported settings schema version: ${version}`);
  }
  return normalizeSettings(input);
}
