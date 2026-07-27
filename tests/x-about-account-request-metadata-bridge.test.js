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

  it.each([42, true, null, [], {}, 'x'.repeat(257), 'unsafe/value'])(
    'rejects queryId primitive %# without replacing valid metadata', (queryId) => {
      const { content, document } = metadataFacades();
      const errors = [];
      const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: (error) => errors.push(error) });
      bridge.start();
      document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, {
        detail: JSON.stringify({
          version: 1, origin: 'https://x.com', queryId, variables: {}, features: null,
          fieldToggles: null, headers: { authorization: 'secret', 'x-csrf-token': 'secret' },
        }),
      }));
      expect(bridge.hasSnapshot()).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Unable to accept X About Account request metadata');
      expect(errors[0].message).not.toContain('secret');
    },
  );

  it('lets stop claim listener registration synchronously and permits restart', () => {
    const { content, document } = metadataFacades();
    const originalAdd = document.addEventListener.bind(document);
    let claim = true;
    let bridge;
    document.addEventListener = (type, listener) => {
      originalAdd(type, listener);
      if (claim) bridge.stop();
    };
    bridge = createXAboutAccountRequestMetadataBridge(content, { onError: () => undefined });
    expect(bridge.start()).toBeUndefined();
    expect(bridge.isActive()).toBe(false);
    expect(bridge.hasSnapshot()).toBe(false);
    expect(document.listeners.get(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE)).toHaveLength(0);
    claim = false;
    bridge.start();
    expect(bridge.isActive()).toBe(true);
  });

  it('does not report detail failures after the detail getter stops the lifecycle', () => {
    const { content, document } = metadataFacades();
    const errors = [];
    const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: (error) => errors.push(error) });
    bridge.start();
    const event = { type: X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE };
    Object.defineProperty(event, 'detail', {
      get() { bridge.stop(); throw new Error('private failure'); },
    });
    document.dispatchEvent(event);
    expect(errors).toHaveLength(0);
    expect(bridge.isActive()).toBe(false);
  });

  it.each([
    ['version', '1'], ['origin', 1], ['variables', []], ['features', false],
    ['fieldToggles', 'none'], ['headers', []],
  ])('rejects wrong top-level type for %s', (name, value) => {
    const { content, document } = metadataFacades();
    const errors = [];
    const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: (error) => errors.push(error) });
    bridge.start();
    const snapshot = {
      version: 1, origin: 'https://x.com', queryId: 'query', variables: {}, features: null,
      fieldToggles: null, headers: { authorization: 'authorization', 'x-csrf-token': 'csrf' },
    };
    snapshot[name] = value;
    document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, {
      detail: JSON.stringify(snapshot),
    }));
    expect(bridge.hasSnapshot()).toBe(false);
    expect(errors).toHaveLength(1);
  });
});
