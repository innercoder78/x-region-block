import { createAccountIdentity } from './account-identity.js';
import { decideFilterAction } from './filter-engine.js';
import { createLocationResult } from './location-model.js';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeObservedValues(value, name) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);

  const normalized = [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new TypeError(`${name} entries must be non-empty strings`);
    }
    const canonical = entry.trim().toLowerCase();
    if (!seen.has(canonical)) {
      seen.add(canonical);
      normalized.push(canonical);
    }
  }
  return Object.freeze(normalized);
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
    languages: normalizeObservedValues(input.languages, 'languages'),
    tags: normalizeObservedValues(input.tags, 'tags'),
  });
}

/** Canonicalizes a subject and purely evaluates it against the supplied settings. */
export function evaluateFilterSubject(input, settings) {
  const subject = createFilterSubject(input);
  const action = decideFilterAction(subject, settings);
  return Object.freeze({ subject, action });
}
