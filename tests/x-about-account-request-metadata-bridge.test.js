import { describe, expect, it } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import {
  X_ABOUT_ACCOUNT_REQUEST_METADATA_BRIDGE_VERSION, createXAboutAccountRequestMetadataBridge,
} from '../src/content/x-about-account-request-metadata-bridge.js';
import { X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE } from '../src/shared/x-about-account-request-metadata-event.js';
import { MetadataEvent, metadataFacades } from './helpers/x-request-metadata-facade.js';

describe('X About Account request metadata bridge', () => {
  it.each([
    ['authorization', 'Bearer changed'],
    ['x-csrf-token', 'csrf-changed'],
    ['x-guest-token', 'guest-changed'],
  ])('releases authentication recovery when %s changes', async (name, value) => {
    const { content, document } = metadataFacades();
    const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: () => undefined });
    bridge.start();
    const headers = { authorization: 'Bearer original', 'x-csrf-token': 'csrf-original',
      'x-guest-token': 'guest-original' };
    let revision = 0;
    const publish = (next, queryId = 'query') => document.dispatchEvent(new MetadataEvent(
      X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, { detail: JSON.stringify({
        version: 2, origin: 'https://x.com', revision: ++revision, queryId, headers: next,
      }) },
    ));
    publish(headers);
    bridge.createRequest.invalidateSnapshot('authentication');
    let released = false;
    const waiting = bridge.createRequest.waitForFreshSnapshot().then(() => { released = true; });
    publish({ ...headers, 'x-client-transaction-id': 'volatile' });
    publish({ ...headers, 'x-twitter-client-language': 'fr', 'x-twitter-active-user': 'no' });
    publish(headers, 'replacement_query');
    await Promise.resolve(); expect(released).toBe(false);
    publish({ ...headers, [name]: value });
    await waiting; expect(released).toBe(true);
  });
  it('validates events and creates fresh transport descriptors', () => {
    const { content, document } = metadataFacades();
    const errors = [];
    const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: (error) => errors.push(error) });
    expect(X_ABOUT_ACCOUNT_REQUEST_METADATA_BRIDGE_VERSION).toBe(1);
    expect(Object.keys(bridge)).toEqual(['start', 'stop', 'createRequest', 'invalidateRecovery',
      'getRecoveryState', 'hasSnapshot', 'isActive']);
    expect(Object.isFrozen(bridge)).toBe(true);
    bridge.start();
    const detail = JSON.stringify({
      version: 2, origin: 'https://x.com', revision: 1, queryId: 'learned_query',
      headers: { authorization: 'Bearer test-only', 'x-csrf-token': 'test-only' },
    });
    document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, { detail }));
    expect(Object.keys(bridge.getRecoveryState())).toEqual([
      'version', 'generation', 'revision', 'queryId', 'authenticationFingerprint',
    ]);
    expect(JSON.stringify(bridge.getRecoveryState())).not.toContain('test-only');
    const identity = createAccountIdentity({ handle: 'Different', source: null });
    const first = bridge.createRequest(identity, { version: 1 });
    const second = bridge.createRequest(identity, { version: 1 });
    expect(first).not.toBe(second);
    expect(first.headers).not.toBe(second.headers);
    expect(Object.keys(first)).toEqual(['url', 'headers']);
    expect(Object.isFrozen(first.headers)).toBe(true);
    expect(decodeURIComponent(first.url)).toContain('"screenName":"different"');
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
          version: 2, origin: 'https://x.com', revision: 1, queryId,
          headers: { authorization: 'secret', 'x-csrf-token': 'secret' },
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
      version: 2, origin: 'https://x.com', revision: 1, queryId: 'query',
      headers: { authorization: 'authorization', 'x-csrf-token': 'csrf' },
    };
    snapshot[name] = value;
    document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, {
      detail: JSON.stringify(snapshot),
    }));
    expect(bridge.hasSnapshot()).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it.each(['variables', 'features', 'fieldToggles'])(
    'rejects nested screenName in %s without replacing a valid snapshot', (name) => {
      const { content, document } = metadataFacades();
      const errors = [];
      const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: (error) => errors.push(error) });
      bridge.start();
      const valid = {
        version: 2, origin: 'https://x.com', revision: 1, queryId: 'valid_query',
        headers: { authorization: 'authorization', 'x-csrf-token': 'csrf' },
      };
      document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, {
        detail: JSON.stringify(valid),
      }));
      const invalid = structuredClone(valid);
      invalid.revision = 2;
      invalid[name] = { values: [null, { nested: { screenName: 'private-handle' } }] };
      document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, {
        detail: JSON.stringify(invalid),
      }));
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Unable to accept X About Account request metadata');
      const identity = createAccountIdentity({ handle: 'different' });
      expect(bridge.createRequest(identity, { version: 1 }).url).toContain('/valid_query/');
    },
  );
});
