const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
import { isValidXAboutAccountQueryId } from './x-about-account-query.js';
const HEADER_NAMES = Object.freeze([
  'authorization', 'x-csrf-token', 'x-twitter-active-user', 'x-twitter-auth-type',
  'x-twitter-client-language', 'x-guest-token', 'x-client-transaction-id',
]);

export const METADATA_DETAIL_LIMIT = 65_536;

export function metadataHeaderNames() { return HEADER_NAMES; }

export function createMetadataAuthenticationFingerprint(headers) {
  if (!isMetadataPlainObject(headers)) throw new TypeError('Invalid metadata authentication headers');
  const fingerprint = Object.create(null);
  for (const name of ['authorization', 'x-csrf-token', 'x-guest-token', 'x-twitter-auth-type']) {
    if (Object.prototype.hasOwnProperty.call(headers, name)) {
      const value = headers[name];
      if (!validMetadataHeaderValue(value)) throw new TypeError('Invalid metadata authentication headers');
      fingerprint[name] = value;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(fingerprint, 'authorization')
    || !Object.prototype.hasOwnProperty.call(fingerprint, 'x-csrf-token')) {
    throw new TypeError('Invalid metadata authentication headers');
  }
  return JSON.stringify(fingerprint);
}

export function validMetadataQueryId(value) {
  return isValidXAboutAccountQueryId(value);
}

export function validMetadataHeaderValue(value) {
  return typeof value === 'string' && value.length > 0 && ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function isMetadataPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

export function copyAndValidateJsonValue(value, options = undefined) {
  let count = 0;
  const ancestors = new Set();
  function copy(candidate, depth) {
    if (candidate === null || typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new TypeError();
      return candidate;
    }
    if (typeof candidate === 'string') {
      if (candidate.length > 16_384) throw new TypeError();
      return candidate;
    }
    if (depth > 12 || typeof candidate !== 'object' || ancestors.has(candidate)) throw new TypeError();
    if (!Array.isArray(candidate) && !isMetadataPlainObject(candidate)) throw new TypeError();
    const keys = Reflect.ownKeys(candidate);
    if (keys.some((key) => typeof key !== 'string' || FORBIDDEN_KEYS.has(key))) throw new TypeError();
    count += Array.isArray(candidate) ? candidate.length : keys.length;
    if (count > 4_096) throw new TypeError();
    if (Array.isArray(candidate)
      && (keys.length !== candidate.length + 1
        || keys.some((key) => key !== 'length' && !/^(?:0|[1-9]\d*)$/.test(key)))) throw new TypeError();
    ancestors.add(candidate);
    const output = Array.isArray(candidate) ? [] : Object.create(null);
    if (Array.isArray(candidate)) {
      for (let index = 0; index < candidate.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new TypeError();
        output.push(copy(descriptor.value, depth + 1));
      }
    } else {
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new TypeError();
        output[key] = copy(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(candidate);
    return output;
  }
  const copied = copy(value, 0);
  if (options?.requireObject === true && !isMetadataPlainObject(copied)) throw new TypeError();
  return copied;
}

export function deeplyFreezeMetadata(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deeplyFreezeMetadata(value[key]);
    Object.freeze(value);
  }
  return value;
}
