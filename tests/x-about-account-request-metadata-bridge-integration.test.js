import { describe, expect, it, vi } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { installXAboutAccountRequestCapture } from '../src/page/x-about-account-request-capture.js';
import { createXAboutAccountRequestMetadataBridge } from '../src/content/x-about-account-request-metadata-bridge.js';
import { metadataFacades, observedHeaders, observedUrl } from './helpers/x-request-metadata-facade.js';

describe('request metadata event integration', () => {
  it('moves only sanitized latest metadata and supports lifecycle replay', () => {
    const fetch = vi.fn(() => Object.freeze({ unchanged: true }));
    const { page, content } = metadataFacades(fetch);
    const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: () => undefined });
    bridge.start();
    const capture = installXAboutAccountRequestCapture(page);
    const result = page.fetch(observedUrl('first_query'), { headers: observedHeaders });
    expect(result).toEqual({ unchanged: true });
    const identity = createAccountIdentity({ handle: 'target_account' });
    expect(bridge.createRequest(identity, { version: 1 }).url).toContain('/first_query/');
    bridge.stop();
    bridge.start();
    expect(bridge.hasSnapshot()).toBe(true);
    capture.stop();
    bridge.stop();
    bridge.start();
    expect(bridge.hasSnapshot()).toBe(false);
  });
});
