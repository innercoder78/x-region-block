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

  function validMetadataHeaderValue(value) {
    return typeof value === 'string' && value.length > 0 && ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
  }

  const installations$2 = new WeakMap();
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

  function installXAboutAccountRequestCapture(globalScope) {
    if ((typeof globalScope !== 'object' || globalScope === null) && typeof globalScope !== 'function') throw new TypeError('Invalid X About Account request capture global scope');
    const existing = installations$2.get(globalScope);
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
        if (installations$2.get(globalScope)?.controller === controller) installations$2.delete(globalScope);
      },
      isActive: () => state.active,
      hasSnapshot: () => state.active && state.snapshot !== null,
    });
    installations$2.set(globalScope, { controller });
    return controller;
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
      probe: null, respond: null, stopListener: null, controller: null,
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
