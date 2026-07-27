import {
  X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION,
} from '../shared/x-about-account-request-metadata-event.js';
import {
  METADATA_DETAIL_LIMIT, metadataHeaderNames, validMetadataHeaderValue,
} from '../shared/x-about-account-request-metadata-policy.js';
import {
  X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID, X_ABOUT_ACCOUNT_OPERATION_NAME,
  isValidXAboutAccountQueryId,
} from '../shared/x-about-account-query.js';

export const X_ABOUT_ACCOUNT_REQUEST_CAPTURE_VERSION = 2;

const installations = new WeakMap();
const supportedOrigins = new Set(['https://x.com', 'https://twitter.com']);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const containsControl = (value) => [...value].some((character) => {
  const code = character.charCodeAt(0); return code <= 31 || code === 127;
});

function eligibleUrl(state, suppliedUrl) {
  if (typeof suppliedUrl !== 'string' || suppliedUrl.trim() !== suppliedUrl
    || containsControl(suppliedUrl) || suppliedUrl.includes('\\') || suppliedUrl.includes('#')) return null;
  const match = /^https:\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?$/.exec(suppliedUrl);
  if (!match) return null;
  let url;
  try { url = new state.URL(suppliedUrl); } catch { return null; }
  if (url.origin !== state.origin || match[1] !== url.host || url.username || url.password || url.port) return null;
  const raw = match[2].slice(1).split('/');
  if (raw.length !== 5 || raw[0] !== 'i' || raw[1] !== 'api' || raw[2] !== 'graphql') return null;
  let queryId; let operation;
  try {
    [queryId, operation] = raw.slice(3).map((segment) => {
      if (!segment || /%2f|%5c/i.test(segment)) throw new Error();
      const decoded = decodeURIComponent(segment);
      if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')
        || containsControl(decoded)) throw new Error();
      return decoded;
    });
  } catch { return null; }
  if (!isValidXAboutAccountQueryId(queryId) || !isValidXAboutAccountQueryId(operation)) return null;
  return { queryId, operation };
}

function normalizeHeaders(state, source) {
  const output = Object.create(null);
  if (source === undefined || source === null) return output;
  try {
    for (const name of metadataHeaderNames()) {
      const value = Reflect.apply(state.headersGet, source, [name]);
      if (value !== null) output[name] = value;
    }
    return output;
  } catch { /* Safe plain records are handled below. */ }
  if (Object.getPrototypeOf(source) !== Object.prototype && Object.getPrototypeOf(source) !== null) throw new TypeError();
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== 'string') continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor?.enumerable || !hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') throw new TypeError();
    const name = key.toLowerCase();
    if (metadataHeaderNames().includes(name)) output[name] = descriptor.value;
  }
  return output;
}

function publishSnapshot(state, urlValue, method, headerSource) {
  if (typeof method !== 'string' || method.toUpperCase() !== 'GET') return;
  const request = eligibleUrl(state, urlValue);
  if (!request) return;
  let headers;
  try { headers = normalizeHeaders(state, headerSource); } catch { return; }
  const keys = Reflect.ownKeys(headers);
  if (!hasOwn(headers, 'authorization') || !hasOwn(headers, 'x-csrf-token')
    || keys.some((key) => !metadataHeaderNames().includes(key) || !validMetadataHeaderValue(headers[key]))) return;
  const queryId = request.operation === X_ABOUT_ACCOUNT_OPERATION_NAME
    ? request.queryId : (state.liveQueryId ?? X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID);
  if (request.operation === X_ABOUT_ACCOUNT_OPERATION_NAME) state.liveQueryId = request.queryId;
  const serialized = JSON.stringify({
    version: X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION, origin: state.origin, queryId, headers,
  });
  if (serialized.length > METADATA_DETAIL_LIMIT || serialized === state.snapshot) return;
  state.snapshot = serialized;
  state.publish();
}

function fetchValues(state, input, init) {
  let url; let method = 'GET'; let headers;
  if (typeof input === 'string') url = input;
  else {
    try { url = Reflect.apply(state.requestUrl, input, []); method = Reflect.apply(state.requestMethod, input, []); headers = Reflect.apply(state.requestHeaders, input, []); }
    catch { try { url = Reflect.apply(state.urlHref, input, []); } catch { return null; } }
  }
  if (init !== undefined) {
    if (init === null || typeof init !== 'object') return null;
    for (const name of ['method', 'headers']) {
      const descriptor = Object.getOwnPropertyDescriptor(init, name);
      if (descriptor && !hasOwn(descriptor, 'value')) return null;
      if (descriptor?.value !== undefined) { if (name === 'method') method = descriptor.value; else headers = descriptor.value; }
    }
  }
  return { url, method, headers };
}

export function installXAboutAccountRequestCapture(globalScope) {
  if ((typeof globalScope !== 'object' || globalScope === null) && typeof globalScope !== 'function') throw new TypeError('Invalid X About Account request capture global scope');
  const existing = installations.get(globalScope);
  if (existing) return existing.controller;
  const document = globalScope.document;
  const state = {
    scope: globalScope, document, origin: globalScope.location?.origin, URL: globalScope.URL,
    Headers: globalScope.Headers, Request: globalScope.Request, fetch: globalScope.fetch,
    CustomEvent: globalScope.CustomEvent, snapshot: null, liveQueryId: null, active: true,
  };
  if (!supportedOrigins.has(state.origin) || typeof state.fetch !== 'function'
    || typeof state.URL !== 'function' || typeof state.Headers !== 'function' || typeof state.Request !== 'function'
    || typeof state.CustomEvent !== 'function' || typeof document?.addEventListener !== 'function') throw new TypeError('Invalid X About Account request capture global scope');
  const getter = (constructor, name) => Object.getOwnPropertyDescriptor(constructor.prototype, name)?.get;
  state.urlHref = getter(state.URL, 'href'); state.requestUrl = getter(state.Request, 'url');
  state.requestMethod = getter(state.Request, 'method'); state.requestHeaders = getter(state.Request, 'headers');
  state.headersGet = state.Headers.prototype.get;
  if (![state.urlHref, state.requestUrl, state.requestMethod, state.requestHeaders, state.headersGet].every((value) => typeof value === 'function')) throw new TypeError('Invalid X About Account request capture global scope');
  state.publish = () => {
    if (!state.active || state.snapshot === null) return;
    document.dispatchEvent(new state.CustomEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, { detail: state.snapshot }));
  };
  const fetchWrapper = function wrappedXAboutAccountFetch(...args) {
    if (state.active) { try { const values = fetchValues(state, args[0], args[1]); if (values) publishSnapshot(state, values.url, values.method, values.headers); } catch { /* Passive observation only. */ } }
    return Reflect.apply(state.fetch, this, args);
  };
  state.fetchWrapper = fetchWrapper;
  globalScope.fetch = fetchWrapper;
  if (globalScope.fetch !== fetchWrapper) throw new Error('Unable to install X About Account request capture');

  const XHR = globalScope.XMLHttpRequest;
  if (typeof XHR === 'function' && XHR.prototype) {
    const prototype = XHR.prototype;
    const originals = { open: prototype.open, setRequestHeader: prototype.setRequestHeader, send: prototype.send };
    if (Object.values(originals).every((value) => typeof value === 'function')) {
      const requests = new WeakMap();
      const wrappers = {
        open: function wrappedOpen(...args) {
          const result = Reflect.apply(originals.open, this, args);
          if (state.active) requests.set(this, { method: args[0], url: args[1], headers: Object.create(null) });
          return result;
        },
        setRequestHeader: function wrappedSetRequestHeader(...args) {
          const result = Reflect.apply(originals.setRequestHeader, this, args);
          if (state.active) {
            const request = requests.get(this); const name = typeof args[0] === 'string' ? args[0].toLowerCase() : '';
            if (request && metadataHeaderNames().includes(name) && typeof args[1] === 'string') request.headers[name] = request.headers[name] ? `${request.headers[name]}, ${args[1]}` : args[1];
          }
          return result;
        },
        send: function wrappedSend(...args) {
          if (state.active) { const request = requests.get(this); if (request) publishSnapshot(state, request.url, request.method, request.headers); }
          return Reflect.apply(originals.send, this, args);
        },
      };
      prototype.open = wrappers.open; prototype.setRequestHeader = wrappers.setRequestHeader; prototype.send = wrappers.send;
      state.xhr = { prototype, originals, wrappers };
    }
  }
  const replay = () => state.publish(); state.replay = replay;
  document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE, replay);
  const controller = Object.freeze({
    stop() {
      if (!state.active) return; state.active = false; state.snapshot = null;
      document.removeEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE, replay);
      if (globalScope.fetch === fetchWrapper) globalScope.fetch = state.fetch;
      if (state.xhr) for (const name of ['open', 'setRequestHeader', 'send']) if (state.xhr.prototype[name] === state.xhr.wrappers[name]) state.xhr.prototype[name] = state.xhr.originals[name];
      if (installations.get(globalScope)?.controller === controller) installations.delete(globalScope);
    },
    isActive: () => state.active,
    hasSnapshot: () => state.active && state.snapshot !== null,
  });
  installations.set(globalScope, { controller });
  return controller;
}
