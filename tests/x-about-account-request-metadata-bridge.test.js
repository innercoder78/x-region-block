import { describe, expect, it } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import {
  X_ABOUT_ACCOUNT_REQUEST_METADATA_BRIDGE_VERSION, createXAboutAccountRequestMetadataBridge,
} from '../src/content/x-about-account-request-metadata-bridge.js';
import { X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE } from '../src/shared/x-about-account-request-metadata-event.js';
import { MetadataEvent, metadataFacades } from './helpers/x-request-metadata-facade.js';

describe('X About Account request metadata bridge', () => {
  it('validates events and creates fresh transport descriptors', () => {
    const { content, document } = metadataFacades();
    const errors = [];
    const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: (error) => errors.push(error) });
    expect(X_ABOUT_ACCOUNT_REQUEST_METADATA_BRIDGE_VERSION).toBe(1);
    expect(Object.keys(bridge)).toEqual(['start', 'stop', 'createRequest', 'hasSnapshot', 'isActive']);
    expect(Object.isFrozen(bridge)).toBe(true);
    bridge.start();
    const detail = JSON.stringify({
      version: 1, origin: 'https://x.com', queryId: 'learned_query', variables: { reusable: true },
      features: null, fieldToggles: null,
      headers: { authorization: 'Bearer test-only', 'x-csrf-token': 'test-only' },
    });
    document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, { detail }));
    const identity = createAccountIdentity({ handle: 'Different', source: null });
    const first = bridge.createRequest(identity, { version: 1 });
    const second = bridge.createRequest(identity, { version: 1 });
    expect(first).not.toBe(second);
    expect(first.headers).not.toBe(second.headers);
    expect(Object.keys(first)).toEqual(['url', 'headers']);
    expect(Object.isFrozen(first.headers)).toBe(true);
    expect(decodeURIComponent(first.url)).toContain('"screen_name":"different"');
    document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, { detail: '{}' }));
    expect(errors).toHaveLength(1);
    expect(bridge.createRequest(identity, { version: 1 }).url).toBe(first.url);
    bridge.stop();
    expect(() => bridge.createRequest(identity, { version: 1 })).toThrow('not active');
  });
});
