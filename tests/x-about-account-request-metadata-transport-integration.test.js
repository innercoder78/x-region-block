import { describe, expect, it, vi } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { installXAboutAccountRequestCapture } from '../src/page/x-about-account-request-capture.js';
import { createXAboutAccountRequestMetadataBridge } from '../src/content/x-about-account-request-metadata-bridge.js';
import { createXAboutAccountRequestTransport } from '../src/content/x-about-account-request-transport.js';
import { metadataFacades, observedHeaders, observedUrl } from './helpers/x-request-metadata-facade.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';

describe('metadata bridge and transport integration', () => {
  it('uses the bridge callback without weakening transport request options', async () => {
    const { page, content } = metadataFacades(() => 'page-result');
    const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: () => undefined });
    bridge.start();
    installXAboutAccountRequestCapture(page);
    page.fetch(observedUrl('runtime_query'), { headers: observedHeaders });
    const response = { value: 'unchanged' };
    const transportFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => response }));
    const transport = createXAboutAccountRequestTransport({
      fetch: transportFetch, createRequest: bridge.createRequest,
    });
    const controller = createFakeAbortController();
    const identity = createAccountIdentity({ handle: 'requested' });
    await expect(transport.loadPayload(identity, {
      version: 1, signal: controller.signal,
    })).resolves.toBe(response);
    const [url, init] = transportFetch.mock.calls[0];
    expect(decodeURIComponent(url)).toContain('"screenName":"requested"');
    expect(url).not.toContain('Observed');
    expect(init).toMatchObject({
      method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error',
      signal: controller.signal,
    });
    expect(init.headers.accept).toBe('application/json');
    expect(init.headers['accept-language']).toBe('en-US,en;q=0.9');
  });

  it('retries once after fresh authentication metadata without navigation', async () => {
    const { page, content } = metadataFacades(() => 'page-result');
    const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: () => undefined });
    bridge.start();
    installXAboutAccountRequestCapture(page);
    page.fetch('/i/api/graphql/generic/HomeTimeline?x=1', { headers: observedHeaders });
    const payload = { data: { user_result_by_screen_name: { result: {
      about_profile: { account_based_in: 'Canada' },
    } } } };
    const transportFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: () => null })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => payload });
    const transport = createXAboutAccountRequestTransport({
      fetch: transportFetch, createRequest: bridge.createRequest,
    });
    const pending = transport.loadPayload(createAccountIdentity({ handle: 'requested' }), {
      version: 1, signal: createFakeAbortController().signal,
    });
    await Promise.resolve(); await Promise.resolve();
    expect(transportFetch).toHaveBeenCalledTimes(1);
    page.fetch('/i/api/graphql/generic/HomeTimeline?x=2', { headers: {
      ...observedHeaders, 'x-csrf-token': 'fresh-test-only-csrf',
    } });
    await expect(pending).resolves.toBe(payload);
    expect(transportFetch).toHaveBeenCalledTimes(2);
  });

  it('does not reuse an obsolete fallback and waits for a different live query ID', async () => {
    const { page, content } = metadataFacades(() => 'page-result');
    const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: () => undefined });
    bridge.start(); installXAboutAccountRequestCapture(page);
    page.fetch('/i/api/graphql/generic/HomeTimeline?x=1', { headers: observedHeaders });
    const transportFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: () => null })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => ({ replaced: true }) });
    const transport = createXAboutAccountRequestTransport({
      fetch: transportFetch, createRequest: bridge.createRequest,
    });
    const pending = transport.loadPayload(createAccountIdentity({ handle: 'requested' }), {
      version: 1, signal: createFakeAbortController().signal,
    });
    await Promise.resolve(); await Promise.resolve();
    page.fetch('/i/api/graphql/generic/HomeTimeline?x=2', { headers: observedHeaders });
    await Promise.resolve();
    expect(transportFetch).toHaveBeenCalledTimes(1);
    page.fetch(observedUrl('replacement_live_query'), { headers: observedHeaders });
    await expect(pending).resolves.toEqual({ replaced: true });
    expect(transportFetch.mock.calls[1][0]).toContain('/replacement_live_query/AboutAccountQuery');
  });
});
