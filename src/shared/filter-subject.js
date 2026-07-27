import { createAccountIdentity } from './account-identity.js';
import { decideFilterAction } from './filter-engine.js';
import { createLocationResult } from './location-model.js';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Creates the minimal, deeply immutable input accepted by the filter engine. */
export function createFilterSubject(input) {
  if (!isPlainObject(input)) throw new TypeError('filter subject input must be a plain object');
  if (!isPlainObject(input.identity)) throw new TypeError('identity must be a plain object');
  if (!isPlainObject(input.location)) throw new TypeError('location must be a plain object');

  const identity = createAccountIdentity(input.identity);
  const location = createLocationResult(input.location);
  return Object.freeze({
    identity,
    allowlistKey: identity.allowlistKey,
    location,
  });
}

/** Canonicalizes a subject and purely evaluates it against the supplied settings. */
export function evaluateFilterSubject(input, settings) {
  const subject = createFilterSubject(input);
  const action = decideFilterAction(subject, settings);
  return Object.freeze({ subject, action });
}
