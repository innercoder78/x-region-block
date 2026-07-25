import { parseXAccountReference } from '../shared/account-identity.js';

export const ACCOUNT_LINK_READER_VERSION = 1;

const hasOwn = (value, property) => Object.prototype.hasOwnProperty.call(value, property);

function validateLink(link) {
  if (
    link === null ||
    typeof link !== 'object' ||
    Array.isArray(link) ||
    typeof link.tagName !== 'string' ||
    link.tagName.toLowerCase() !== 'a' ||
    link.ownerDocument === null ||
    typeof link.ownerDocument !== 'object' ||
    typeof link.getAttribute !== 'function'
  ) {
    throw new TypeError('Invalid X account link');
  }
}

function validateOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Invalid account link options');
  }
  if (hasOwn(options, 'accountId')) {
    throw new TypeError('accountId is not supported by the account link reader');
  }
}

function readRawHref(link) {
  try {
    const href = link.getAttribute('href');
    if (typeof href !== 'string' || href.trim() === '') return null;
    return href.trim();
  } catch {
    return null;
  }
}

function readBaseUrl(link, options) {
  try {
    return hasOwn(options, 'baseUrl') ? options.baseUrl : link.ownerDocument.baseURI;
  } catch {
    return undefined;
  }
}

/**
 * Reads one explicitly supplied anchor without discovering or retaining DOM.
 */
export function readXAccountIdentityFromLink(link, options = {}) {
  validateLink(link);
  validateOptions(options);

  const reference = readRawHref(link);
  if (reference === null) return null;

  const rootRelative = reference.startsWith('/') && !reference.startsWith('//');
  const absoluteHttps = /^https:\/\//i.test(reference);
  if (!rootRelative && !absoluteHttps) return null;

  const parseOptions = rootRelative ? { baseUrl: readBaseUrl(link, options) } : undefined;
  const identity = parseXAccountReference(reference, parseOptions);
  if (identity === null) return null;

  // A direct handle makes the shared identity validator surface invalid source
  // values while still returning the existing canonical immutable value.
  return parseXAccountReference(identity.handle, { source: options.source });
}
