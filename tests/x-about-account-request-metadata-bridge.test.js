import { describe, expect, it } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { createXAboutAccountRequestMetadataBridge } from '../src/content/x-about-account-request-metadata-bridge.js';
import { X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE } from '../src/shared/x-about-account-request-metadata-event.js';
import { MetadataEvent, metadataFacades } from './helpers/x-request-metadata-facade.js';

it('accepts the minimal v2 snapshot and creates an exact About Account request', () => {
  const { content, document } = metadataFacades();
  const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: () => undefined });
  bridge.start();
  document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, { detail: JSON.stringify({
    version: 2, origin: 'https://x.com', queryId: 'live_query',
    headers: { authorization: 'Bearer test', 'x-csrf-token': 'csrf' },
  }) }));
  const request = bridge.createRequest(createAccountIdentity({ handle: 'Canonical' }), { version: 1 });
  expect(new URL(request.url).pathname).toBe('/i/api/graphql/live_query/AboutAccountQuery');
  expect(JSON.parse(new URL(request.url).searchParams.get('variables'))).toEqual({ screenName: 'canonical' });
  expect([...new URL(request.url).searchParams.keys()]).toEqual(['variables']);
});

describe('metadata validation', () => {
  it('rejects inherited request templates', () => {
    const { content, document } = metadataFacades(); const errors = [];
    const bridge = createXAboutAccountRequestMetadataBridge(content, { onError: (e) => errors.push(e) }); bridge.start();
    document.dispatchEvent(new MetadataEvent(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, { detail: JSON.stringify({
      version: 2, origin: 'https://x.com', queryId: 'query', variables: {},
      headers: { authorization: 'a', 'x-csrf-token': 'b' },
    }) }));
    expect(bridge.hasSnapshot()).toBe(false); expect(errors[0].message).not.toContain('Bearer test');
  });
});
