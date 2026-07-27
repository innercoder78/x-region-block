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

  const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

  /** Safe, non-sensitive contexts in which a future caller may observe an account. */
  const ACCOUNT_IDENTITY_SOURCES = Object.freeze([
    'profile',
    'timeline',
    'reply',
    'search',
    'notification',
  ]);

  new Set(ACCOUNT_IDENTITY_SOURCES);

  /**
   * Application paths which must never be interpreted as account handles.
   * The frozen array is the single documented definition; the private Set only
   * provides efficient, case-insensitive membership checks.
   */
  const RESERVED_X_ROUTE_SEGMENTS = Object.freeze([
    'home',
    'explore',
    'notifications',
    'messages',
    'i',
    'settings',
    'compose',
    'search',
    'hashtag',
    'intent',
    'share',
    'login',
    'logout',
    'signup',
    'tos',
    'privacy',
    'about',
    'download',
    'jobs',
  ]);

  new Set(RESERVED_X_ROUTE_SEGMENTS);

  function normalizeXHandle(value) {
    if (typeof value !== 'string') throw new TypeError('X handle must be a string');

    const trimmed = value.trim();
    const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
    if (!HANDLE_PATTERN.test(handle)) throw new TypeError('Invalid X handle');
    return handle.toLowerCase();
  }

  const X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION = 1;

  const X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE =
    'x-region-block:about-account-request-metadata';

  const X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE =
    'x-region-block:request-about-account-request-metadata';

  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const QUERY_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
  const HEADER_NAMES = Object.freeze([
    'authorization', 'x-csrf-token', 'x-twitter-active-user', 'x-twitter-auth-type',
    'x-twitter-client-language', 'x-guest-token', 'x-client-transaction-id',
  ]);

  const METADATA_DETAIL_LIMIT = 65_536;

  function metadataHeaderNames() { return HEADER_NAMES; }

  function validMetadataQueryId(value) {
    return typeof value === 'string' && QUERY_ID_PATTERN.test(value);
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

  function copyAndValidateJsonValue(value, options = undefined) {
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

  const installations$2 = new WeakMap();
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

  function parseParameter(component) {
    const separator = component.indexOf('=');
    const encodedName = separator < 0 ? component : component.slice(0, separator);
    const encodedValue = separator < 0 ? '' : component.slice(separator + 1);
    return [decodeURIComponent(encodedName.replace(/\+/g, ' ')),
      decodeURIComponent(encodedValue.replace(/\+/g, ' '))];
  }

  function containsObservedAccount(value, canonicalHandle) {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return false;
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      return normalized === canonicalHandle || normalized === `@${canonicalHandle}`;
    }
    if (Array.isArray(value)) return value.some((item) => containsObservedAccount(item, canonicalHandle));
    for (const key of Object.keys(value)) {
      if (key === 'screen_name' || containsObservedAccount(value[key], canonicalHandle)) return true;
    }
    return false;
  }

  function captureSnapshot(state, input, init) {
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
      || !suppliedUrl.startsWith('https://') || containsControl(suppliedUrl)
      || suppliedUrl.includes('\\') || suppliedUrl.includes('#')) return;

    let method = request ? Reflect.apply(state.requestMethod, request, []) : 'GET';
    let headerSource = request ? Reflect.apply(state.requestHeaders, request, []) : undefined;
    if (init !== undefined) {
      const methodProperty = dataProperty(init, 'method');
      const headersProperty = dataProperty(init, 'headers');
      if (methodProperty.supplied) method = methodProperty.value;
      if (headersProperty.supplied) headerSource = headersProperty.value;
    }
    if (typeof method !== 'string' || method.toUpperCase() !== 'GET' || headerSource === undefined) return;

    const supplied = /^https:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?$/.exec(suppliedUrl);
    if (!supplied) return;
    const [, authority, rawPath, rawQuery] = supplied;
    if (!rawPath || rawPath.endsWith('/') || rawPath.includes('//') || rawQuery === undefined || rawQuery === '') return;
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
      || operation !== 'UserByScreenName' || !validMetadataQueryId(queryId)) return;

    const parameters = Object.create(null);
    for (const component of rawQuery.split('&')) {
      const [name, value] = parseParameter(component);
      if (!['variables', 'features', 'fieldToggles'].includes(name) || hasOwn(parameters, name)) return;
      const parsed = JSON.parse(value);
      parameters[name] = copyAndValidateJsonValue(parsed, { requireObject: true });
    }
    if (!hasOwn(parameters, 'variables') || !hasOwn(parameters.variables, 'screen_name')) return;
    const canonicalObservedHandle = normalizeXHandle(parameters.variables.screen_name);
    delete parameters.variables.screen_name;
    if (containsObservedAccount(parameters.variables, canonicalObservedHandle)
      || (hasOwn(parameters, 'features')
        && containsObservedAccount(parameters.features, canonicalObservedHandle))
      || (hasOwn(parameters, 'fieldToggles')
        && containsObservedAccount(parameters.fieldToggles, canonicalObservedHandle))) return;

    const headers = normalizeHeaders(state, headerSource);
    for (const [name, value] of Object.entries(headers)) {
      if (!validMetadataHeaderValue(value) || !metadataHeaderNames().includes(name)) return;
    }
    if (!hasOwn(headers, 'authorization') || !hasOwn(headers, 'x-csrf-token')) return;
    const serialized = JSON.stringify({
      version: X_ABOUT_ACCOUNT_REQUEST_METADATA_VERSION, origin: state.origin, queryId,
      variables: parameters.variables,
      features: hasOwn(parameters, 'features') ? parameters.features : null,
      fieldToggles: hasOwn(parameters, 'fieldToggles') ? parameters.fieldToggles : null,
      headers,
    });
    if (serialized.length > METADATA_DETAIL_LIMIT || serialized === state.snapshot) return;
    state.snapshot = serialized;
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
      if (active) {
        try { capture(args[0], args[1]); } catch { /* Unsafe metadata is ignored. */ }
      }
      return Reflect.apply(fetch, this, args);
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
    let phase = 'pending';
    let installationRunning = true;
    const entry = { controller: null };
    const stopped = Object.freeze({ stopped: true });

    function cleanup(final = !installationRunning) {
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
      if (final) {
        if (scope && installations$2.get(scope) === entry) installations$2.delete(scope);
        state = null;
        replay = null;
        wrapper = null;
        activateWrapper = null;
        deactivateWrapper = null;
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
        snapshot: null, active: false };
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
      Reflect.apply(state.documentAddEventListener, state.document,
        [X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE, replay]);
      checkpoint();
      if (installations$2.get(state.scope) !== entry) throw new TypeError();
      phase = 'active';
      state.active = true;
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
