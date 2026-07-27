import { normalizeXHandle } from '../shared/account-identity.js';
import {
  X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION,
} from '../shared/x-about-account-request-metadata-event.js';
import {
  HEADER_NAMES, METADATA_LIMIT, QUERY_ID_PATTERN, copyJsonSafe, isPlainObject, validHeaderValue,
} from '../shared/x-about-account-request-metadata-policy.js';

export const X_ABOUT_ACCOUNT_REQUEST_CAPTURE_VERSION = 1;

const installations = new WeakMap();
const supportedOrigins = new Set(['https://x.com', 'https://twitter.com']);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const containsControl = (value) => [...value].some((character) => {
  const code = character.charCodeAt(0);
  return code <= 31 || code === 127;
});

function parseParameter(component) {
  const separator = component.indexOf('=');
  const encodedName = separator < 0 ? component : component.slice(0, separator);
  const encodedValue = separator < 0 ? '' : component.slice(separator + 1);
  return [
    decodeURIComponent(encodedName.replace(/\+/g, ' ')),
    decodeURIComponent(encodedValue.replace(/\+/g, ' ')),
  ];
}

function captureSnapshot(state, input, init) {
  let request = null;
  let suppliedUrl;
  if (typeof input === 'string') suppliedUrl = input;
  else if (input instanceof state.URL) suppliedUrl = input.href;
  else if (input instanceof state.Request) {
    request = input;
    suppliedUrl = request.url;
  } else return;
  if (typeof suppliedUrl !== 'string' || suppliedUrl.trim() !== suppliedUrl
    || !suppliedUrl.startsWith('https://') || containsControl(suppliedUrl)
    || suppliedUrl.includes('\\') || suppliedUrl.includes('#')) return;
  if (init !== undefined && (init === null || (typeof init !== 'object' && typeof init !== 'function'))) return;
  const initMethod = init === undefined ? undefined : init.method;
  const method = initMethod !== undefined ? initMethod : (request ? request.method : 'GET');
  if (typeof method !== 'string' || method.toUpperCase() !== 'GET') return;

  const supplied = /^https:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?$/.exec(suppliedUrl);
  if (!supplied) return;
  const [, authority, rawPath, rawQuery] = supplied;
  if (rawPath === '' || rawPath.endsWith('/') || rawPath.includes('//') || rawQuery === undefined) return;
  const url = new state.URL(suppliedUrl);
  if (url.origin !== state.origin || authority !== url.host || url.username || url.password || url.port) return;
  const rawSegments = rawPath.slice(1).split('/');
  if (rawSegments.length !== 5) return;
  const segments = rawSegments.map((segment) => {
    if (!segment || /%2f|%5c/i.test(segment)) throw new TypeError();
    const decoded = decodeURIComponent(segment);
    if (decoded === '.' || decoded === '..' || decoded.includes('/')
      || decoded.includes('\\') || containsControl(decoded)) throw new TypeError();
    return decoded;
  });
  const [first, second, third, queryId, operation] = segments;
  if (first !== 'i' || second !== 'api' || third !== 'graphql'
    || operation !== 'UserByScreenName' || !QUERY_ID_PATTERN.test(queryId)) return;

  const parameters = Object.create(null);
  for (const component of rawQuery.split('&')) {
    const [name, value] = parseParameter(component);
    if (!['variables', 'features', 'fieldToggles'].includes(name) || hasOwn(parameters, name)) return;
    const parsed = JSON.parse(value);
    if (!isPlainObject(parsed)) return;
    parameters[name] = copyJsonSafe(parsed);
  }
  if (!hasOwn(parameters, 'variables') || !hasOwn(parameters.variables, 'screen_name')) return;
  const observedHandle = parameters.variables.screen_name;
  normalizeXHandle(observedHandle);
  delete parameters.variables.screen_name;

  let headerSource;
  const initHeaders = init === undefined ? undefined : init.headers;
  headerSource = initHeaders !== undefined ? initHeaders : (request ? request.headers : undefined);
  const normalizedHeaders = new state.Headers(headerSource);
  const headers = Object.create(null);
  for (const name of HEADER_NAMES) {
    const value = normalizedHeaders.get(name);
    if (value !== null) {
      if (!validHeaderValue(value)) return;
      headers[name] = value;
    }
  }
  if (!hasOwn(headers, 'authorization') || !hasOwn(headers, 'x-csrf-token')) return;
  const snapshot = {
    version: X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION,
    origin: state.origin,
    queryId,
    variables: parameters.variables,
    features: hasOwn(parameters, 'features') ? parameters.features : null,
    fieldToggles: hasOwn(parameters, 'fieldToggles') ? parameters.fieldToggles : null,
    headers,
  };
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > METADATA_LIMIT || serialized.includes(observedHandle)) return;
  if (serialized === state.snapshot) return;
  state.snapshot = serialized;
  publish(state);
}

function publish(state) {
  if (!state.active || state.snapshot === null) return;
  const event = new state.CustomEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, {
    detail: state.snapshot, bubbles: false, cancelable: false, composed: false,
  });
  state.document.dispatchEvent(event);
}

export function installXAboutAccountRequestCapture(globalScope) {
  if ((typeof globalScope === 'object' && globalScope !== null) || typeof globalScope === 'function') {
    const existing = installations.get(globalScope);
    if (existing) return existing;
  }
  let state;
  try {
    const fetch = globalScope.fetch;
    const location = globalScope.location;
    const document = globalScope.document;
    const Event = globalScope.Event;
    const CustomEvent = globalScope.CustomEvent;
    const URL = globalScope.URL;
    const URLSearchParams = globalScope.URLSearchParams;
    const Headers = globalScope.Headers;
    const Request = globalScope.Request;
    const origin = location.origin;
    if (typeof fetch !== 'function' || !supportedOrigins.has(origin)
      || typeof Event !== 'function' || typeof CustomEvent !== 'function' || typeof URL !== 'function'
      || typeof URLSearchParams !== 'function' || typeof Headers !== 'function' || typeof Request !== 'function'
      || typeof document.addEventListener !== 'function'
      || typeof document.removeEventListener !== 'function' || typeof document.dispatchEvent !== 'function') throw new TypeError();
    state = { globalScope, fetch, document, Event, CustomEvent, URL, URLSearchParams, Headers, Request, origin, active: true, snapshot: null };
  } catch {
    throw new TypeError('Invalid X About Account request capture global scope');
  }

  const wrapper = function wrappedXAboutAccountFetch(...args) {
    if (state.active) {
      try { captureSnapshot(state, args[0], args[1]); } catch { /* Page fetch is authoritative. */ }
    }
    return Reflect.apply(state.fetch, this, args);
  };
  state.wrapper = wrapper;
  const replay = () => {
    if (state.active) {
      try { publish(state); } catch { /* Replay is best effort. */ }
    }
  };
  state.replay = replay;

  function stop() {
    if (!state.active) return;
    state.active = false;
    state.snapshot = null;
    try { state.document.removeEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE, replay); } catch { /* Cleanup is best effort. */ }
    installations.delete(globalScope);
    try {
      if (globalScope.fetch === wrapper) globalScope.fetch = state.fetch;
    } catch { /* Never overwrite unverifiable ownership. */ }
  }
  const controller = Object.freeze({ stop, isActive: () => state.active, hasSnapshot: () => state.snapshot !== null });
  state.controller = controller;
  let listenerAttempted = false;
  try {
    globalScope.fetch = wrapper;
    if (globalScope.fetch !== wrapper) throw new TypeError();
    listenerAttempted = true;
    state.document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE, replay);
    installations.set(globalScope, controller);
    if (installations.get(globalScope) !== controller) throw new TypeError();
    return controller;
  } catch {
    state.active = false;
    state.snapshot = null;
    if (listenerAttempted) {
      try { state.document.removeEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE, replay); } catch { /* Roll back all safe steps. */ }
    }
    try { if (globalScope.fetch === wrapper) globalScope.fetch = state.fetch; } catch { /* Ownership unverified. */ }
    installations.delete(globalScope);
    throw new Error('Unable to install X About Account request capture');
  }
}
