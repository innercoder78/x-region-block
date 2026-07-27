import { readXAccountIdentityFromLink } from './account-link-reader.js';
import { evaluateFilterSubject } from '../shared/filter-subject.js';
import { createLocationDisplayModel } from '../shared/location-display.js';

export const ACCOUNT_EVALUATION_VERSION = 1;

const hasOwn = (value, property) => Object.prototype.hasOwnProperty.call(value, property);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Canonicalizes and evaluates one explicitly supplied account link and observation.
 * This boundary deliberately performs no discovery, rendering, lookup, or page mutation.
 */
export function evaluateXAccountLink(link, observation, settings) {
  if (!isPlainObject(observation)) {
    throw new TypeError('account observation must be a plain object');
  }
  if (hasOwn(observation, 'accountId')) {
    throw new TypeError('accountId is not supported by account evaluation');
  }

  const readerOptions = Object.create(null);
  if (hasOwn(observation, 'source')) readerOptions.source = observation.source;
  if (hasOwn(observation, 'baseUrl')) readerOptions.baseUrl = observation.baseUrl;

  const identity = readXAccountIdentityFromLink(link, readerOptions);
  if (identity === null) return null;

  if (!hasOwn(observation, 'location')) {
    throw new TypeError('account observation location is required');
  }
  const evaluation = evaluateFilterSubject({ identity, location: observation.location }, settings);
  const display = createLocationDisplayModel(evaluation.subject.location);
  return Object.freeze({
    version: ACCOUNT_EVALUATION_VERSION,
    subject: evaluation.subject,
    action: evaluation.action,
    display,
  });
}
