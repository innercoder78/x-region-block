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
    expect(decodeURIComponent(url)).toContain('"screen_name":"requested"');
    expect(url).not.toContain('Observed');
    expect(init).toMatchObject({
      method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error',
      signal: controller.signal,
    });
    expect(init.headers.accept).toBe('application/json');
  });
});
