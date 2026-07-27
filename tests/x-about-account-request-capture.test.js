import { describe, expect, it, vi } from 'vitest';
import {
  X_ABOUT_ACCOUNT_REQUEST_CAPTURE_VERSION, installXAboutAccountRequestCapture,
} from '../src/page/x-about-account-request-capture.js';
import { X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE } from '../src/shared/x-about-account-request-metadata-event.js';
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

  it.each([
    () => Object.entries(observedHeaders).filter(([name]) => name !== 'cookie'),
    () => new Headers(observedHeaders),
  ])('captures repeatable safe header forms', (headersFactory) => {
    const { page, document } = metadataFacades(() => 'unchanged');
    const details = [];
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, (event) => details.push(event.detail));
    installXAboutAccountRequestCapture(page);
    page.fetch(observedUrl(), { headers: headersFactory() });
    expect(details).toHaveLength(1);
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
});
