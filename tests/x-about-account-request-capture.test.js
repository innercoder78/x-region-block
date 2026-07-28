import { describe, expect, it, vi } from 'vitest';
import {
  X_ABOUT_ACCOUNT_REQUEST_CAPTURE_VERSION, installXAboutAccountRequestCapture,
  invalidatePrivateXAboutAccountSnapshot, readPrivateXAboutAccountSnapshot,
} from '../src/page/x-about-account-request-capture.js';
import {
  X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE,
  X_ABOUT_ACCOUNT_REQUEST_METADATA_REQUEST_EVENT_TYPE,
} from '../src/shared/x-about-account-request-metadata-event.js';
import { metadataFacades, observedHeaders, observedUrl } from './helpers/x-request-metadata-facade.js';
import { X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID } from '../src/shared/x-about-account-query.js';

describe('X About Account request capture', () => {
  it('observes only after a successful original fetch and accepts relative generic GraphQL URLs', () => {
    const order = [];
    const fetch = vi.fn(() => { order.push('fetch'); return 'exact'; });
    const { page, document } = metadataFacades(fetch);
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, (event) => {
      order.push('metadata');
      expect(JSON.parse(event.detail).queryId).toBe(X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID);
    });
    installXAboutAccountRequestCapture(page);
    expect(page.fetch('/i/api/graphql/generic/HomeTimeline?variables=%7B%7D',
      { headers: observedHeaders })).toBe('exact');
    expect(order).toEqual(['fetch', 'metadata']);
  });

  it('does not republish metadata for volatile auxiliary-header changes', () => {
    const { page, document } = metadataFacades(() => undefined);
    const details = [];
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE,
      (event) => details.push(event.detail));
    installXAboutAccountRequestCapture(page);
    const url = '/i/api/graphql/generic/HomeTimeline?variables=%7B%7D';
    page.fetch(url, { headers: observedHeaders });
    page.fetch(url, { headers: { ...observedHeaders, 'x-client-transaction-id': 'changed' } });
    page.fetch(url, { headers: { ...observedHeaders, 'x-twitter-client-language': 'fr' } });
    page.fetch(url, { headers: { ...observedHeaders, 'x-twitter-active-user': 'no' } });
    expect(details).toHaveLength(1);
  });

  it.each([X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID, 'previous_live_query'])(
    'requires the first different live query after rejecting %s', (rejectedQuery) => {
    const { page, document } = metadataFacades(() => undefined); const details = [];
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE,
      (event) => details.push(JSON.parse(event.detail)));
    const capture = installXAboutAccountRequestCapture(page);
    if (rejectedQuery === X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID) {
      page.fetch('/i/api/graphql/generic/HomeTimeline?x=1', { headers: observedHeaders });
    } else page.fetch(observedUrl(rejectedQuery), { headers: observedHeaders });
    expect(details.at(-1).queryId).toBe(rejectedQuery);
    expect(invalidatePrivateXAboutAccountSnapshot(capture, 'query',
      readPrivateXAboutAccountSnapshot(capture))).toBe(true);
    const count = details.length;
    page.fetch('/i/api/graphql/generic/HomeTimeline?x=2', { headers: observedHeaders });
    page.fetch('/i/api/graphql/generic/HomeTimeline?x=3', {
      headers: { ...observedHeaders, authorization: 'Bearer changed' },
    });
    page.fetch(observedUrl(rejectedQuery), { headers: observedHeaders });
    expect(details).toHaveLength(count);
    page.fetch(observedUrl('different_live_query'), { headers: observedHeaders });
    expect(details).toHaveLength(count + 1);
    expect(details.at(-1).queryId).toBe('different_live_query');
    capture.stop();
    },
  );

  it('passively observes XHR only after successful open, headers, and send', () => {
    const order = [];
    class FakeXHR {
      open(...args) { order.push(['open', ...args]); return 'opened'; }
      setRequestHeader(...args) { order.push(['header', ...args]); return 'set'; }
      send(...args) { order.push(['send', ...args]); return 'sent'; }
    }
    const originals = { open: FakeXHR.prototype.open,
      setRequestHeader: FakeXHR.prototype.setRequestHeader, send: FakeXHR.prototype.send };
    const { page, document } = metadataFacades(() => undefined);
    page.XMLHttpRequest = FakeXHR;
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE,
      () => order.push(['metadata']));
    const controller = installXAboutAccountRequestCapture(page);
    const xhr = new FakeXHR();
    expect(xhr.open('GET', '/i/api/graphql/generic/HomeTimeline?x=1')).toBe('opened');
    expect(xhr.setRequestHeader('authorization', 'Bearer test')).toBe('set');
    xhr.setRequestHeader('x-csrf-token', 'csrf');
    expect(xhr.send('untouched body')).toBe('sent');
    expect(order.at(-2)[0]).toBe('send');
    expect(order.at(-1)[0]).toBe('metadata');
    controller.stop();
    expect(FakeXHR.prototype.open).toBe(originals.open);
    expect(FakeXHR.prototype.setRequestHeader).toBe(originals.setRequestHeader);
    expect(FakeXHR.prototype.send).toBe(originals.send);
  });

  it('publishes nothing when original fetch or XHR send throws', () => {
    const failure = new Error('exact failure');
    class FakeXHR {
      open() {} setRequestHeader() {} send() { throw failure; }
    }
    const fetch = vi.fn(() => { throw failure; });
    const { page, document } = metadataFacades(fetch); page.XMLHttpRequest = FakeXHR;
    const details = [];
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, (event) => details.push(event));
    installXAboutAccountRequestCapture(page);
    expect(() => page.fetch(observedUrl(), { headers: observedHeaders })).toThrow(failure);
    const xhr = new FakeXHR(); xhr.open('GET', observedUrl());
    xhr.setRequestHeader('authorization', 'Bearer test'); xhr.setRequestHeader('x-csrf-token', 'csrf');
    expect(() => xhr.send()).toThrow(failure);
    expect(details).toEqual([]);
  });
  it('preserves newer XHR methods and permits clean reinjection without stacking', () => {
    class FakeXHR { open() { return 'open'; } setRequestHeader() {} send() { return 'send'; } }
    const { page } = metadataFacades(() => undefined); page.XMLHttpRequest = FakeXHR;
    const first = installXAboutAccountRequestCapture(page);
    const retainedOpen = FakeXHR.prototype.open;
    const newerSend = vi.fn(() => 'newer'); FakeXHR.prototype.send = newerSend;
    first.stop();
    expect(FakeXHR.prototype.send).toBe(newerSend);
    expect(Reflect.apply(retainedOpen, new FakeXHR(), ['GET', observedUrl()])).toBe('open');
    const second = installXAboutAccountRequestCapture(page);
    expect(second).not.toBe(first);
    expect(installXAboutAccountRequestCapture(page)).toBe(second);
    second.stop();
  });

  it('does not add extension properties to observed XHR instances', () => {
    class FakeXHR { open() {} setRequestHeader() {} send() {} }
    const { page } = metadataFacades(() => undefined); page.XMLHttpRequest = FakeXHR;
    installXAboutAccountRequestCapture(page);
    const xhr = new FakeXHR(); const before = Reflect.ownKeys(xhr);
    xhr.open('GET', observedUrl()); xhr.setRequestHeader('authorization', 'a'); xhr.send();
    expect(Reflect.ownKeys(xhr)).toEqual(before);
  });
  it('is versioned, idempotent, sanitizes metadata, and restores fetch', () => {
    const fetch = vi.fn(() => 'page-result');
    const { page, document } = metadataFacades(fetch);
    const details = [];
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, (event) => details.push(event.detail));
    const controller = installXAboutAccountRequestCapture(page);
    expect(X_ABOUT_ACCOUNT_REQUEST_CAPTURE_VERSION).toBe(2);
    expect(Object.keys(controller)).toEqual(['stop', 'isActive', 'hasSnapshot']);
    expect(Object.isFrozen(controller)).toBe(true);
    expect(installXAboutAccountRequestCapture(page)).toBe(controller);
    const input = observedUrl();
    const init = { headers: observedHeaders };
    expect(page.fetch(input, init)).toBe('page-result');
    expect(fetch).toHaveBeenCalledWith(input, init);
    const snapshot = JSON.parse(details[0]);
    expect(Object.keys(snapshot)).toEqual([
      'version', 'origin', 'revision', 'queryId', 'headers',
    ]);
    expect(details[0]).not.toContain('Observed');
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

  it('reserves the pending controller before reading the XHR constructor', () => {
    const { page } = metadataFacades(() => undefined);
    let reentered; let reads = 0;
    class FakeXHR { open() {} setRequestHeader() {} send() {} }
    Object.defineProperty(page, 'XMLHttpRequest', { configurable: true, get() {
      reads += 1; reentered = installXAboutAccountRequestCapture(page); return FakeXHR;
    } });
    const controller = installXAboutAccountRequestCapture(page);
    expect(reentered).toBe(controller); expect(reads).toBe(1); controller.stop();
  });

  it.each(['open', 'setRequestHeader', 'send'])(
    'returns the pending controller during XHR %s assignment', (observedName) => {
      const { page } = metadataFacades(() => undefined);
      const target = { open() {}, setRequestHeader() {}, send() {} };
      let reentered; let controller;
      const prototype = new Proxy(target, { set(object, name, value) {
        Reflect.set(object, name, value);
        if (name === observedName && reentered === undefined) {
          reentered = installXAboutAccountRequestCapture(page);
        }
        return true;
      } });
      function FakeXHR() {} FakeXHR.prototype = prototype; page.XMLHttpRequest = FakeXHR;
      controller = installXAboutAccountRequestCapture(page);
      expect(reentered).toBe(controller); controller.stop();
    },
  );

  it.each(['open', 'setRequestHeader', 'send'])(
    'allows reentrant stop to claim pending XHR %s assignment', (observedName) => {
      const { page } = metadataFacades(() => undefined);
      const originals = { open() {}, setRequestHeader() {}, send() {} };
      const target = { ...originals }; let claimed = false; let reserved;
      const prototype = new Proxy(target, { set(object, name, value) {
        Reflect.set(object, name, value);
        if (name === observedName && !claimed) {
          claimed = true; reserved = installXAboutAccountRequestCapture(page); reserved.stop();
        }
        return true;
      } });
      function FakeXHR() {} FakeXHR.prototype = prototype; page.XMLHttpRequest = FakeXHR;
      expect(installXAboutAccountRequestCapture(page)).toBe(reserved);
      expect(reserved.isActive()).toBe(false);
      expect(target.open).toBe(originals.open);
      expect(target.setRequestHeader).toBe(originals.setRequestHeader);
      expect(target.send).toBe(originals.send);
    },
  );

  it.each(['setRequestHeader', 'send'])(
    'rolls back partial XHR installation when %s assignment fails', (failureName) => {
      const { page } = metadataFacades(() => undefined);
      const originals = { open() {}, setRequestHeader() {}, send() {} };
      const target = { ...originals }; let failed = false;
      const prototype = new Proxy(target, { set(object, name, value) {
        if (name === failureName && value !== originals[name] && !failed) {
          failed = true; throw new Error('assignment failed');
        }
        return Reflect.set(object, name, value);
      } });
      function FakeXHR() {} FakeXHR.prototype = prototype; page.XMLHttpRequest = FakeXHR;
      expect(() => installXAboutAccountRequestCapture(page)).toThrow('Unable to install');
      expect(target.open).toBe(originals.open);
      expect(target.setRequestHeader).toBe(originals.setRequestHeader);
      expect(target.send).toBe(originals.send);
    },
  );

  it.each(['open', 'setRequestHeader', 'send'])(
    'preserves a newer page-owned XHR %s method during stop', (name) => {
      class FakeXHR { open() {} setRequestHeader() {} send() {} }
      const { page } = metadataFacades(() => undefined); page.XMLHttpRequest = FakeXHR;
      const controller = installXAboutAccountRequestCapture(page);
      const newer = vi.fn(); FakeXHR.prototype[name] = newer; controller.stop();
      expect(FakeXHR.prototype[name]).toBe(newer);
    },
  );


  it('restores every owned XHR wrapper when listener registration fails', () => {
    class FakeXHR { open() {} setRequestHeader() {} send() {} }
    const originals = { open: FakeXHR.prototype.open,
      setRequestHeader: FakeXHR.prototype.setRequestHeader, send: FakeXHR.prototype.send };
    const { page, document } = metadataFacades(() => undefined); page.XMLHttpRequest = FakeXHR;
    document.addEventListener = () => { throw new Error('listener failure'); };
    expect(() => installXAboutAccountRequestCapture(page)).toThrow('Unable to install');
    expect(FakeXHR.prototype.open).toBe(originals.open);
    expect(FakeXHR.prototype.setRequestHeader).toBe(originals.setRequestHeader);
    expect(FakeXHR.prototype.send).toBe(originals.send);
  });

  it('rolls back owned XHR wrappers after ownership readback fails', () => {
    const { page } = metadataFacades(() => undefined);
    const originals = { open() {}, setRequestHeader() {}, send() {} };
    const target = { ...originals }; let openReads = 0; let installationStarted = false;
    const prototype = new Proxy(target, {
      set(object, name, value) { installationStarted = true; return Reflect.set(object, name, value); },
      get(object, name, receiver) {
        if (installationStarted && name === 'open' && (openReads += 1) === 1) {
          throw new Error('readback failure');
        }
        return Reflect.get(object, name, receiver);
      },
    });
    function FakeXHR() {} FakeXHR.prototype = prototype; page.XMLHttpRequest = FakeXHR;
    expect(() => installXAboutAccountRequestCapture(page)).toThrow('Unable to install');
    expect(target.open).toBe(originals.open);
    expect(target.setRequestHeader).toBe(originals.setRequestHeader);
    expect(target.send).toBe(originals.send);
  });

});
