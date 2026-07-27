import { describe, expect, it, vi } from 'vitest';
import {
  X_ABOUT_ACCOUNT_REQUEST_CAPTURE_VERSION, installXAboutAccountRequestCapture,
} from '../src/page/x-about-account-request-capture.js';
import {
  X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE,
} from '../src/shared/x-about-account-request-metadata-event.js';
import { metadataFacades, observedHeaders, observedUrl } from './helpers/x-request-metadata-facade.js';

describe('X About Account request capture', () => {
  it('is versioned, idempotent, sanitizes metadata, and restores fetch', () => {
    const fetch = vi.fn(() => 'page-result');
    const { page, document } = metadataFacades(fetch);
    const details = [];
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, (event) => details.push(event.detail));
    const controller = installXAboutAccountRequestCapture(page);
    expect(X_ABOUT_ACCOUNT_REQUEST_CAPTURE_VERSION).toBe(1);
    expect(Object.keys(controller)).toEqual(['stop', 'isActive', 'hasSnapshot']);
    expect(Object.isFrozen(controller)).toBe(true);
    expect(installXAboutAccountRequestCapture(page)).toBe(controller);
    const input = observedUrl();
    const init = { headers: observedHeaders };
    expect(page.fetch(input, init)).toBe('page-result');
    expect(fetch).toHaveBeenCalledWith(input, init);
    const snapshot = JSON.parse(details[0]);
    expect(Object.keys(snapshot)).toEqual([
      'version', 'origin', 'queryId', 'variables', 'features', 'fieldToggles', 'headers',
    ]);
    expect(details[0]).not.toContain('Observed');
    expect(snapshot.variables).not.toHaveProperty('screen_name');
    expect(snapshot.headers).not.toHaveProperty('cookie');
    page.fetch(input, init);
    expect(details).toHaveLength(1);
    controller.stop();
    expect(page.fetch).toBe(fetch);
    expect(controller.hasSnapshot()).toBe(false);
  });

  it('forwards malformed requests and exact original failures', () => {
    const failure = new Error('page failure');
    const fetch = vi.fn(() => { throw failure; });
    const { page } = metadataFacades(fetch);
    installXAboutAccountRequestCapture(page);
    expect(() => page.fetch('https://example.com/')).toThrow(failure);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['method', 'headers'])('does not invoke unsafe init.%s accessors', (name) => {
    let reads = 0;
    const init = {};
    Object.defineProperty(init, name, {
      enumerable: true,
      get() {
        reads += 1;
        if (name === 'method') return reads === 1 ? 'GET' : 'POST';
        return reads === 1 ? observedHeaders : { authorization: 'changed', 'x-csrf-token': 'changed' };
      },
    });
    const fetch = vi.fn((input, suppliedInit) => suppliedInit[name]);
    const { page, document } = metadataFacades(fetch);
    const details = [];
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, (event) => details.push(event.detail));
    installXAboutAccountRequestCapture(page);
    page.fetch(observedUrl(), init);
    expect(reads).toBe(1);
    expect(details).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('skips inherited, throwing, and reflectively unsafe init properties', () => {
    const inputs = [
      Object.create({ method: 'GET', headers: observedHeaders }),
      Object.defineProperty({}, 'headers', { get() { throw new Error('native-only getter'); } }),
      new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('reflective failure'); } }),
    ];
    for (const init of inputs) {
      const fetch = vi.fn(() => 'forwarded');
      const { page } = metadataFacades(fetch);
      const controller = installXAboutAccountRequestCapture(page);
      expect(page.fetch(observedUrl(), init)).toBe('forwarded');
      expect(fetch.mock.calls[0][0]).toBe(observedUrl());
      expect(fetch.mock.calls[0][1]).toBe(init);
      expect(controller.hasSnapshot()).toBe(false);
      controller.stop();
    }
  });

  it('never advances a self-iterating header iterator', () => {
    let advances = 0;
    const iterator = {
      next() { advances += 1; return { done: true }; },
      [Symbol.iterator]() { return this; },
    };
    const fetch = vi.fn(() => 'unchanged');
    const { page } = metadataFacades(fetch);
    const capture = installXAboutAccountRequestCapture(page);
    expect(page.fetch(observedUrl(), { headers: iterator })).toBe('unchanged');
    expect(advances).toBe(0);
    expect(capture.hasSnapshot()).toBe(false);
  });

  it('captures branded native Headers', () => {
    const { page, document } = metadataFacades(() => 'unchanged');
    const details = [];
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, (event) => details.push(event.detail));
    installXAboutAccountRequestCapture(page);
    page.fetch(observedUrl(), { headers: new Headers(observedHeaders) });
    expect(details).toHaveLength(1);
  });

  it('forwards standard tuple arrays without capture or iteration', () => {
    const headers = [['authorization', 'authorization'], ['x-csrf-token', 'csrf']];
    const fetch = vi.fn(() => 'unchanged');
    const { page } = metadataFacades(fetch);
    const capture = installXAboutAccountRequestCapture(page);
    const init = { headers };
    expect(page.fetch(observedUrl(), init)).toBe('unchanged');
    expect(capture.hasSnapshot()).toBe(false);
    expect(fetch.mock.calls[0][1]).toBe(init);
  });

  it('uses intrinsic URL and Request properties instead of own shadows', () => {
    const { page, document } = metadataFacades(() => 'unchanged');
    const details = [];
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, (event) => details.push(event.detail));
    installXAboutAccountRequestCapture(page);
    const url = new URL(observedUrl());
    Object.defineProperty(url, 'href', { value: 'https://attacker.invalid/' });
    page.fetch(url, { headers: observedHeaders });
    const request = new Request(observedUrl('request_query'), { headers: observedHeaders });
    Object.defineProperties(request, {
      url: { value: 'https://attacker.invalid/' }, method: { value: 'POST' }, headers: { value: {} },
    });
    page.fetch(request);
    expect(details).toHaveLength(2);
    expect(JSON.parse(details[1]).queryId).toBe('request_query');
  });

  it.each(['a', 'i', 'user', 'MiXeD', '@Prefixed'])(
    'removes short and normalized observed handle %s semantically', (handle) => {
      const { page, document } = metadataFacades(() => 'unchanged');
      const details = [];
      document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, (event) => details.push(event.detail));
      installXAboutAccountRequestCapture(page);
      const url = new URL(observedUrl('semantic_query', handle));
      const variables = JSON.parse(url.searchParams.get('variables'));
      variables.unrelated = `token-containing-${handle}-value`;
      url.searchParams.set('variables', JSON.stringify(variables));
      page.fetch(url.href, { headers: { ...observedHeaders, authorization: `Bearer ${handle}-substring` } });
      expect(details).toHaveLength(1);
      expect(JSON.parse(details[0]).variables).not.toHaveProperty('screen_name');
    },
  );

  it.each([
    { nested: { screen_name: 'someone-else' } },
    { nested: { value: 'observed' } },
    { nested: { value: '@OBSERVED' } },
  ])('rejects semantic account residue %#', (extraVariables) => {
    const url = new URL(observedUrl());
    url.searchParams.set('variables', JSON.stringify({
      ...JSON.parse(url.searchParams.get('variables')), ...extraVariables,
    }));
    const { page } = metadataFacades(() => 'unchanged');
    const capture = installXAboutAccountRequestCapture(page);
    page.fetch(url.href, { headers: observedHeaders });
    expect(capture.hasSnapshot()).toBe(false);
  });

  it('walks null-safe reusable graphs and rejects residue in features and field toggles', () => {
    const accepted = new URL(observedUrl('null_safe', 'MiXeD'));
    accepted.searchParams.set('variables', JSON.stringify({ screen_name: 'MiXeD', values: [null, true, 3] }));
    accepted.searchParams.set('features', JSON.stringify({ nullable: null, text: 'prefix-mixed-suffix' }));
    accepted.searchParams.set('fieldToggles', JSON.stringify({ values: [null, false] }));
    const { page, document } = metadataFacades(() => 'unchanged');
    const details = [];
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, (event) => details.push(event.detail));
    installXAboutAccountRequestCapture(page);
    page.fetch(accepted.href, { headers: observedHeaders });
    expect(details).toHaveLength(1);

    for (const [name, residue] of [
      ['features', { nested: { value: '@MIXED' } }],
      ['features', { nested: { screen_name: 'different' } }],
      ['fieldToggles', { nested: { value: 'mixed' } }],
      ['fieldToggles', { nested: { screen_name: 'different' } }],
    ]) {
      const rejected = new URL(observedUrl(`reject_${name}`, 'MiXeD'));
      rejected.searchParams.set(name, JSON.stringify(residue));
      page.fetch(rejected.href, { headers: observedHeaders });
    }
    expect(details).toHaveLength(1);
  });

  it('never invokes constructor Symbol.hasInstance hooks', () => {
    let checks = 0;
    function SafeURL(...args) { return new URL(...args); }
    SafeURL.prototype = URL.prototype;
    function SafeRequest(...args) { return new Request(...args); }
    SafeRequest.prototype = Request.prototype;
    function SafeHeaders(...args) { return new Headers(...args); }
    SafeHeaders.prototype = Headers.prototype;
    for (const constructor of [SafeURL, SafeRequest, SafeHeaders]) {
      Object.defineProperty(constructor, Symbol.hasInstance, {
        value() { checks += 1; throw new Error('observable hasInstance'); },
      });
    }
    const fetch = vi.fn(() => 'unchanged');
    const { page } = metadataFacades(fetch);
    Object.assign(page, { URL: SafeURL, Request: SafeRequest, Headers: SafeHeaders });
    installXAboutAccountRequestCapture(page);
    const input = new URL(observedUrl());
    expect(page.fetch(input, { headers: new Headers(observedHeaders) })).toBe('unchanged');
    expect(checks).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('matches enumerable record-header semantics without invoking accessors', () => {
    const cases = [];
    const hidden = {};
    Object.defineProperties(hidden, {
      authorization: { value: 'hidden', enumerable: false },
      'x-csrf-token': { value: 'hidden', enumerable: false },
    });
    cases.push([hidden, false, null]);
    const accessor = { authorization: 'authorization' };
    let reads = 0;
    Object.defineProperty(accessor, 'x-csrf-token', {
      enumerable: true, get() { reads += 1; return 'csrf'; },
    });
    cases.push([accessor, false, () => expect(reads).toBe(0)]);
    const symbol = { authorization: 'authorization', 'x-csrf-token': 'csrf' };
    symbol[Symbol('ignored')] = 'symbol-secret';
    cases.push([symbol, true, null]);
    for (const [headers, accepted, verify] of cases) {
      const fetch = vi.fn(() => 'unchanged');
      const { page } = metadataFacades(fetch);
      const capture = installXAboutAccountRequestCapture(page);
      const init = { headers };
      expect(page.fetch(observedUrl(), init)).toBe('unchanged');
      expect(capture.hasSnapshot()).toBe(accepted);
      expect(fetch.mock.calls[0][1]).toBe(init);
      expect(fetch).toHaveBeenCalledTimes(1);
      verify?.();
      capture.stop();
    }
  });

  it('skips tuple arrays with observable or nonstandard iteration', () => {
    const standard = [['authorization', 'authorization'], ['x-csrf-token', 'csrf']];
    const outerOverride = standard.map((tuple) => [...tuple]);
    outerOverride[Symbol.iterator] = function* overridden() { yield ['authorization', 'changed']; };
    const tupleOverride = standard.map((tuple) => [...tuple]);
    tupleOverride[0][Symbol.iterator] = function* overridden() { yield 'authorization'; yield 'changed'; };
    for (const headers of [outerOverride, tupleOverride]) {
      const fetch = vi.fn(() => 'unchanged');
      const { page } = metadataFacades(fetch);
      const capture = installXAboutAccountRequestCapture(page);
      const init = { headers };
      page.fetch(observedUrl(), init);
      expect(capture.hasSnapshot()).toBe(false);
      expect(fetch.mock.calls[0][1]).toBe(init);
      expect(fetch).toHaveBeenCalledTimes(1);
      capture.stop();
    }
  });

  it('skips tuple capture when the array prototype iterator changes after install', () => {
    const fetch = vi.fn(() => 'unchanged');
    const { page } = metadataFacades(fetch);
    const capture = installXAboutAccountRequestCapture(page);
    const originalIterator = Array.prototype[Symbol.iterator];
    let retainedInit;
    try {
      Array.prototype[Symbol.iterator] = function* changedIterator() { yield ['authorization', 'changed']; };
      const headers = [['authorization', 'authorization'], ['x-csrf-token', 'csrf']];
      const init = { headers };
      page.fetch(observedUrl(), init);
      retainedInit = init;
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }
    expect(capture.hasSnapshot()).toBe(false);
    expect(fetch.mock.calls[0][1]).toBe(retainedInit);
    capture.stop();
  });

  it('reserves one controller across reentrant fetch assignment and listener registration', () => {
    const original = vi.fn(() => 'original');
    const { page, document } = metadataFacades(original);
    const received = [];
    let storedFetch = original;
    Object.defineProperty(page, 'fetch', {
      configurable: true,
      get() { return storedFetch; },
      set(value) {
        received.push(installXAboutAccountRequestCapture(page));
        storedFetch = value;
      },
    });
    const originalAdd = document.addEventListener.bind(document);
    document.addEventListener = (type, listener) => {
      received.push(installXAboutAccountRequestCapture(page));
      originalAdd(type, listener);
    };
    const controller = installXAboutAccountRequestCapture(page);
    expect(received).toEqual([controller, controller]);
    expect(controller.isActive()).toBe(true);
    expect(document.listeners.get(X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE)).toHaveLength(1);
    controller.stop();
  });

  it('lets a reentrant installer stop and permits a later clean install', () => {
    const original = vi.fn(() => 'original');
    const { page } = metadataFacades(original);
    let storedFetch = original;
    let claimed = false;
    Object.defineProperty(page, 'fetch', {
      configurable: true,
      get() { return storedFetch; },
      set(value) {
        if (!claimed) {
          claimed = true;
          installXAboutAccountRequestCapture(page).stop();
        }
        storedFetch = value;
      },
    });
    const stopped = installXAboutAccountRequestCapture(page);
    expect(stopped.isActive()).toBe(false);
    expect(storedFetch).toBe(original);
    const active = installXAboutAccountRequestCapture(page);
    expect(active).not.toBe(stopped);
    expect(active.isActive()).toBe(true);
    active.stop();
  });

  it.each(['setter', 'readback', 'listener'])(
    'keeps capture disabled when fetch runs during pending %s work', (phase) => {
      const original = vi.fn(() => 'delegated');
      const { page, document } = metadataFacades(original);
      const details = [];
      document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, (event) => details.push(event.detail));
      let storedFetch = original;
      let reads = 0;
      Object.defineProperty(page, 'fetch', {
        configurable: true,
        get() {
          reads += 1;
          if (phase === 'readback' && reads === 2) storedFetch(observedUrl(), { headers: observedHeaders });
          return storedFetch;
        },
        set(value) {
          storedFetch = value;
          if (phase === 'setter') value(observedUrl(), { headers: observedHeaders });
        },
      });
      const originalAdd = document.addEventListener.bind(document);
      document.addEventListener = (type, listener) => {
        if (phase === 'listener' && type === X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE) {
          page.fetch(observedUrl(), { headers: observedHeaders });
        }
        originalAdd(type, listener);
      };
      const controller = installXAboutAccountRequestCapture(page);
      expect(controller.isActive()).toBe(true);
      expect(controller.hasSnapshot()).toBe(false);
      expect(details).toHaveLength(0);
      expect(original).toHaveBeenCalledTimes(1);
      controller.stop();
    },
  );

  it('rolls back pending fetch invocation when listener registration throws', () => {
    const original = vi.fn(() => 'delegated');
    const { page, document } = metadataFacades(original);
    let pendingController;
    document.addEventListener = (type) => {
      if (type === X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE) {
        pendingController = installXAboutAccountRequestCapture(page);
        page.fetch(observedUrl(), { headers: observedHeaders });
        throw new Error('registration failure');
      }
    };
    expect(() => installXAboutAccountRequestCapture(page)).toThrow(
      'Unable to install X About Account request capture',
    );
    expect(pendingController.isActive()).toBe(false);
    expect(pendingController.hasSnapshot()).toBe(false);
    expect(page.fetch).toBe(original);
    expect(original).toHaveBeenCalledTimes(1);
  });

  it('keeps a stopped pending reservation until the outer installer unwinds', () => {
    const original = vi.fn(() => 'delegated');
    const { page } = metadataFacades(original);
    let storedFetch = original;
    const nested = [];
    let claimed = false;
    Object.defineProperty(page, 'fetch', {
      configurable: true,
      get() { return storedFetch; },
      set(value) {
        storedFetch = value;
        if (!claimed) {
          claimed = true;
          const first = installXAboutAccountRequestCapture(page);
          first.stop();
          nested.push(first, installXAboutAccountRequestCapture(page));
        }
      },
    });
    const outer = installXAboutAccountRequestCapture(page);
    expect(nested).toEqual([outer, outer]);
    expect(outer.isActive()).toBe(false);
    expect(storedFetch).toBe(original);
    const later = installXAboutAccountRequestCapture(page);
    expect(later).not.toBe(outer);
    expect(later.isActive()).toBe(true);
    later.stop();
  });

  it('releases the page facade from retained controller methods after stop', () => {
    const original = vi.fn(() => 'delegated');
    const { page } = metadataFacades(original);
    const revocable = Proxy.revocable(page, {});
    const controller = installXAboutAccountRequestCapture(revocable.proxy);
    const retainedWrapper = page.fetch;
    controller.stop();
    revocable.revoke();
    expect(controller.stop()).toBeUndefined();
    expect(controller.isActive()).toBe(false);
    expect(controller.hasSnapshot()).toBe(false);
    expect(retainedWrapper('input')).toBe('delegated');
    expect(original).toHaveBeenCalledWith('input');
  });

  it.each(['listener removal', 'ownership readback', 'restoration assignment'])(
    'retains the stopped reservation during %s and permits a clean reinstall', (reentryPoint) => {
      const original = vi.fn(() => 'delegated');
      const { page, document } = metadataFacades(original);
      const received = [];
      let storedFetch = original;
      let cleanupStarted = false;
      let reentryEnabled = true;
      Object.defineProperty(page, 'fetch', {
        configurable: true,
        get() {
          if (cleanupStarted && reentryEnabled && reentryPoint === 'ownership readback') {
            reentryEnabled = false;
            received.push(installXAboutAccountRequestCapture(page));
          }
          return storedFetch;
        },
        set(value) {
          if (cleanupStarted && reentryEnabled && reentryPoint === 'restoration assignment') {
            reentryEnabled = false;
            received.push(installXAboutAccountRequestCapture(page));
          }
          storedFetch = value;
        },
      });
      const originalRemove = document.removeEventListener.bind(document);
      document.removeEventListener = (type, listener) => {
        originalRemove(type, listener);
        if (cleanupStarted && reentryEnabled && reentryPoint === 'listener removal') {
          reentryEnabled = false;
          received.push(installXAboutAccountRequestCapture(page));
        }
      };

      const controller = installXAboutAccountRequestCapture(page);
      const retainedWrapper = storedFetch;
      cleanupStarted = true;
      controller.stop();
      expect(received).toEqual([controller]);
      expect(storedFetch).toBe(original);
      expect(document.listeners.get(X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE)).toEqual([]);
      expect(retainedWrapper('after-stop')).toBe('delegated');
      expect(controller.stop()).toBeUndefined();
      expect(controller.isActive()).toBe(false);
      expect(controller.hasSnapshot()).toBe(false);

      const later = installXAboutAccountRequestCapture(page);
      expect(later).not.toBe(controller);
      expect(later.isActive()).toBe(true);
      later.stop();
    },
  );

  it('retains the failed reservation throughout installation-failure restoration', () => {
    const original = vi.fn(() => 'delegated');
    const { page, document } = metadataFacades(original);
    let storedFetch = original;
    let failedController;
    let registrationFailed = false;
    const received = [];
    Object.defineProperty(page, 'fetch', {
      configurable: true,
      get() { return storedFetch; },
      set(value) {
        if (registrationFailed && value === original) {
          received.push(installXAboutAccountRequestCapture(page));
        }
        storedFetch = value;
      },
    });
    const originalAdd = document.addEventListener.bind(document);
    document.addEventListener = (type, listener) => {
      originalAdd(type, listener);
      if (type === X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE) {
        failedController = installXAboutAccountRequestCapture(page);
        registrationFailed = true;
        throw new Error('after registration');
      }
    };

    expect(() => installXAboutAccountRequestCapture(page)).toThrow(
      'Unable to install X About Account request capture',
    );
    expect(received).toEqual([failedController]);
    expect(failedController.isActive()).toBe(false);
    expect(storedFetch).toBe(original);
    expect(document.listeners.get(X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE)).toEqual([]);

    document.addEventListener = originalAdd;
    const later = installXAboutAccountRequestCapture(page);
    expect(later).not.toBe(failedController);
    expect(later.isActive()).toBe(true);
    later.stop();
  });

  it('does not overwrite a newer page-owned fetch observed during cleanup', () => {
    const original = vi.fn(() => 'original');
    const newer = vi.fn(() => 'newer');
    const { page } = metadataFacades(original);
    let storedFetch = original;
    let stopping = false;
    let stopRead = false;
    Object.defineProperty(page, 'fetch', {
      configurable: true,
      get() {
        if (stopping && !stopRead) {
          stopRead = true;
          storedFetch = newer;
        }
        return storedFetch;
      },
      set(value) { storedFetch = value; },
    });
    const controller = installXAboutAccountRequestCapture(page);
    stopping = true;
    controller.stop();
    expect(storedFetch).toBe(newer);
    expect(page.fetch()).toBe('newer');
  });

  it('separates the original fetch delegate from controller-owned cleanup controls', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../src/page/x-about-account-request-capture.js', import.meta.url), 'utf8',
    ));
    expect(source).toContain('function createFetchWrapper(fetch)');
    expect(source).toContain('activateWrapper = null;');
    expect(source).toContain('deactivateWrapper = null;');
    expect(source).not.toContain('wrapperState');
  });
});
