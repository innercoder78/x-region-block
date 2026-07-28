(function () {
  'use strict';

  const X_PAGE_RUNTIME_REQUEST_EVENT_TYPE =
    'x-region-block:page-runtime-request';

  const X_PAGE_RUNTIME_READY_EVENT_TYPE =
    'x-region-block:page-runtime-ready';

  const X_PAGE_RUNTIME_ERROR_EVENT_TYPE =
    'x-region-block:page-runtime-error';

  const X_PAGE_RUNTIME_STOP_EVENT_TYPE =
    'x-region-block:page-runtime-stop';

  const X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION = 2;

  const X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE =
    'x-region-block:about-account-request-metadata';

  const X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE =
    'x-region-block:request-about-account-request-metadata';

  const X_ABOUT_ACCOUNT_OPERATION_NAME = 'AboutAccountQuery';
  const X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID = 'XRqGa7EeokUU5kppkh13EA';

  const QUERY_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

  function isValidXAboutAccountQueryId(value) {
    return typeof value === 'string' && QUERY_ID_PATTERN.test(value);
  }

  const HEADER_NAMES = Object.freeze([
    'authorization', 'x-csrf-token', 'x-twitter-active-user', 'x-twitter-auth-type',
    'x-twitter-client-language', 'x-guest-token', 'x-client-transaction-id',
  ]);

  const METADATA_DETAIL_LIMIT = 65_536;

  function metadataHeaderNames() { return HEADER_NAMES; }

  function createMetadataAuthenticationFingerprint(headers) {
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

  function validMetadataQueryId(value) {
    return isValidXAboutAccountQueryId(value);
  }

  function validMetadataHeaderValue(value) {
    return typeof value === 'string' && value.length > 0 && ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
  }

  function isMetadataPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
  }

  const installations$2 = new WeakMap();
  const privateCaptures = new WeakMap();
  function readPrivateXAboutAccountSnapshot(controller) {
    const read = privateCaptures.get(controller);
    return read ? read() : null;
  }
  function executeWithOriginalXFetch(controller, ...args) {
    const execute = privateCaptures.get(controller)?.execute;
    if (!execute) throw new TypeError('Inactive request capture');
    return execute(...args);
  }
  function invalidatePrivateXAboutAccountSnapshot(controller, kind) {
    const invalidate = privateCaptures.get(controller)?.invalidate;
    return invalidate ? invalidate(kind) : false;
  }
  const supportedOrigins$1 = new Set(['https://x.com', 'https://twitter.com']);
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
    const authenticationFingerprint = createMetadataAuthenticationFingerprint(headers);
    if (authenticationFingerprint === state.rejectedAuthentication) return;
    if (operation === X_ABOUT_ACCOUNT_OPERATION_NAME) {
      if (queryId === state.rejectedQueryId) return;
      state.liveQueryId = queryId;
      state.rejectedQueryId = null;
    }
    if (state.rejectedQueryId !== null) return;
    const publicationKey = JSON.stringify([
      authenticationFingerprint,
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

  function installXAboutAccountRequestCapture(globalScope) {
    if ((typeof globalScope === 'object' && globalScope !== null) || typeof globalScope === 'function') {
      const existing = installations$2.get(globalScope);
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
        if (scope && installations$2.get(scope) === entry) installations$2.delete(scope);
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
    privateRead.invalidate = (kind) => {
      if (phase !== 'active' || !state?.snapshot) return false;
      let current;
      try { current = JSON.parse(state.snapshot); } catch { return false; }
      if (kind === 'authentication') {
        state.rejectedAuthentication = createMetadataAuthenticationFingerprint(current.headers);
      } else if (kind === 'query') {
        state.rejectedQueryId = current.queryId;
        if (state.liveQueryId === current.queryId) state.liveQueryId = null;
      } else return false;
      state.snapshot = null; state.publicationKey = null;
      return true;
    };
    privateCaptures.set(controller, privateRead);
    entry.controller = controller;
    installations$2.set(scope, entry);
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
      if (typeof fetch !== 'function' || !supportedOrigins$1.has(origin)
        || typeof Event !== 'function' || typeof CustomEvent !== 'function'
        || typeof URLSearchParams !== 'function' || typeof headersGet !== 'function'
        || typeof documentAddEventListener !== 'function'
        || typeof documentRemoveEventListener !== 'function' || typeof documentDispatchEvent !== 'function') throw new TypeError();
      state = { scope, fetch, document, documentAddEventListener,
        documentRemoveEventListener, documentDispatchEvent, CustomEvent, URL, Headers, Request, origin,
        urlHref, requestUrl, requestMethod, requestHeaders, headersGet,
        snapshot: null, publicationKey: null, liveQueryId: null, active: false,
        rejectedAuthentication: null, rejectedQueryId: null };
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
      if (installations$2.get(state.scope) !== entry) throw new TypeError();
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

  const X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION = 1;
  const X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE = 'x-region-block:about-account:request';
  const X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE = 'x-region-block:about-account:cancel';
  const X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE = 'x-region-block:about-account:response';
  const X_ABOUT_ACCOUNT_COMMAND_LIMIT = 256;
  const X_ABOUT_ACCOUNT_RESPONSE_LIMIT = 262_144;
  const X_ABOUT_ACCOUNT_RETRY_LIMIT = 300_000;

  const ID = /^[A-Za-z0-9_-]{16,64}$/;
  const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
  const CODES = new Set(['ABORTED', 'PAGE_BRIDGE_UNAVAILABLE', 'NO_METADATA', 'NETWORK',
    'HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_429', 'HTTP_5XX',
    'INVALID_RESPONSE', 'INVALID_PAYLOAD', 'UNKNOWN']);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
  const exact = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length
    && Reflect.ownKeys(value).every((key) => typeof key === 'string') && keys.every((key) => own(value, key));
  const validStatus = (value) => value === null
    || (Number.isInteger(value) && value >= 100 && value <= 599);
  const validRetry = (value) => value === null
    || (Number.isInteger(value) && value >= 0 && value <= X_ABOUT_ACCOUNT_RETRY_LIMIT);
  const canonicalParse = (input, limit) => {
    if (typeof input !== 'string' || input.length === 0 || input.length > limit) return null;
    try {
      const value = JSON.parse(input);
      return JSON.stringify(value) === input ? value : null;
    } catch { return null; }
  };
  const validateJsonValue = (value, ancestors = new Set(), depth = 0) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError(); return; }
    if (typeof value !== 'object' || depth > 32 || ancestors.has(value)) throw new TypeError();
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError();
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) throw new TypeError();
    if (array && (keys.length !== value.length + 1
      || keys.some((key) => key !== 'length' && !/^(?:0|[1-9]\d*)$/.test(key)))) throw new TypeError();
    ancestors.add(value);
    for (const key of keys) {
      if (key === 'length' && array) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !own(descriptor, 'value') || (!array && descriptor.enumerable !== true)) throw new TypeError();
      validateJsonValue(descriptor.value, ancestors, depth + 1);
    }
    ancestors.delete(value);
  };

  function validOpaqueRequestId(value) { return typeof value === 'string' && ID.test(value); }
  function validCanonicalHandle(value) { return typeof value === 'string' && HANDLE.test(value); }
  function parseAboutAccountRequestDetail(input) {
    const value = canonicalParse(input, X_ABOUT_ACCOUNT_COMMAND_LIMIT);
    return exact(value, ['version', 'id', 'handle'])
      && value.version === X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION
      && validOpaqueRequestId(value.id) && validCanonicalHandle(value.handle)
      ? { version: value.version, id: value.id, handle: value.handle } : null;
  }
  function parseAboutAccountCancelDetail(input) {
    const value = canonicalParse(input, X_ABOUT_ACCOUNT_COMMAND_LIMIT);
    return exact(value, ['version', 'id']) && value.version === X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION
      && validOpaqueRequestId(value.id) ? { version: value.version, id: value.id } : null;
  }
  function serializeAboutAccountResponse(value) {
    if (value?.ok === true) {
      try { validateJsonValue(value.payload); } catch { throw new TypeError('Invalid response'); }
    }
    const canonical = value?.ok === true
      ? { version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id: value.id, ok: true, payload: value.payload }
      : { version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id: value?.id, ok: false,
        code: value?.code, status: value?.status, retryAfterMs: value?.retryAfterMs };
    if (!validOpaqueRequestId(canonical.id) || typeof canonical.ok !== 'boolean'
      || (!canonical.ok && (!CODES.has(canonical.code) || !validStatus(canonical.status)
        || !validRetry(canonical.retryAfterMs)))) throw new TypeError('Invalid response');
    let serialized;
    try { serialized = JSON.stringify(canonical); } catch { throw new TypeError('Invalid response'); }
    if (typeof serialized !== 'string' || serialized.length > X_ABOUT_ACCOUNT_RESPONSE_LIMIT) {
      throw new TypeError('Invalid response');
    }
    return serialized;
  }

  const supportedOrigins = new Set(['https://x.com', 'https://twitter.com']);
  const statusCode = (status) => {
    if ([400, 401, 403, 404, 429].includes(status)) return `HTTP_${status}`;
    if (status >= 500) return 'HTTP_5XX';
    return 'UNKNOWN';
  };
  function parseRateLimitDelay(headers, now = Date.now()) {
    const retry = headers?.get?.('retry-after');
    if (/^\d+$/.test(retry ?? '')) return Math.min(300_000, Number(retry) * 1000);
    const reset = headers?.get?.('x-rate-limit-reset');
    if (/^\d+$/.test(reset ?? '')) return Math.min(300_000, Math.max(0, Number(reset) * 1000 - now));
    return 60_000;
  }
  function installXAboutAccountRequestExecutor(globalScope, capture) {
    const { document, CustomEvent, AbortController, location } = globalScope;
    if (!supportedOrigins.has(location.origin)) throw new TypeError('Unsupported origin');
    const requests = new Map();
    let active = true;
    const emit = (detail) => {
      if (!active) return false;
      let serialized;
      try { serialized = serializeAboutAccountResponse(detail); } catch { return false; }
      try {
        document.dispatchEvent(new CustomEvent(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE,
          { detail: serialized, bubbles: false, cancelable: false, composed: false }));
      } catch { return false; }
      return true;
    };
    const fail = (id, code, status = null, retryAfterMs = null) => emit({
      id, ok: false, code, status, retryAfterMs,
    });
    const request = async (event) => {
      const command = parseAboutAccountRequestDetail(event?.detail);
      if (!active || command === null || requests.has(command.id)) return;
      let controller = null;
      try {
        controller = new AbortController();
        requests.set(command.id, controller);
        const metadata = readPrivateXAboutAccountSnapshot(capture);
        if (!metadata || metadata.origin !== location.origin || !isValidXAboutAccountQueryId(metadata.queryId)) {
          fail(command.id, 'NO_METADATA'); return;
        }
        const headers = Object.create(null);
        for (const name of metadataHeaderNames()) {
          const value = metadata.headers?.[name];
          if (value !== undefined) {
            if (!validMetadataHeaderValue(value)) { fail(command.id, 'NO_METADATA'); return; }
            headers[name] = value;
          }
        }
        if (!headers.authorization || !headers['x-csrf-token']) { fail(command.id, 'NO_METADATA'); return; }
        headers.accept = 'application/json'; headers['accept-language'] = 'en-US,en;q=0.9';
        const variables = new URLSearchParams({ variables: JSON.stringify({ screenName: command.handle }) });
        const url = `${location.origin}/i/api/graphql/${metadata.queryId}/${X_ABOUT_ACCOUNT_OPERATION_NAME}?${variables}`;
        let response;
        try { response = await executeWithOriginalXFetch(capture, url, { method: 'GET', credentials: 'include',
          cache: 'no-store', redirect: 'error', headers, signal: controller.signal }); } catch (error) {
          fail(command.id, controller.signal.aborted || error?.name === 'AbortError' ? 'ABORTED' : 'NETWORK'); return;
        }
        let ok; let status; let json;
        try { ok = response?.ok; status = response?.status; json = response?.json; } catch {
          fail(command.id, 'INVALID_RESPONSE'); return;
        }
        if (typeof ok !== 'boolean' || !Number.isInteger(status) || status < 100 || status > 599
          || typeof json !== 'function') {
          fail(command.id, 'INVALID_RESPONSE'); return;
        }
        if (!ok) {
          if ([401, 403].includes(status)) {
            invalidatePrivateXAboutAccountSnapshot(capture, 'authentication');
          } else if ([400, 404].includes(status)) {
            invalidatePrivateXAboutAccountSnapshot(capture, 'query');
          }
          let retryAfterMs = null;
          if (status === 429) {
            try { retryAfterMs = parseRateLimitDelay(response.headers); } catch { retryAfterMs = 60_000; }
          }
          fail(command.id, statusCode(status), status, retryAfterMs); return;
        }
        let payload;
        try { payload = await Reflect.apply(json, response, []); } catch { fail(command.id, 'INVALID_PAYLOAD'); return; }
        if (!emit({ id: command.id, ok: true, payload })) fail(command.id, 'INVALID_PAYLOAD');
      } catch {
        let aborted = false;
        try { aborted = controller?.signal?.aborted === true; } catch { /* unexpected failure */ }
        fail(command.id, aborted ? 'ABORTED' : 'UNKNOWN');
      } finally { requests.delete(command.id); }
    };
    const cancel = (event) => {
      const command = parseAboutAccountCancelDetail(event?.detail);
      if (command !== null) requests.get(command.id)?.abort();
    };
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE, request);
    document.addEventListener(X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, cancel);
    return Object.freeze({ stop() {
      if (!active) return; active = false;
      document.removeEventListener(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE, request);
      document.removeEventListener(X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE, cancel);
      for (const controller of requests.values()) controller.abort();
      requests.clear();
    }, isActive: () => active });
  }

  const X_NAVIGATION_EVENT_TYPE = 'x-region-block:navigation';

  const installations$1 = new WeakMap();

  function invalidScope() {
    throw new TypeError('Invalid X navigation signal global scope');
  }

  function restore(history, property, wrapper, original, attempted) {
    if (!attempted) return;
    let current;
    try {
      current = history[property];
    } catch {
      // Ownership cannot be proven, so an accessor-backed page method must not be written.
      return;
    }
    if (current === wrapper) {
      try { history[property] = original; } catch { /* continue rollback */ }
    }
  }

  function installXNavigationSignal(globalScope) {
    let history;
    let document;
    let EventConstructor;
    let pushState;
    let replaceState;
    try {
      if (globalScope === null || typeof globalScope !== 'object' || Array.isArray(globalScope)) {
        throw new Error();
      }
      const existing = installations$1.get(globalScope);
      if (existing !== undefined) return existing;
      history = globalScope.history;
      document = globalScope.document;
      EventConstructor = globalScope.Event;
      pushState = history.pushState;
      replaceState = history.replaceState;
      if (history === null || typeof history !== 'object' || document === null
        || typeof document !== 'object' || typeof document.dispatchEvent !== 'function'
        || typeof EventConstructor !== 'function' || typeof pushState !== 'function'
        || typeof replaceState !== 'function') throw new Error();
    } catch { invalidScope(); }

    // Wrapper-local delegates intentionally survive stop if page code retained a
    // wrapper. Only the small signaling state is disabled and detached.
    const signalState = { active: true, document, EventConstructor };
    function emit() {
      if (!signalState.active) return;
      try {
        signalState.document.dispatchEvent(
          new signalState.EventConstructor(X_NAVIGATION_EVENT_TYPE),
        );
      } catch { /* signaling is best effort */ }
    }
    const pushWrapper = function (...args) {
      const result = Reflect.apply(pushState, this, args);
      emit();
      return result;
    };
    const replaceWrapper = function (...args) {
      const result = Reflect.apply(replaceState, this, args);
      emit();
      return result;
    };

    let active = true;
    let ownedScope = globalScope;
    let ownedHistory = history;
    let controller;
    const isActive = () => active;
    const stop = () => {
      if (!active) return;
      active = false;
      signalState.active = false;
      signalState.document = null;
      signalState.EventConstructor = null;
      installations$1.delete(ownedScope);
      restore(ownedHistory, 'pushState', pushWrapper, pushState, true);
      restore(ownedHistory, 'replaceState', replaceWrapper, replaceState, true);
      ownedScope = null;
      ownedHistory = null;
      controller = null;
    };
    controller = Object.freeze({ stop, isActive });

    let pushAttempted = false;
    let replaceAttempted = false;
    try {
      pushAttempted = true;
      history.pushState = pushWrapper;
      if (history.pushState !== pushWrapper) throw new Error();
      replaceAttempted = true;
      history.replaceState = replaceWrapper;
      if (history.replaceState !== replaceWrapper) throw new Error();
      installations$1.set(globalScope, controller);
      return controller;
    } catch {
      active = false;
      signalState.active = false;
      signalState.document = null;
      signalState.EventConstructor = null;
      installations$1.delete(globalScope);
      restore(history, 'replaceState', replaceWrapper, replaceState, replaceAttempted);
      restore(history, 'pushState', pushWrapper, pushState, pushAttempted);
      ownedScope = null;
      ownedHistory = null;
      controller = null;
      throw new Error('Unable to install X navigation signal');
    }
  }

  const installations = new WeakMap();

  function installXPageRuntime(globalScope) {
    if ((typeof globalScope === 'object' && globalScope !== null) || typeof globalScope === 'function') {
      const existing = installations.get(globalScope);
      if (existing?.active) {
        try { Reflect.apply(existing.dispatch, existing.document,
          [new existing.Event(X_PAGE_RUNTIME_REQUEST_EVENT_TYPE,
            { bubbles: false, cancelable: false, composed: false })]); } catch { /* best effort */ }
        return null;
      }
      if (existing) return existing.controller;
    }
    let document;
    let EventConstructor;
    let add;
    let remove;
    let dispatch;
    let ownerScope = globalScope;
    try {
      document = globalScope.document;
      EventConstructor = globalScope.Event;
      add = document.addEventListener;
      remove = document.removeEventListener;
      dispatch = document.dispatchEvent;
      if (typeof EventConstructor !== 'function' || typeof add !== 'function'
        || typeof remove !== 'function' || typeof dispatch !== 'function') throw new Error();
    } catch {
      try { globalScope.document.dispatchEvent(new globalScope.Event(X_PAGE_RUNTIME_ERROR_EVENT_TYPE,
        { bubbles: false, cancelable: false, composed: false })); } catch { /* unavailable */ }
      throw new Error('Unable to install X page runtime');
    }

    const state = {
      document, Event: EventConstructor, add, remove, dispatch,
      active: false, claimed: false, finalized: false, probeMayBeAdded: false,
      requestMayBeAdded: false, stopMayBeAdded: false, navigation: null, capture: null,
      probe: null, respond: null, stopListener: null, controller: null, executor: null,
    };
    const current = () => ownerScope !== null && installations.get(ownerScope) === state
      && !state.claimed;
    const event = (type) => new state.Event(type, {
      bubbles: false, cancelable: false, composed: false,
    });
    const emit = (type) => Reflect.apply(state.dispatch, state.document, [event(type)]);
    const removeOwnedListeners = () => {
      let failed = false;
      for (const [flag, type, listener] of [
        ['probeMayBeAdded', X_PAGE_RUNTIME_READY_EVENT_TYPE, state.probe],
        ['requestMayBeAdded', X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, state.respond],
        ['stopMayBeAdded', X_PAGE_RUNTIME_STOP_EVENT_TYPE, state.stopListener],
      ]) {
        if (!state[flag]) continue;
        try {
          Reflect.apply(state.remove, state.document, [type, listener]);
          state[flag] = false;
        } catch { failed = true; }
      }
      return failed;
    };
    const finalize = () => {
      if (state.finalized) return;
      state.finalized = true;
      state.active = false;
      removeOwnedListeners();
      try { state.executor?.stop(); } catch { /* contained */ }
      try { state.capture?.stop(); } catch { /* contained */ }
      try { state.navigation?.stop(); } catch { /* contained */ }
      state.capture = null; state.navigation = null;
      const reservedScope = ownerScope;
      if (reservedScope !== null && installations.get(reservedScope) === state) {
        installations.delete(reservedScope);
      }
      ownerScope = null;
      state.document = null; state.Event = null;
      state.add = null; state.remove = null; state.dispatch = null;
      state.probe = null; state.respond = null; state.stopListener = null;
      state.controller = null;
      document = null; EventConstructor = null;
      add = null; remove = null; dispatch = null;
    };
    const stop = () => {
      if (state.finalized) return;
      state.claimed = true;
      finalize();
    };
    state.controller = Object.freeze({ stop, isActive: () => state.active });
    state.probe = () => { if (current()) state.crossBundleReady = true; };
    state.respond = () => { if (current() && state.active) { try { emit(X_PAGE_RUNTIME_READY_EVENT_TYPE); } catch { /* best effort */ } } };
    state.stopListener = stop;
    installations.set(ownerScope, state);

    const fail = () => {
      const errorDocument = document ?? state.document;
      const ErrorEvent = EventConstructor ?? state.Event;
      const errorDispatch = dispatch ?? state.dispatch;
      state.claimed = true;
      finalize();
      try { Reflect.apply(errorDispatch, errorDocument, [new ErrorEvent(X_PAGE_RUNTIME_ERROR_EVENT_TYPE,
        { bubbles: false, cancelable: false, composed: false })]); } catch { /* unavailable */ }
      throw new Error('Unable to install X page runtime');
    };
    const checkpoint = () => { if (!current()) throw new Error('installation claimed'); };
    try {
      state.probeMayBeAdded = true;
      Reflect.apply(add, document, [X_PAGE_RUNTIME_READY_EVENT_TYPE, state.probe]);
      if (!current()) {
        try { Reflect.apply(remove, document, [X_PAGE_RUNTIME_READY_EVENT_TYPE, state.probe]); } catch { /* best effort */ }
      }
      checkpoint();
      emit(X_PAGE_RUNTIME_REQUEST_EVENT_TYPE);
      checkpoint();
      const removalFailed = removeOwnedListeners();
      if (removalFailed) throw new Error();
      checkpoint();
      if (state.crossBundleReady) {
        state.claimed = true;
        finalize();
        return null;
      }
      state.navigation = installXNavigationSignal(ownerScope);
      if (!current()) { try { state.navigation?.stop(); } catch { /* contained */ } }
      checkpoint();
      state.capture = installXAboutAccountRequestCapture(ownerScope);
      if (!current()) { try { state.capture?.stop(); } catch { /* contained */ } }
      checkpoint();
      state.executor = installXAboutAccountRequestExecutor(ownerScope, state.capture);
      checkpoint();
      state.requestMayBeAdded = true;
      Reflect.apply(add, document, [X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, state.respond]);
      if (!current()) {
        try { Reflect.apply(remove, document, [X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, state.respond]); } catch { /* best effort */ }
      }
      checkpoint();
      state.stopMayBeAdded = true;
      Reflect.apply(add, document, [X_PAGE_RUNTIME_STOP_EVENT_TYPE, state.stopListener]);
      if (!current()) {
        try { Reflect.apply(remove, document, [X_PAGE_RUNTIME_STOP_EVENT_TYPE, state.stopListener]); } catch { /* best effort */ }
      }
      checkpoint();
      state.active = true;
      emit(X_PAGE_RUNTIME_READY_EVENT_TYPE);
      checkpoint();
      return state.controller;
    } catch { return fail(); }
  }

  installXPageRuntime(globalThis);

})();
