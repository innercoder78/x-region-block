import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { installXAboutAccountRequestCapture,
  readPrivateXAboutAccountSnapshot } from '../src/page/x-about-account-request-capture.js';
import { installXAboutAccountRequestExecutor } from '../src/page/x-about-account-request-executor.js';
import { X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE, X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE,
  parseAboutAccountResponseDetail, serializeAboutAccountRequest } from '../src/shared/x-about-account-request-event.js';
import { metadataFacades, MetadataEvent, observedHeaders } from './helpers/x-request-metadata-facade.js';
const cyclicPayload = {}; cyclicPayload.self = cyclicPayload;

describe('MAIN-world About Account executor', () => {
  it('accepts a distinct-realm serialized command and uses the captured original fetch', async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({ country: 'Canada' }) }));
    const { page, document } = metadataFacades(fetch);
    page.AbortController = AbortController;
    const responses = [];
    document.addEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, (event) => responses.push(event.detail));
    const capture = installXAboutAccountRequestCapture(page);
    page.fetch('/i/api/graphql/live_query/AboutAccountQuery?variables=%7B%7D', { headers: observedHeaders });
    fetch.mockClear();
    const executor = installXAboutAccountRequestExecutor(page, capture);
    const detail = vm.runInNewContext(`JSON.stringify({version:1,id:"opaque_request_0001",handle:"OpenAI"})`);
    expect(() => document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE, { detail }))).not.toThrow();
    await Promise.resolve(); await Promise.resolve();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/^https:\/\/x\.com\/i\/api\/graphql\/live_query\/AboutAccountQuery\?/);
    expect(JSON.parse(new URL(url).searchParams.get('variables'))).toEqual({ screenName: 'OpenAI' });
    expect(options).toMatchObject({ credentials: 'include', cache: 'no-store', redirect: 'error' });
    expect(typeof responses[0]).toBe('string');
    expect(parseAboutAccountResponseDetail(responses[0])).toMatchObject({ ok: true, payload: { country: 'Canada' } });
    executor.stop(); capture.stop();
  });

  it('contains hostile non-string and malformed events without invoking fetch', () => {
    const fetch = vi.fn(() => 'ordinary'); const { page, document } = metadataFacades(fetch);
    page.AbortController = AbortController;
    const capture = installXAboutAccountRequestCapture(page);
    const executor = installXAboutAccountRequestExecutor(page, capture);
    fetch.mockClear();
    for (const detail of [{}, new Proxy({}, { get() { throw new Error('hostile'); } }), '{']) {
      expect(() => document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE, { detail }))).not.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled(); executor.stop(); capture.stop();
  });

  it('emits a bounded categorized response when page fetch fails', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('private failure')));
    const { page, document } = metadataFacades(fetch); page.AbortController = AbortController;
    const capture = installXAboutAccountRequestCapture(page);
    // Seed capture with a successful ordinary return before switching the delegate outcome.
    void page.fetch('/i/api/graphql/generic/HomeTimeline?x=1', { headers: observedHeaders }).catch(() => {});
    const executor = installXAboutAccountRequestExecutor(page, capture); const responses = [];
    document.addEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, (event) => responses.push(event.detail));
    document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
      { detail: serializeAboutAccountRequest('opaque_request_0002', 'OpenAI') }));
    await Promise.resolve(); await Promise.resolve();
    expect(parseAboutAccountResponseDetail(responses.at(-1))).toMatchObject({ ok: false, code: 'NETWORK' });
    executor.stop(); capture.stop();
  });

  it.each([
    ['undefined', undefined], ['function', () => {}], ['symbol', Symbol('payload')],
    ['function property', { invalid: () => {} }], ['cyclic', cyclicPayload],
  ])('converts an invalid successful %s payload into INVALID_PAYLOAD', async (name, payload) => {
    const fetch = vi.fn().mockReturnValueOnce('ordinary').mockResolvedValueOnce({
      ok: true, status: 200, json: () => Promise.resolve(payload),
    });
    const { page, document } = metadataFacades(fetch); page.AbortController = AbortController;
    const capture = installXAboutAccountRequestCapture(page);
    page.fetch('/i/api/graphql/generic/HomeTimeline?x=1', { headers: observedHeaders });
    const executor = installXAboutAccountRequestExecutor(page, capture); const responses = [];
    document.addEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, (event) => responses.push(event.detail));
    document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
      { detail: serializeAboutAccountRequest(`opaque_invalid_${name.replace(/\s/g, '_')}`, 'OpenAI') }));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(responses).toHaveLength(1);
    expect(parseAboutAccountResponseDetail(responses[0])).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    executor.stop(); capture.stop();
  });

  it('contains an unexpected parsed-request failure as one UNKNOWN response', async () => {
    const fetch = vi.fn(() => 'ordinary'); const { page, document } = metadataFacades(fetch);
    class ThrowingAbortController { constructor() { throw new Error('private internal exception'); } }
    page.AbortController = ThrowingAbortController;
    const capture = installXAboutAccountRequestCapture(page);
    page.fetch('/i/api/graphql/generic/HomeTimeline?x=1', { headers: observedHeaders });
    const executor = installXAboutAccountRequestExecutor(page, capture); const responses = [];
    document.addEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, (event) => responses.push(event.detail));
    expect(() => document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
      { detail: serializeAboutAccountRequest('opaque_unexpected_01', 'OpenAI') }))).not.toThrow();
    await Promise.resolve();
    expect(responses).toHaveLength(1);
    expect(parseAboutAccountResponseDetail(responses[0])).toMatchObject({ ok: false, code: 'UNKNOWN' });
    expect(responses[0]).not.toContain('private internal exception');
    executor.stop(); capture.stop();
  });

  it.each(['authentication', 'query'])(
    'does not clear a newer private %s snapshot when an older request fails', async (kind) => {
      let resolveRequest;
      const fetch = vi.fn((url, options) => options?.signal ? new Promise((resolve) => {
        resolveRequest = resolve;
      }) : 'ordinary');
      const { page, document } = metadataFacades(fetch); page.AbortController = AbortController;
      const capture = installXAboutAccountRequestCapture(page);
      page.fetch('/i/api/graphql/old_query/AboutAccountQuery?x=1', { headers: observedHeaders });
      const executor = installXAboutAccountRequestExecutor(page, capture); const responses = [];
      document.addEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, (event) => responses.push(event.detail));
      document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
        { detail: serializeAboutAccountRequest(`opaque_race_${kind}`, 'OpenAI') }));
      if (kind === 'authentication') {
        page.fetch('/i/api/graphql/generic/HomeTimeline?x=2', { headers: {
          ...observedHeaders, 'x-csrf-token': 'new-csrf',
        } });
      } else page.fetch('/i/api/graphql/new_query/AboutAccountQuery?x=2', { headers: observedHeaders });
      const newer = readPrivateXAboutAccountSnapshot(capture);
      resolveRequest({ ok: false, status: kind === 'authentication' ? 401 : 404,
        headers: new Headers(), json: () => null });
      await Promise.resolve(); await Promise.resolve();
      const retained = readPrivateXAboutAccountSnapshot(capture);
      expect(retained.revision).toBe(newer.revision);
      expect(retained.queryId).toBe(newer.queryId);
      expect(parseAboutAccountResponseDetail(responses[0]).metadataRevision).toBe(1);
      executor.stop(); capture.stop();
    },
  );
});
