import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { installXAboutAccountRequestCapture } from '../src/page/x-about-account-request-capture.js';
import { installXAboutAccountRequestExecutor } from '../src/page/x-about-account-request-executor.js';
import { X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE, X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE,
  parseAboutAccountResponseDetail, serializeAboutAccountRequest } from '../src/shared/x-about-account-request-event.js';
import { metadataFacades, MetadataEvent, observedHeaders } from './helpers/x-request-metadata-facade.js';

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
});
