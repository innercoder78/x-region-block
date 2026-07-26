import { describe, expect, it, vi } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import {
  createXAboutAccountRequestTransport,
  X_ABOUT_ACCOUNT_REQUEST_TRANSPORT_VERSION,
} from '../src/content/x-about-account-request-transport.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';

const identity = () => createAccountIdentity({ handle: 'Example', accountId: '42', source: null });
const signal = () => createFakeAbortController().signal;
const context = (value = signal()) => ({ version: 1, signal: value });
const headers = () => ({ authorization: 'Bearer secret', 'x-csrf-token': ' csrf-secret ' });
const url = (parameters = { variables: { screen_name: 'example' } }, host = 'x.com', id = 'Test_ID-7') => {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) query.set(name, JSON.stringify(value));
  return `https://${host}/i/api/graphql/${id}/UserByScreenName?${query}`;
};
const response = (payload = { value: true }) => ({ ok: true, status: 200, json: vi.fn(() => payload) });
const setup = (overrides = {}) => {
  const fetch = overrides.fetch ?? vi.fn(async () => response());
  const createRequest = overrides.createRequest ?? vi.fn(() => ({ url: url(), headers: headers() }));
  return { fetch, createRequest, transport: createXAboutAccountRequestTransport({ fetch, createRequest }) };
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('X About Account request transport API', () => {
  it('is versioned, frozen, exact, and lazy', () => {
    const { transport, fetch, createRequest } = setup();
    expect(X_ABOUT_ACCOUNT_REQUEST_TRANSPORT_VERSION).toBe(1);
    expect(Object.keys(transport)).toEqual(['loadPayload']);
    expect(Object.isFrozen(transport)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('strictly validates options and reads dependencies once', () => {
    const plainMessage = 'X About Account request transport options must be a plain object';
    for (const value of [null, [], 1, () => {}, new (class {})()]) {
      expect(() => createXAboutAccountRequestTransport(value)).toThrowError(new TypeError(plainMessage));
    }
    const fetch = vi.fn();
    const createRequest = vi.fn();
    const nullOptions = Object.assign(Object.create(null), { fetch, createRequest });
    expect(Object.keys(createXAboutAccountRequestTransport(nullOptions))).toEqual(['loadPayload']);
    for (const options of [
      { fetch, createRequest, extra: true },
      Object.assign({ fetch, createRequest }, { [Symbol('extra')]: true }),
      Object.create({ fetch, createRequest }),
    ]) expect(() => createXAboutAccountRequestTransport(options))
      .toThrowError(/request transport options/);
    expect(() => createXAboutAccountRequestTransport({ fetch: null, createRequest }))
      .toThrowError(new TypeError('fetch must be a function'));
    expect(() => createXAboutAccountRequestTransport({ fetch, createRequest: null }))
      .toThrowError(new TypeError('createRequest must be a function'));
    let fetchReads = 0;
    let requestReads = 0;
    const accessors = {
      get fetch() { fetchReads += 1; return fetch; },
      get createRequest() { requestReads += 1; return createRequest; },
    };
    createXAboutAccountRequestTransport(accessors);
    expect([fetchReads, requestReads]).toEqual([1, 1]);
    const throwing = { fetch, get createRequest() { throw new Error('private'); } };
    expect(() => createXAboutAccountRequestTransport(throwing))
      .toThrowError(new TypeError('Invalid X About Account request transport options'));
  });
});

describe('X About Account request transport requests', () => {
  it('owns and rejects asynchronous descriptors without using eventual metadata', async () => {
    const valid = { url: url(), headers: headers() };
    const privateFailure = new Error('private descriptor failure');
    const cases = [
      () => Promise.resolve(valid),
      () => Promise.reject(privateFailure),
      () => ({ then(resolve) { resolve(valid); } }),
      () => ({ then(resolve, reject) { reject(privateFailure); } }),
      () => ({ then(resolve, reject) { resolve(valid); reject(privateFailure); } }),
    ];
    for (const makeDescriptor of cases) {
      const current = setup({ createRequest: makeDescriptor });
      const failure = await current.transport.loadPayload(identity(), context()).catch((error) => error);
      expect(failure).toEqual(new TypeError('Invalid X About Account request descriptor'));
      expect(failure.message).not.toContain('private descriptor failure');
      expect(current.fetch).not.toHaveBeenCalled();
    }
    await Promise.resolve();
  });

  it('reads a descriptor then property once and normalizes a throwing getter', async () => {
    let reads = 0;
    const descriptor = Object.create(null);
    Object.defineProperty(descriptor, 'then', { get() {
      reads += 1;
      throw new Error('private then failure');
    } });
    const current = setup({ createRequest: () => descriptor });
    await expect(current.transport.loadPayload(identity(), context()))
      .rejects.toEqual(new TypeError('Invalid X About Account request descriptor'));
    expect(reads).toBe(1);
    expect(current.fetch).not.toHaveBeenCalled();
  });

  it('validates the public broker contract before dependencies', async () => {
    const { transport, fetch, createRequest } = setup();
    for (const invalidIdentity of [
      createAccountIdentity({ handle: 'example', source: 'profile' }),
      { ...identity(), handle: 'Example' },
      { ...identity(), extra: true },
      Object.create(identity()),
    ]) await expect(transport.loadPayload(invalidIdentity, context()))
      .rejects.toThrowError(new TypeError('Invalid X About Account request transport request'));
    for (const invalidContext of [
      { version: 2, signal: signal() }, {}, { version: 1, signal: {} },
      { version: 1, signal: signal(), extra: true },
    ]) await expect(transport.loadPayload(identity(), invalidContext))
      .rejects.toThrowError(new TypeError('Invalid X About Account request transport request'));
    expect(fetch).not.toHaveBeenCalled();
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('uses the exact signal and exact fetch contract with canonical values', async () => {
    const originalHeaders = {
      Authorization: '  Bearer exact  ',
      'X-CSRF-Token': 'exact-csrf',
      'X-Twitter-Active-User': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'X-Twitter-Client-Language': 'en',
      'X-Guest-Token': 'guest',
      'X-Client-Transaction-Id': 'transaction',
    };
    const original = {
      url: url({
        fieldToggles: { z: false }, variables: { screen_name: 'example', count: 1 }, features: { a: true },
      }, 'twitter.com', 'a_Z-09'),
      headers: originalHeaders,
    };
    const fetch = vi.fn(function fetchDouble() {
      expect(this).toBeUndefined();
      return response('unchanged');
    });
    const createRequest = vi.fn(() => original);
    const transport = createXAboutAccountRequestTransport({ fetch, createRequest });
    const sharedSignal = signal();
    await expect(transport.loadPayload(identity(), context(sharedSignal))).resolves.toBe('unchanged');
    expect(createRequest).toHaveBeenCalledWith(identity(), { version: 1 });
    expect(Object.isFrozen(createRequest.mock.calls[0][1])).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [fetchedUrl, init] = fetch.mock.calls[0];
    expect(fetchedUrl).toBe(url({
      variables: { screen_name: 'example', count: 1 }, features: { a: true }, fieldToggles: { z: false },
    }, 'twitter.com', 'a_Z-09'));
    expect(init).toEqual({
      method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error',
      headers: Object.assign(Object.create(null), {
        authorization: '  Bearer exact  ', 'x-csrf-token': 'exact-csrf',
        'x-twitter-active-user': 'yes', 'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': 'en', 'x-guest-token': 'guest',
        'x-client-transaction-id': 'transaction', accept: 'application/json',
      }),
      signal: sharedSignal,
    });
    expect(Object.keys(init)).not.toContain('body');
    expect(original.headers).toEqual(originalHeaders);
  });

  it.each([
    'http://x.com/i/api/graphql/id/UserByScreenName?variables=%7B%7D',
    'https://api.x.com/i/api/graphql/id/UserByScreenName?variables=%7B%7D',
    'https://x.com:443/i/api/graphql/id/UserByScreenName?variables=%7B%7D',
    'https://user@x.com/i/api/graphql/id/UserByScreenName?variables=%7B%7D',
    'https://x.com/i/api/graphql/id/UserByScreenName/?variables=%7B%7D',
    'https://x.com/i/api/graphql//id/UserByScreenName?variables=%7B%7D',
    'https://x.com/i/api/graphql/id/usersbyscreenname?variables=%7B%7D',
    'https://x.com/i/api/graphql/bad$id/UserByScreenName?variables=%7B%7D',
    'https://x.com/i/api/graphql/id/UserByScreenName?unknown=%7B%7D',
    'https://x.com/i/api/graphql/id/UserByScreenName?variables=%ZZ',
  ])('rejects an unsafe URL without disclosing it: %s', async (badUrl) => {
    const { transport, fetch } = setup({ createRequest: () => ({ url: badUrl, headers: headers() }) });
    const failure = await transport.loadPayload(identity(), context()).catch((error) => error);
    expect(failure).toEqual(new TypeError('Invalid X About Account request descriptor'));
    expect(failure.message).not.toContain('example');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    '/./i/api/graphql/private_id/UserByScreenName',
    '/a/../i/api/graphql/private_id/UserByScreenName',
    '/a/%2e%2e/i/api/graphql/private_id/UserByScreenName',
    '/a/%2E%2e/i/api/graphql/private_id/UserByScreenName',
    '/a/.%2E/i/api/graphql/private_id/UserByScreenName',
    '/i/api/graphql/junk/../private_id/UserByScreenName',
    '/i/api/graphql/%2e%2e/graphql/private_id/UserByScreenName',
    '/i/api/graphql/private_id/./UserByScreenName',
    '/i/api/graphql/private_id/%2E/UserByScreenName',
  ])('rejects raw dot-segment repair before URL normalization: %s', async (pathname) => {
    const supplied = `https://x.com${pathname}?variables=${encodeURIComponent(JSON.stringify({
      screen_name: 'example', secret: 'private-variable',
    }))}`;
    const { transport, fetch } = setup({ createRequest: () => ({ url: supplied, headers: headers() }) });
    const failure = await transport.loadPayload(identity(), context()).catch((error) => error);
    expect(failure).toEqual(new TypeError('Invalid X About Account request descriptor'));
    expect(failure.message).not.toMatch(/private_id|example|private-variable|Bearer|csrf|https/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['#', '#private-fragment'])('rejects any fragment delimiter: %s', async (fragment) => {
    const supplied = `${url()}${fragment}`;
    const { transport, fetch } = setup({ createRequest: () => ({ url: supplied, headers: headers() }) });
    await expect(transport.loadPayload(identity(), context()))
      .rejects.toEqual(new TypeError('Invalid X About Account request descriptor'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects mismatched variables, duplicates, malformed objects, and oversized IDs', async () => {
    const values = [
      url({ variables: { screen_name: 'other' } }),
      `${url()}&variables=${encodeURIComponent('{"screen_name":"example"}')}`,
      url({ variables: [] }),
      url({ features: {}, variables: { screen_name: 'Example' } }),
      url({ variables: { screen_name: 'example' } }, 'x.com', 'a'.repeat(257)),
    ];
    for (const value of values) {
      const { transport } = setup({ createRequest: () => ({ url: value, headers: headers() }) });
      await expect(transport.loadPayload(identity(), context()))
        .rejects.toThrowError(new TypeError('Invalid X About Account request descriptor'));
    }
  });

  it('enforces the closed header policy without leaking secrets', async () => {
    const invalid = [
      { authorization: 'secret' },
      { authorization: '', 'x-csrf-token': 'secret' },
      { authorization: 'secret', 'x-csrf-token': 2 },
      { authorization: 'secret\r\nleak', 'x-csrf-token': 'secret' },
      { authorization: 'secret', Authorization: 'other', 'x-csrf-token': 'secret' },
      { authorization: 'secret', 'x-csrf-token': 'secret', cookie: 'private' },
      { authorization: 'secret', 'x-csrf-token': 'secret', accept: 'text/plain' },
      Object.assign({ authorization: 'secret', 'x-csrf-token': 'secret' }, { [Symbol('x')]: 'private' }),
    ];
    for (const supplied of invalid) {
      const { transport } = setup({ createRequest: () => ({ url: url(), headers: supplied }) });
      const failure = await transport.loadPayload(identity(), context()).catch((error) => error);
      expect(failure).toEqual(new TypeError('Invalid X About Account request descriptor'));
      expect(failure.message).not.toMatch(/secret|private|example|Test_ID/);
    }
  });
});

describe('X About Account request transport response and cancellation boundaries', () => {
  it.each([null, ['array'], 3, 'text', { object: true }])('returns JSON unchanged: %j', async (payload) => {
    const json = vi.fn(() => Promise.resolve(payload));
    const fetch = vi.fn(() => ({ ok: true, status: 200, json }));
    const { transport } = setup({ fetch });
    await expect(transport.loadPayload(identity(), context())).resolves.toBe(payload);
    expect(json.mock.contexts[0]).toBe(fetch.mock.results[0].value);
  });

  it('reads response properties once and does not parse a non-OK response', async () => {
    const reads = { ok: 0, status: 0, json: 0 };
    const json = vi.fn();
    const returned = {};
    for (const [key, value] of [['ok', false], ['status', 429], ['json', json]]) {
      Object.defineProperty(returned, key, { get() { reads[key] += 1; return value; } });
    }
    const { transport } = setup({ fetch: () => returned });
    await expect(transport.loadPayload(identity(), context()))
      .rejects.toThrowError(new Error('X About Account request failed'));
    expect(reads).toEqual({ ok: 1, status: 1, json: 1 });
    expect(json).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { ok: 1, status: 200, json() {} },
    { ok: true, status: 99, json() {} }, { ok: true, status: 200, json: null },
  ])('normalizes malformed responses', async (returned) => {
    const { transport } = setup({ fetch: () => returned });
    await expect(transport.loadPayload(identity(), context()))
      .rejects.toThrowError(new TypeError('Invalid X About Account response'));
  });

  it('normalizes preparation, fetch, and JSON errors without private values', async () => {
    const preparing = setup({ createRequest: () => { throw new Error('secret callback'); } });
    await expect(preparing.transport.loadPayload(identity(), context()))
      .rejects.toThrowError(new Error('Unable to prepare X About Account request'));
    for (const fetch of [() => { throw new Error('secret network'); }, () => Promise.reject(new Error('secret network'))]) {
      const current = setup({ fetch });
      await expect(current.transport.loadPayload(identity(), context()))
        .rejects.toThrowError(new Error('X About Account request failed'));
    }
    for (const json of [() => { throw new Error('secret body'); }, () => Promise.reject(new Error('secret body'))]) {
      const current = setup({ fetch: () => ({ ok: true, status: 200, json }) });
      await expect(current.transport.loadPayload(identity(), context()))
        .rejects.toThrowError(new Error('Unable to parse X About Account response'));
    }
  });

  it('gives abort precedence at preparation, fetch, and JSON boundaries', async () => {
    const before = createFakeAbortController();
    before.abort();
    const lazy = setup();
    await expect(lazy.transport.loadPayload(identity(), context(before.signal)))
      .rejects.toMatchObject({ name: 'AbortError', message: 'The operation was aborted' });
    expect(lazy.createRequest).not.toHaveBeenCalled();
    expect(lazy.fetch).not.toHaveBeenCalled();

    const preparing = createFakeAbortController();
    const afterDescriptor = setup({ createRequest: () => {
      preparing.abort();
      return { url: url(), headers: headers() };
    } });
    await expect(afterDescriptor.transport.loadPayload(identity(), context(preparing.signal)))
      .rejects.toMatchObject({ name: 'AbortError', message: 'The operation was aborted' });
    expect(afterDescriptor.fetch).not.toHaveBeenCalled();

    const parsing = createFakeAbortController();
    const duringJson = setup({ fetch: () => ({
      ok: true, status: 200, json() { parsing.abort(); return { stale: true }; },
    }) });
    await expect(duringJson.transport.loadPayload(identity(), context(parsing.signal)))
      .rejects.toMatchObject({ name: 'AbortError', message: 'The operation was aborted' });
  });

  it.each(['url', 'headers'])('gives abort precedence to a throwing descriptor %s getter', async (key) => {
    const controller = createFakeAbortController();
    const descriptor = { url: url(), headers: headers() };
    Object.defineProperty(descriptor, key, { enumerable: true, get() {
      controller.abort();
      throw new Error('private descriptor failure');
    } });
    const current = setup({ createRequest: () => descriptor });
    await expect(current.transport.loadPayload(identity(), context(controller.signal)))
      .rejects.toEqual(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    expect(current.fetch).not.toHaveBeenCalled();
  });

  it('gives abort precedence when request preparation throws', async () => {
    const controller = createFakeAbortController();
    const current = setup({ createRequest: () => {
      controller.abort();
      throw new Error('private preparation failure');
    } });
    await expect(current.transport.loadPayload(identity(), context(controller.signal)))
      .rejects.toEqual(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
  });

  it('gives abort precedence to a throwing header getter', async () => {
    const controller = createFakeAbortController();
    const suppliedHeaders = headers();
    Object.defineProperty(suppliedHeaders, 'authorization', { enumerable: true, get() {
      controller.abort();
      throw new Error('private header failure');
    } });
    const current = setup({ createRequest: () => ({ url: url(), headers: suppliedHeaders }) });
    await expect(current.transport.loadPayload(identity(), context(controller.signal)))
      .rejects.toMatchObject({ name: 'AbortError', message: 'The operation was aborted' });
  });

  it.each(['ok', 'status', 'json'])('gives abort precedence to a throwing response %s getter', async (key) => {
    const controller = createFakeAbortController();
    const returned = { ok: true, status: 200, json() {} };
    Object.defineProperty(returned, key, { get() {
      controller.abort();
      throw new Error('private response failure');
    } });
    const current = setup({ fetch: () => returned });
    await expect(current.transport.loadPayload(identity(), context(controller.signal)))
      .rejects.toMatchObject({ name: 'AbortError', message: 'The operation was aborted' });
  });

  it('gives abort precedence to non-OK, fetch rejection, and JSON rejection', async () => {
    const nonOkController = createFakeAbortController();
    const nonOk = { status: 503, json: vi.fn() };
    Object.defineProperty(nonOk, 'ok', { get() { nonOkController.abort(); return false; } });
    const nonOkSetup = setup({ fetch: () => nonOk });
    await expect(nonOkSetup.transport.loadPayload(identity(), context(nonOkController.signal)))
      .rejects.toMatchObject({ name: 'AbortError', message: 'The operation was aborted' });
    expect(nonOk.json).not.toHaveBeenCalled();

    const fetchController = createFakeAbortController();
    const fetchSetup = setup({ fetch: () => Promise.reject().finally(() => fetchController.abort()) });
    await expect(fetchSetup.transport.loadPayload(identity(), context(fetchController.signal)))
      .rejects.toMatchObject({ name: 'AbortError', message: 'The operation was aborted' });

    const jsonController = createFakeAbortController();
    const jsonSetup = setup({ fetch: () => ({ ok: true, status: 200, json: () => (
      Promise.reject().finally(() => jsonController.abort())
    ) }) });
    await expect(jsonSetup.transport.loadPayload(identity(), context(jsonController.signal)))
      .rejects.toMatchObject({ name: 'AbortError', message: 'The operation was aborted' });
  });

  it.each(['reject', 'resolve'])('owns a fetch that aborts synchronously and later %ss', async (outcome) => {
    const controller = createFakeAbortController();
    const pending = deferred();
    const responseGetter = vi.fn(() => true);
    const returned = { status: 200, json: vi.fn() };
    Object.defineProperty(returned, 'ok', { get: responseGetter });
    const fetch = vi.fn(() => {
      controller.abort();
      return pending.promise;
    });
    const current = setup({ fetch });
    const result = current.transport.loadPayload(identity(), context(controller.signal));
    if (outcome === 'reject') pending.reject(new Error('private late network failure'));
    else pending.resolve(returned);
    await expect(result).rejects.toMatchObject({
      name: 'AbortError', message: 'The operation was aborted',
    });
    expect(responseGetter).not.toHaveBeenCalled();
    expect(returned.json).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('owns a rejected fetch returned during synchronous abort', async () => {
    const controller = createFakeAbortController();
    const fetch = vi.fn(() => {
      controller.abort();
      return Promise.reject(new Error('private immediate network failure'));
    });
    const current = setup({ fetch });
    const failure = await current.transport.loadPayload(identity(), context(controller.signal))
      .catch((error) => error);
    expect(failure).toMatchObject({ name: 'AbortError', message: 'The operation was aborted' });
    expect(failure.message).not.toContain('private');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('owns a throwing fetch thenable during synchronous abort', async () => {
    const controller = createFakeAbortController();
    const thenable = Object.create(null);
    Object.defineProperty(thenable, 'then', { get() { throw new Error('private then failure'); } });
    const current = setup({ fetch: () => { controller.abort(); return thenable; } });
    await expect(current.transport.loadPayload(identity(), context(controller.signal)))
      .rejects.toMatchObject({ name: 'AbortError', message: 'The operation was aborted' });
  });
});
