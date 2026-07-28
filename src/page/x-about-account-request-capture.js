import {
  X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION,
} from '../shared/x-about-account-request-metadata-event.js';
import {
  METADATA_DETAIL_LIMIT, createMetadataAuthenticationFingerprint, metadataHeaderNames,
  validMetadataHeaderValue, validMetadataQueryId,
} from '../shared/x-about-account-request-metadata-policy.js';
import {
  X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID, X_ABOUT_ACCOUNT_OPERATION_NAME,
} from '../shared/x-about-account-query.js';

export const X_ABOUT_ACCOUNT_REQUEST_CAPTURE_VERSION = 2;

const installations = new WeakMap();
const privateCaptures = new WeakMap();
export function readPrivateXAboutAccountSnapshot(controller) {
  const read = privateCaptures.get(controller);
  return read ? read() : null;
}
export function executeWithOriginalXFetch(controller, ...args) {
  const execute = privateCaptures.get(controller)?.execute;
  if (!execute) throw new TypeError('Inactive request capture');
  return execute(...args);
}
const supportedOrigins = new Set(['https://x.com', 'https://twitter.com']);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
};
const containsControl = (value) => [...value].some((character) => {
  const code = character.charCodeAt(0);
  return code <= 31 || code === 127;
});

function dataProperty(value, name) {
  if (!isPlainObject(value)) throw new TypeError();
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (descriptor) {
    if (!hasOwn(descriptor, 'value')) throw new TypeError();
    return { supplied: descriptor.value !== undefined, value: descriptor.value };
  }
  let prototype = Object.getPrototypeOf(value);
  while (prototype !== null) {
    if (Object.getOwnPropertyDescriptor(prototype, name)) throw new TypeError();
    prototype = Object.getPrototypeOf(prototype);
  }
  return { supplied: false, value: undefined };
}

function safeRecordHeaders(value) {
  if (!isPlainObject(value)) throw new TypeError();
  const output = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) throw new TypeError();
    if (!descriptor.enumerable) continue;
    if (!hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') throw new TypeError();
    output[key] = descriptor.value;
  }
  return output;
}

function normalizeHeaders(state, source) {
  try {
    const headers = Object.create(null);
    for (const name of metadataHeaderNames()) {
      const value = Reflect.apply(state.headersGet, source, [name]);
      if (value !== null) headers[name] = value;
    }
    return headers;
  } catch { /* Non-Headers sources are classified structurally below. */ }
  if (Array.isArray(source)) throw new TypeError();
  const safeSource = safeRecordHeaders(source);
  const copied = new state.Headers(safeSource);
  const headers = Object.create(null);
  for (const name of metadataHeaderNames()) {
    const value = Reflect.apply(state.headersGet, copied, [name]);
    if (value !== null) headers[name] = value;
  }
  return headers;
}

function captureSnapshot(state, input, init = undefined, suppliedXhrHeaders = undefined) {
  let request = null;
  let suppliedUrl;
  if (typeof input === 'string') suppliedUrl = input;
  else {
    try {
      suppliedUrl = Reflect.apply(state.requestUrl, input, []);
      request = input;
    } catch {
      try { suppliedUrl = Reflect.apply(state.urlHref, input, []); } catch { return; }
    }
  }
  if (typeof suppliedUrl !== 'string' || suppliedUrl.trim() !== suppliedUrl
    || containsControl(suppliedUrl)
    || suppliedUrl.includes('\\') || suppliedUrl.includes('#')) return;

  let method = request ? Reflect.apply(state.requestMethod, request, []) : 'GET';
  let headerSource = suppliedXhrHeaders ?? (request ? Reflect.apply(state.requestHeaders, request, []) : undefined);
  if (init !== undefined) {
    const methodProperty = dataProperty(init, 'method');
    const headersProperty = dataProperty(init, 'headers');
    if (methodProperty.supplied) method = methodProperty.value;
    if (headersProperty.supplied) headerSource = headersProperty.value;
  }
  if (typeof method !== 'string' || method.toUpperCase() !== 'GET' || headerSource === undefined) return;

  let absolute;
  try { absolute = new state.URL(suppliedUrl, `${state.origin}/`).href; } catch { return; }
  const supplied = /^https:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?$/.exec(absolute);
  if (!supplied) return;
  const [, authority, rawPath, rawQuery] = supplied;
  if (!rawPath || rawPath.endsWith('/') || rawPath.includes('//') || rawQuery === undefined || rawQuery === '') return;
  const url = new state.URL(absolute);
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
    || !validMetadataQueryId(operation) || !validMetadataQueryId(queryId)) return;

  const headers = normalizeHeaders(state, headerSource);
  for (const [name, value] of Object.entries(headers)) {
    if (!validMetadataHeaderValue(value) || !metadataHeaderNames().includes(name)) return;
  }
  if (!hasOwn(headers, 'authorization') || !hasOwn(headers, 'x-csrf-token')) return;
  if (operation === X_ABOUT_ACCOUNT_OPERATION_NAME) state.liveQueryId = queryId;
  const publicationKey = JSON.stringify([
    createMetadataAuthenticationFingerprint(headers),
    state.liveQueryId ?? X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID,
  ]);
  if (publicationKey === state.publicationKey) return;
  const serialized = JSON.stringify({
    version: X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION, origin: state.origin,
    queryId: state.liveQueryId ?? X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID, headers,
  });
  if (serialized.length > METADATA_DETAIL_LIMIT || serialized === state.snapshot) return;
  state.snapshot = serialized;
  state.publicationKey = publicationKey;
  state.publish();
}

function intrinsicGetter(constructor, name) {
  const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, name);
  if (!descriptor || typeof descriptor.get !== 'function') throw new TypeError();
  return descriptor.get;
}

function createFetchWrapper(fetch) {
  let active = false;
  let capture = null;
  const wrapper = function wrappedXAboutAccountFetch(...args) {
    const result = Reflect.apply(fetch, this, args);
    if (active) {
      try { capture(args[0], args[1]); } catch { /* Unsafe metadata is ignored. */ }
    }
    return result;
  };
  return {
    wrapper,
    activate(nextCapture) { capture = nextCapture; active = true; },
    deactivate() { active = false; capture = null; },
  };
}

export function installXAboutAccountRequestCapture(globalScope) {
  if ((typeof globalScope === 'object' && globalScope !== null) || typeof globalScope === 'function') {
    const existing = installations.get(globalScope);
    if (existing) return existing.controller;
  }
  if ((typeof globalScope !== 'object' || globalScope === null) && typeof globalScope !== 'function') {
    throw new TypeError('Invalid X About Account request capture global scope');
  }
  let scope = globalScope;
  let state;
  let wrapper = null;
  let replay = null;
  let activateWrapper = null;
  let deactivateWrapper = null;
  let xhr = null;
  let phase = 'pending';
  let installationRunning = true;
  const entry = { controller: null };
  const stopped = Object.freeze({ stopped: true });

  function cleanup(final = !installationRunning) {
    if (final && entry.controller) privateCaptures.delete(entry.controller);
    if (state) {
      state.active = false;
      state.snapshot = null;
    }
    if (deactivateWrapper) deactivateWrapper();
    if (state && replay) {
      try { Reflect.apply(state.documentRemoveEventListener, state.document,
        [X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE, replay]); } catch { /* Cleanup is best effort. */ }
    }
    if (state && wrapper) {
      try { if (state.scope.fetch === wrapper) state.scope.fetch = state.fetch; } catch { /* Ownership unverified. */ }
    }
    if (xhr) {
      for (const name of ['open', 'setRequestHeader', 'send']) {
        try {
          if (xhr.prototype[name] === xhr.wrappers[name]) xhr.prototype[name] = xhr.originals[name];
        } catch { /* Ownership unverified. */ }
      }
      xhr.active = false;
    }
    if (final) {
      if (scope && installations.get(scope) === entry) installations.delete(scope);
      state = null;
      replay = null;
      wrapper = null;
      activateWrapper = null;
      deactivateWrapper = null;
      xhr = null;
      scope = null;
    }
  }
  function stop() {
    if (phase === 'stopped' || phase === 'failed') return;
    phase = 'stopped';
    cleanup();
  }
  const controller = Object.freeze({ stop, isActive: () => phase === 'active',
    hasSnapshot: () => phase === 'active' && state?.snapshot !== null && state?.snapshot !== undefined });
  const privateRead = () => {
    if (phase !== 'active' || !state?.snapshot) return null;
    try { return JSON.parse(state.snapshot); } catch { return null; }
  };
  privateRead.execute = (...args) => Reflect.apply(state.fetch, state.scope, args);
  privateCaptures.set(controller, privateRead);
  entry.controller = controller;
  installations.set(scope, entry);
  const checkpoint = () => { if (phase !== 'pending') throw stopped; };
  const read = (operation) => { const value = operation(); checkpoint(); return value; };
  try {
    const fetch = read(() => scope.fetch);
    const location = read(() => scope.location);
    const document = read(() => scope.document);
    const Event = read(() => scope.Event);
    const CustomEvent = read(() => scope.CustomEvent);
    const URL = read(() => scope.URL);
    const URLSearchParams = read(() => scope.URLSearchParams);
    const Headers = read(() => scope.Headers);
    const Request = read(() => scope.Request);
    const XMLHttpRequest = read(() => scope.XMLHttpRequest);
    const origin = read(() => location.origin);
    const documentAddEventListener = read(() => document.addEventListener);
    const documentRemoveEventListener = read(() => document.removeEventListener);
    const documentDispatchEvent = read(() => document.dispatchEvent);
    const urlHref = read(() => intrinsicGetter(URL, 'href'));
    const requestUrl = read(() => intrinsicGetter(Request, 'url'));
    const requestMethod = read(() => intrinsicGetter(Request, 'method'));
    const requestHeaders = read(() => intrinsicGetter(Request, 'headers'));
    const headersGet = read(() => Headers.prototype.get);
    if (typeof fetch !== 'function' || !supportedOrigins.has(origin)
      || typeof Event !== 'function' || typeof CustomEvent !== 'function'
      || typeof URLSearchParams !== 'function' || typeof headersGet !== 'function'
      || typeof documentAddEventListener !== 'function'
      || typeof documentRemoveEventListener !== 'function' || typeof documentDispatchEvent !== 'function') throw new TypeError();
    state = { scope, fetch, document, documentAddEventListener,
      documentRemoveEventListener, documentDispatchEvent, CustomEvent, URL, Headers, Request, origin,
      urlHref, requestUrl, requestMethod, requestHeaders, headersGet,
      snapshot: null, publicationKey: null, liveQueryId: null, active: false };
    if (typeof XMLHttpRequest === 'function') {
      const prototype = read(() => XMLHttpRequest.prototype);
      const originals = {
        open: read(() => prototype.open),
        setRequestHeader: read(() => prototype.setRequestHeader),
        send: read(() => prototype.send),
      };
      if (!Object.values(originals).every((value) => typeof value === 'function')) throw new TypeError();
      const requests = new WeakMap();
      const wrappers = {
        open: function wrappedXAboutAccountOpen(...args) {
          const result = Reflect.apply(originals.open, this, args);
          if (xhr?.active) {
            try { requests.set(this, { method: args[0], url: args[1], headers: Object.create(null) }); } catch { /* passive */ }
          }
          return result;
        },
        setRequestHeader: function wrappedXAboutAccountSetRequestHeader(...args) {
          const result = Reflect.apply(originals.setRequestHeader, this, args);
          if (xhr?.active) {
            try {
              const request = requests.get(this);
              const name = typeof args[0] === 'string' ? args[0].toLowerCase() : '';
              if (request && metadataHeaderNames().includes(name) && typeof args[1] === 'string') {
                request.headers[name] = request.headers[name]
                  ? `${request.headers[name]}, ${args[1]}` : args[1];
              }
            } catch { /* passive */ }
          }
          return result;
        },
        send: function wrappedXAboutAccountSend(...args) {
          const result = Reflect.apply(originals.send, this, args);
          if (xhr?.active) {
            try {
              const request = requests.get(this);
              if (request) captureSnapshot(state, request.url,
                { method: request.method, headers: request.headers }, request.headers);
            } catch { /* passive */ }
          }
          return result;
        },
      };
      xhr = { prototype, originals, wrappers, active: false };
    }
  } catch (error) {
    if (error === stopped) {
      installationRunning = false;
      cleanup(true);
      return controller;
    }
    phase = 'failed';
    installationRunning = false;
    cleanup(true);
    throw new TypeError('Invalid X About Account request capture global scope');
  }

  ({ wrapper, activate: activateWrapper, deactivate: deactivateWrapper }
    = createFetchWrapper(state.fetch));
  replay = () => { if (phase === 'active' && state?.active) { try { state.publish(); } catch { /* Best effort. */ } } };
  state.publish = () => {
    if (phase !== 'active' || !state.active || state.snapshot === null) return;
    Reflect.apply(state.documentDispatchEvent, state.document, [new state.CustomEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, {
      detail: state.snapshot, bubbles: false, cancelable: false, composed: false,
    })]);
  };

  try {
    state.scope.fetch = wrapper;
    checkpoint();
    if (read(() => state.scope.fetch) !== wrapper) throw new TypeError();
    if (xhr) {
      for (const name of ['open', 'setRequestHeader', 'send']) {
        xhr.prototype[name] = xhr.wrappers[name];
        checkpoint();
        if (read(() => xhr.prototype[name]) !== xhr.wrappers[name]) throw new TypeError();
      }
    }
    Reflect.apply(state.documentAddEventListener, state.document,
      [X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE, replay]);
    checkpoint();
    if (installations.get(state.scope) !== entry) throw new TypeError();
    phase = 'active';
    state.active = true;
    if (xhr) xhr.active = true;
    activateWrapper((...args) => captureSnapshot(state, ...args));
    installationRunning = false;
    return controller;
  } catch (error) {
    if (error === stopped) {
      installationRunning = false;
      cleanup(true);
      return controller;
    }
    phase = 'failed';
    installationRunning = false;
    cleanup(true);
    throw new Error('Unable to install X About Account request capture');
  }
}
