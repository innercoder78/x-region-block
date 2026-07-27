import { LOCATION_STATUSES } from './location-model.js';

export const FILTER_ACTIONS = Object.freeze({ SHOW: 'show', HIGHLIGHT: 'highlight', HIDE: 'hide' });

const categories = ['country', 'region', 'other'];

function rules(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) && !(value instanceof Set)) {
    throw new TypeError(`${label} must be an array or Set`);
  }
  return value;
}

function category(settings, name) {
  const value = settings[name];
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || value instanceof Set) {
    throw new TypeError(`${name} settings must be an object`);
  }
  return value;
}

function includes(collection, candidate, normalize = (value) => value) {
  if (candidate == null) return false;
  const wanted = normalize(candidate);
  return Array.from(collection).some((value) => typeof value === 'string' && normalize(value) === wanted);
}

const upper = (value) => value.toUpperCase();
const lower = (value) => value.toLowerCase();

/**
 * Purely decides presentation for a subject. Malformed settings throw TypeError
 * rather than silently applying a potentially unsafe rule. Missing categories
 * and rule lists are empty. Supported schema:
 * country/region: { hide, highlight, alwaysShow };
 * other: { hide, highlight } (location statuses); allowlist: Array|Set.
 */
export function decideFilterAction(subject = {}, settings = {}) {
  if (subject === null || typeof subject !== 'object' || Array.isArray(subject)) {
    throw new TypeError('subject must be an object');
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new TypeError('settings must be an object');
  }

  const configured = Object.fromEntries(categories.map((name) => [name, category(settings, name)]));
  const allowlist = rules(settings.allowlist, 'allowlist');
  const location = subject.location;
  const known = location?.status === LOCATION_STATUSES.KNOWN;
  const country = known ? location.countryCode : null;
  const region = known ? location.regionCode : null;

  if (includes(allowlist, subject.allowlistKey)) return FILTER_ACTIONS.SHOW;
  if (includes(rules(configured.country.alwaysShow, 'country.alwaysShow'), country, upper)) {
    return FILTER_ACTIONS.SHOW;
  }
  if (includes(rules(configured.country.hide, 'country.hide'), country, upper)) {
    return FILTER_ACTIONS.HIDE;
  }
  if (includes(rules(configured.region.hide, 'region.hide'), region, upper)) {
    return FILTER_ACTIONS.HIDE;
  }
  if (!known && includes(rules(configured.other.hide, 'other.hide'), location?.status, lower)) {
    return FILTER_ACTIONS.HIDE;
  }

  const highlighted =
    includes(rules(configured.country.highlight, 'country.highlight'), country, upper) ||
    includes(rules(configured.region.highlight, 'region.highlight'), region, upper) ||
    (!known && includes(rules(configured.other.highlight, 'other.highlight'), location?.status, lower));

  return highlighted ? FILTER_ACTIONS.HIGHLIGHT : FILTER_ACTIONS.SHOW;
}
