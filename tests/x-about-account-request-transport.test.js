import { expect, it, vi } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { createXAboutAccountRequestTransport } from '../src/content/x-about-account-request-transport.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';
const identity = createAccountIdentity({ handle: 'Example' });
const context = () => ({ version: 1, signal: createFakeAbortController().signal });
const descriptor = (variables = { screenName: 'example' }, operation = 'AboutAccountQuery', extra = '') => ({
  url: `https://x.com/i/api/graphql/Test_Id/${operation}?variables=${encodeURIComponent(JSON.stringify(variables))}${extra}`,
  headers: { authorization: 'Bearer test', 'x-csrf-token': 'csrf' },
});
it('uses the exact safe fetch contract and returns JSON unchanged', async () => {
  const payload = { current: true }; const fetch = vi.fn(async () => ({ ok: true, status: 200, json: () => payload }));
  const transport = createXAboutAccountRequestTransport({ fetch, createRequest: () => descriptor() });
  await expect(transport.loadPayload(identity, context())).resolves.toBe(payload);
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error' });
});
it.each([
  descriptor({ screen_name: 'example' }), descriptor({ screenName: 'example' }, 'UserByScreenName'),
  descriptor({ screenName: 'example', extra: true }), descriptor(undefined, 'AboutAccountQuery', '&features=%7B%7D'),
])('rejects noncanonical descriptors', async (request) => {
  const fetch = vi.fn(); const transport = createXAboutAccountRequestTransport({ fetch, createRequest: () => request });
  await expect(transport.loadPayload(identity, context())).rejects.toThrow('Invalid X About Account request descriptor');
  expect(fetch).not.toHaveBeenCalled();
});
