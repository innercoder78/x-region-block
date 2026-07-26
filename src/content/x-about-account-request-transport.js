import { createAccountIdentity } from '../shared/account-identity.js';
import { X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION } from './x-about-account-payload-broker.js';

export const X_ABOUT_ACCOUNT_REQUEST_TRANSPORT_VERSION = 1;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const REQUEST_ERROR = 'Invalid X About Account request transport request';
const DESCRIPTOR_ERROR = 'Invalid X About Account request descriptor';
const RESPONSE_ERROR = 'Invalid X About Account response';
const IDENTITY_KEYS = Object.freeze([
  'handle', 'displayHandle', 'profileUrl', 'accountId', 'allowlistKey', 'source',
]);
const CONTEXT_KEYS = Object.freeze(['version', 'signal']);
const DESCRIPTOR_KEYS = Object.freeze(['url', 'headers']);
const OPTION_KEYS = Object.freeze(['fetch', 'createRequest']);
const QUERY_NAMES = new Set(['variables', 'features', 'fieldToggles']);
const HEADER_NAMES = new Set([
  'authorization',
  'x-csrf-token',
  'x-twitter-active-user',
  'x-twitter-auth-type',
  'x-twitter-client-language',
  'x-guest-token',
  'x-client-transaction-id',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && keys.every((key) => hasOwn(value, key));
}

function abortError() {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function isAborted(signal) {
  try { return signal.aborted === true; } catch { return false; }
}

function validatePublicRequest(identity, context) {
  try {
    if (!hasExactKeys(identity, IDENTITY_KEYS) || !hasExactKeys(context, CONTEXT_KEYS)) return null;
    const canonical = createAccountIdentity({
      handle: identity.handle,
      accountId: identity.accountId,
      source: identity.source,
    });
    if (canonical.source !== null
      || IDENTITY_KEYS.some((key) => canonical[key] !== identity[key])
      || context.version !== X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION) return null;
    const signal = context.signal;
    if (signal === null || typeof signal !== 'object'
      || typeof signal.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function'
      || typeof signal.removeEventListener !== 'function') return null;
    return signal;
  } catch {
    return null;
  }
}

function parseObjectParameter(value) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new TypeError(DESCRIPTOR_ERROR); }
  if (!isPlainObject(parsed)) throw new TypeError(DESCRIPTOR_ERROR);
  return parsed;
}

function containsControl(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function canonicalizeUrl(value, handle) {
  if (typeof value !== 'string' || value.trim() !== value
    || containsControl(value) || value.includes('\\')
    || !/^https:\/\/(?:x\.com|twitter\.com)\//.test(value) || value.includes('#')) {
    throw new TypeError(DESCRIPTOR_ERROR);
  }
  const supplied = /^https:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?$/.exec(value);
  if (!supplied) throw new TypeError(DESCRIPTOR_ERROR);
  const [, authority, rawPathname, rawQuery] = supplied;
  let url;
  try { url = new URL(value); } catch { throw new TypeError(DESCRIPTOR_ERROR); }
  if ((url.hostname !== 'x.com' && url.hostname !== 'twitter.com')
    || url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.port !== '' || url.hash !== '') throw new TypeError(DESCRIPTOR_ERROR);
  if (authority !== url.host || rawPathname === '' || rawPathname.endsWith('/')
    || rawPathname.includes('//')) throw new TypeError(DESCRIPTOR_ERROR);
  const rawSegments = rawPathname.slice(1).split('/');
  if (rawSegments.length !== 5) throw new TypeError(DESCRIPTOR_ERROR);
  const segments = rawSegments.map((segment) => {
    if (segment === '' || segment.includes('\\') || containsControl(segment)) {
      throw new TypeError(DESCRIPTOR_ERROR);
    }
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { throw new TypeError(DESCRIPTOR_ERROR); }
    if (decoded.includes('/') || decoded.includes('\\') || containsControl(decoded)
      || decoded === '.' || decoded === '..') throw new TypeError(DESCRIPTOR_ERROR);
    return decoded;
  });
  const [first, second, third, queryId, operation] = segments;
  if (first !== 'i' || second !== 'api' || third !== 'graphql'
    || operation !== 'UserByScreenName' || !/^[A-Za-z0-9_-]{1,256}$/.test(queryId)) {
    throw new TypeError(DESCRIPTOR_ERROR);
  }

  const parameters = Object.create(null);
  if (rawQuery === undefined || rawQuery === '') throw new TypeError(DESCRIPTOR_ERROR);
  for (const component of rawQuery.split('&')) {
    const separator = component.indexOf('=');
    const encodedName = separator < 0 ? component : component.slice(0, separator);
    const encodedValue = separator < 0 ? '' : component.slice(separator + 1);
    let name;
    let decodedValue;
    try {
      name = decodeURIComponent(encodedName.replace(/\+/g, ' '));
      decodedValue = decodeURIComponent(encodedValue.replace(/\+/g, ' '));
    } catch {
      throw new TypeError(DESCRIPTOR_ERROR);
    }
    if (!QUERY_NAMES.has(name) || hasOwn(parameters, name)) throw new TypeError(DESCRIPTOR_ERROR);
    parameters[name] = parseObjectParameter(decodedValue);
  }
  if (!hasOwn(parameters, 'variables')
    || !hasOwn(parameters.variables, 'screen_name')
    || parameters.variables.screen_name !== handle) throw new TypeError(DESCRIPTOR_ERROR);

  const canonicalParameters = new URLSearchParams();
  for (const name of ['variables', 'features', 'fieldToggles']) {
    if (hasOwn(parameters, name)) canonicalParameters.set(name, JSON.stringify(parameters[name]));
  }
  return `${url.origin}/i/api/graphql/${queryId}/UserByScreenName?${canonicalParameters}`;
}

function canonicalizeHeaders(value) {
  if (!isPlainObject(value)) throw new TypeError(DESCRIPTOR_ERROR);
  let keys;
  try { keys = Reflect.ownKeys(value); } catch { throw new TypeError(DESCRIPTOR_ERROR); }
  if (keys.some((key) => typeof key !== 'string')) throw new TypeError(DESCRIPTOR_ERROR);
  const headers = Object.create(null);
  for (const key of keys) {
    const normalized = key.toLowerCase();
    if (!HEADER_NAMES.has(normalized) || hasOwn(headers, normalized)) {
      throw new TypeError(DESCRIPTOR_ERROR);
    }
    let headerValue;
    try { headerValue = value[key]; } catch { throw new TypeError(DESCRIPTOR_ERROR); }
    if (typeof headerValue !== 'string' || headerValue.length === 0
      || containsControl(headerValue)) throw new TypeError(DESCRIPTOR_ERROR);
    headers[normalized] = headerValue;
  }
  if (!hasOwn(headers, 'authorization') || !hasOwn(headers, 'x-csrf-token')) {
    throw new TypeError(DESCRIPTOR_ERROR);
  }
  headers.accept = 'application/json';
  return headers;
}

function prepareDescriptor(descriptor, handle) {
  try {
    if (!hasExactKeys(descriptor, DESCRIPTOR_KEYS)) throw new TypeError();
    const url = descriptor.url;
    const headers = descriptor.headers;
    return { url: canonicalizeUrl(url, handle), headers: canonicalizeHeaders(headers) };
  } catch {
    throw new TypeError(DESCRIPTOR_ERROR);
  }
}

function ownInvalidThenable(value) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  let then;
  try { then = value.then; } catch { throw new TypeError(DESCRIPTOR_ERROR); }
  if (typeof then !== 'function') return false;
  const discard = () => undefined;
  try { then.call(value, discard, discard); } catch { /* Invalid metadata stays private. */ }
  // Reading and invoking `then` here owns both outcomes without ever accepting
  // asynchronous metadata; repeated callback attempts are harmless discards.
  return true;
}

function captureResponse(response) {
  try {
    if (response === null || typeof response !== 'object') throw new TypeError();
    const ok = response.ok;
    const status = response.status;
    const json = response.json;
    if (typeof ok !== 'boolean' || !Number.isInteger(status) || status < 100 || status > 599
      || typeof json !== 'function') throw new TypeError();
    return { ok, json };
  } catch {
    throw new TypeError(RESPONSE_ERROR);
  }
}

export function createXAboutAccountRequestTransport(options) {
  let prototype;
  try { prototype = Object.getPrototypeOf(options); } catch { prototype = undefined; }
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || (prototype !== null && prototype !== Object.prototype)) {
    throw new TypeError('X About Account request transport options must be a plain object');
  }
  let ownKeys;
  try { ownKeys = Reflect.ownKeys(options); } catch {
    throw new TypeError('Invalid X About Account request transport options');
  }
  if (ownKeys.length !== OPTION_KEYS.length
    || ownKeys.some((key) => typeof key !== 'string')
    || !OPTION_KEYS.every((key) => hasOwn(options, key))) {
    throw new TypeError('Invalid X About Account request transport options');
  }
  let fetchDependency;
  let createRequest;
  try {
    fetchDependency = options.fetch;
    createRequest = options.createRequest;
  } catch {
    throw new TypeError('Invalid X About Account request transport options');
  }
  if (typeof fetchDependency !== 'function') throw new TypeError('fetch must be a function');
  if (typeof createRequest !== 'function') throw new TypeError('createRequest must be a function');

  function loadPayload(identity, context) {
    const signal = validatePublicRequest(identity, context);
    if (signal === null) return Promise.reject(new TypeError(REQUEST_ERROR));
    if (isAborted(signal)) return Promise.reject(abortError());
    let descriptor;
    try {
      descriptor = createRequest(identity, Object.freeze({
        version: X_ABOUT_ACCOUNT_REQUEST_TRANSPORT_VERSION,
      }));
    } catch {
      return Promise.reject(isAborted(signal)
        ? abortError() : new Error('Unable to prepare X About Account request'));
    }
    let prepared;
    try {
      if (ownInvalidThenable(descriptor)) throw new TypeError(DESCRIPTOR_ERROR);
      prepared = prepareDescriptor(descriptor, identity.handle);
    } catch (error) {
      return Promise.reject(isAborted(signal) ? abortError() : error);
    }
    descriptor = null;
    if (isAborted(signal)) return Promise.reject(abortError());

    let fetchResult;
    try {
      fetchResult = fetchDependency(prepared.url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        headers: prepared.headers,
        signal,
      });
    } catch {
      return Promise.reject(isAborted(signal)
        ? abortError() : new Error('X About Account request failed'));
    }
    const ownedFetch = Promise.resolve(fetchResult).then(
      (response) => ({ succeeded: true, response }),
      () => ({ succeeded: false }),
    );
    prepared = null;
    fetchResult = null;
    if (isAborted(signal)) {
      return ownedFetch.then(() => { throw abortError(); });
    }

    return ownedFetch.then(async (settlement) => {
      if (!settlement.succeeded) {
        throw isAborted(signal) ? abortError() : new Error('X About Account request failed');
      }
      const { response } = settlement;
      if (isAborted(signal)) throw abortError();
      let captured;
      try { captured = captureResponse(response); } catch (error) {
        throw isAborted(signal) ? abortError() : error;
      }
      if (isAborted(signal)) throw abortError();
      if (!captured.ok) throw new Error('X About Account request failed');
      if (isAborted(signal)) throw abortError();
      let jsonResult;
      try { jsonResult = captured.json.call(response); } catch {
        throw isAborted(signal) ? abortError() : new Error('Unable to parse X About Account response');
      }
      let payload;
      try { payload = await jsonResult; } catch {
        throw isAborted(signal) ? abortError() : new Error('Unable to parse X About Account response');
      }
      if (isAborted(signal)) throw abortError();
      return payload;
    });
  }

  return Object.freeze({ loadPayload });
}
