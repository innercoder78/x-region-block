import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { installXAboutAccountRequestCapture,
  readPrivateXAboutAccountSnapshot } from '../src/page/x-about-account-request-capture.js';
import { installXAboutAccountRequestExecutor } from '../src/page/x-about-account-request-executor.js';
import { X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE, X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE,
  parseAboutAccountResponseDetail, serializeAboutAccountRequest } from '../src/shared/x-about-account-request-event.js';
import { metadataFacades, MetadataEvent, observedHeaders } from './helpers/x-request-metadata-facade.js';
const cyclicPayload = {}; cyclicPayload.self = cyclicPayload;

async function executeSuccessfulPayload(payload, id = 'opaque_compact_0001') {
  const fetch = vi.fn().mockReturnValueOnce('ordinary').mockResolvedValueOnce({
    ok: true, status: 200, json: () => Promise.resolve(payload),
  });
  const { page, document } = metadataFacades(fetch); page.AbortController = AbortController;
  const capture = installXAboutAccountRequestCapture(page);
  page.fetch('/i/api/graphql/live_query/AboutAccountQuery?variables=%7B%7D', { headers: observedHeaders });
  const executor = installXAboutAccountRequestExecutor(page, capture); const responses = [];
  document.addEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, (event) => responses.push(event.detail));
  document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
    { detail: serializeAboutAccountRequest(id, 'OpenAI', 1) }));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  executor.stop(); capture.stop();
  return parseAboutAccountResponseDetail(responses[0]);
}

describe('MAIN-world About Account executor', () => {
  it('accepts a distinct-realm serialized command and uses the captured original fetch', async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({ data: { user_result_by_screen_name: { result: {
        about_profile: { account_based_in: 'United States', source: 'United States App Store',
          location_accurate: false, connected_via: 'Google Play', app_store: 'North America App Store' },
      } } } }) }));
    const { page, document } = metadataFacades(fetch);
    page.AbortController = AbortController;
    const responses = [];
    document.addEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, (event) => responses.push(event.detail));
    const capture = installXAboutAccountRequestCapture(page);
    page.fetch('/i/api/graphql/live_query/AboutAccountQuery?variables=%7B%7D', { headers: {
      ...observedHeaders, 'x-twitter-client-language': 'fr',
      'x-client-transaction-id': 'request-specific-stale-value',
    } });
    fetch.mockClear();
    const executor = installXAboutAccountRequestExecutor(page, capture);
    const detail = vm.runInNewContext(`JSON.stringify({version:1,id:"opaque_request_0001",handle:"OpenAI",metadataRevision:1})`);
    expect(() => document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE, { detail }))).not.toThrow();
    await Promise.resolve(); await Promise.resolve();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/^https:\/\/x\.com\/i\/api\/graphql\/live_query\/AboutAccountQuery\?/);
    expect(JSON.parse(new URL(url).searchParams.get('variables'))).toEqual({ screenName: 'OpenAI' });
    expect(options).toMatchObject({ credentials: 'include' });
    expect(options).not.toHaveProperty('cache');
    expect(options).not.toHaveProperty('redirect');
    expect(options.headers).not.toHaveProperty('x-client-transaction-id');
    expect(options.headers['accept-language']).toBe('en-US,en;q=0.9');
    expect(options.headers['x-twitter-client-language']).toBe('fr');
    expect(typeof responses[0]).toBe('string');
    expect(parseAboutAccountResponseDetail(responses[0])).toMatchObject({
      ok: true, payload: { version: 2, accountBasedIn: 'United States',
        source: 'United States App Store', locationAccurate: false },
    });
    expect(Object.keys(parseAboutAccountResponseDetail(responses[0]).payload))
      .toEqual(['version', 'accountBasedIn', 'source', 'locationAccurate']);
    expect(responses[0]).not.toMatch(/connected_via|app_store|Google Play|North America App Store/);
    executor.stop(); capture.stop();
  });

  it.each([
    ['Web', true], ['Google Play', false],
  ])('preserves the explicit %s source and boolean accuracy', async (source, locationAccurate) => {
    const response = await executeSuccessfulPayload({ data: { user_result_by_screen_name: { result: {
      about_profile: { account_based_in: 'Canada', source, location_accurate: locationAccurate },
    } } } }, `opaque_source_${source.replace(/\s/g, '_')}`);
    expect(response.payload).toEqual({ version: 2, accountBasedIn: 'Canada', source, locationAccurate });
  });

  it('maps missing fields to null and excludes all unrelated metadata', async () => {
    const response = await executeSuccessfulPayload({ token: 'secret', headers: { authorization: 'secret' },
      url: 'https://private.invalid', data: { user_result_by_screen_name: { result: {
        handle: 'private-handle', account_creation_date: 'private-date', metadata: { id: 1 },
        about_profile: { account_based_in: 'Canada', connected_via: 'Web', app_store: 'Canada App Store' },
      } } } }, 'opaque_missing_fields');
    expect(response.payload).toEqual({ version: 2, accountBasedIn: 'Canada', source: null,
      locationAccurate: null });
    expect(JSON.stringify(response.payload)).not.toMatch(/secret|header|url|handle|creation|metadata|connected|store/i);
  });

  it('rejects accessors without invoking their getters', async () => {
    const getter = vi.fn(() => 'Web');
    const profile = { account_based_in: 'Canada', location_accurate: null };
    Object.defineProperty(profile, 'source', { enumerable: true, get: getter });
    const response = await executeSuccessfulPayload({ data: { user_result_by_screen_name: { result: {
      about_profile: profile,
    } } } }, 'opaque_accessor_field');
    expect(response).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    ['account_based_in', {}], ['account_based_in', []], ['account_based_in', 0],
    ['account_based_in', () => {}], ['account_based_in', Symbol('location')],
    ['source', {}], ['source', []], ['source', 0], ['source', () => {}], ['source', Symbol('source')],
    ['location_accurate', {}], ['location_accurate', []], ['location_accurate', 0],
    ['location_accurate', () => {}], ['location_accurate', Symbol('accuracy')],
  ])('rejects malformed compact field %s value %#', async (field, value) => {
    const profile = { account_based_in: 'Canada', source: 'Web', location_accurate: false };
    profile[field] = value;
    const response = await executeSuccessfulPayload({ data: { user_result_by_screen_name: { result: {
      about_profile: profile,
    } } } }, `opaque_bad_${field}_${typeof value}`);
    expect(response).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
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

  it('returns one sanitized synchronization response without fetch for a different revision', async () => {
    const fetch = vi.fn(() => 'ordinary'); const { page, document } = metadataFacades(fetch);
    page.AbortController = AbortController;
    const capture = installXAboutAccountRequestCapture(page);
    page.fetch('/i/api/graphql/live_query/AboutAccountQuery?variables=%7B%7D', { headers: observedHeaders });
    fetch.mockClear();
    const executor = installXAboutAccountRequestExecutor(page, capture); const responses = [];
    document.addEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, (event) => responses.push(event.detail));
    document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
      { detail: serializeAboutAccountRequest('opaque_revision_0001', 'OpenAI', 2) }));
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(responses).toHaveLength(1);
    expect(parseAboutAccountResponseDetail(responses[0])).toEqual({
      version: 1, id: 'opaque_revision_0001', ok: false, code: 'METADATA_SYNC',
      status: null, retryAfterMs: null, metadataRevision: 1,
    });
    expect(responses[0]).not.toMatch(/authorization|cookie|csrf|graphql|account/i);
    executor.stop(); capture.stop();
  });

  it('reports a null synchronization revision when the private snapshot is absent', async () => {
    const fetch = vi.fn(); const { page, document } = metadataFacades(fetch);
    page.AbortController = AbortController;
    const capture = installXAboutAccountRequestCapture(page);
    const executor = installXAboutAccountRequestExecutor(page, capture); const responses = [];
    document.addEventListener(X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE, (event) => responses.push(event.detail));
    document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE,
      { detail: serializeAboutAccountRequest('opaque_revision_none', 'OpenAI', 1) }));
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(parseAboutAccountResponseDetail(responses[0])).toMatchObject({
      code: 'METADATA_SYNC', metadataRevision: null,
    });
    executor.stop(); capture.stop();
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
      { detail: serializeAboutAccountRequest('opaque_request_0002', 'OpenAI', 1) }));
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
      { detail: serializeAboutAccountRequest(`opaque_invalid_${name.replace(/\s/g, '_')}`, 'OpenAI', 1) }));
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
      { detail: serializeAboutAccountRequest('opaque_unexpected_01', 'OpenAI', 1) }))).not.toThrow();
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
        { detail: serializeAboutAccountRequest(`opaque_race_${kind}`, 'OpenAI', 1) }));
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
