import { describe, expect, it, vi } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { createXAboutAccountPayloadBroker } from '../src/content/x-about-account-payload-broker.js';
import { createXAboutAccountRequestTransport } from '../src/content/x-about-account-request-transport.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const descriptor = (handle) => ({
  url: `https://x.com/i/api/graphql/Injected_Test_Id/UserByScreenName?${new URLSearchParams({
    variables: JSON.stringify({ screen_name: handle }),
  })}`,
  headers: { authorization: 'injected-test-value', 'x-csrf-token': 'injected-test-value' },
});
const consumerContext = (controller) => ({ version: 1, signal: controller.signal });
const consumerIdentity = (source) => createAccountIdentity({
  handle: 'Example', accountId: '42', source,
});

describe('request transport and payload broker integration', () => {
  it('deduplicates sources, uses the shared signal, and preserves independent cancellation', async () => {
    const pending = deferred();
    const sharedControllers = [];
    let fetchedSignal;
    const fetch = vi.fn((requestUrl, init) => {
      fetchedSignal = init.signal;
      return pending.promise;
    });
    const createRequest = vi.fn((identity) => descriptor(identity.handle));
    const transport = createXAboutAccountRequestTransport({ fetch, createRequest });
    const broker = createXAboutAccountPayloadBroker({
      loadPayload: transport.loadPayload,
      abortControllerFactory() {
        const controller = createFakeAbortController();
        sharedControllers.push(controller);
        return controller;
      },
      onError: vi.fn(),
    }).start();
    const firstController = createFakeAbortController();
    const secondController = createFakeAbortController();
    const first = broker.loadAboutAccountPayload(
      consumerIdentity('profile'), consumerContext(firstController),
    );
    const second = broker.loadAboutAccountPayload(
      consumerIdentity('timeline'), consumerContext(secondController),
    );
    expect(first).not.toBe(second);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(createRequest.mock.calls[0][0]).toEqual(consumerIdentity(null));
    expect(fetchedSignal).toBe(sharedControllers[0].signal);
    expect(fetchedSignal).not.toBe(firstController.signal);
    expect(fetchedSignal).not.toBe(secondController.signal);
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedControllers[0].signal.aborted).toBe(false);
    const payload = { data: { opaque: true } };
    pending.resolve({ ok: true, status: 200, json: () => payload });
    await expect(second).resolves.toBe(payload);
    expect(broker.getInFlightCount()).toBe(0);
    broker.stop();
  });

  it('aborts after the final consumer leaves and starts fresh after settlement', async () => {
    const pending = [];
    const sharedControllers = [];
    const fetch = vi.fn(() => {
      const request = deferred();
      pending.push(request);
      return request.promise;
    });
    const transport = createXAboutAccountRequestTransport({
      fetch,
      createRequest: (identity) => descriptor(identity.handle),
    });
    const broker = createXAboutAccountPayloadBroker({
      loadPayload: transport.loadPayload,
      abortControllerFactory() {
        const controller = createFakeAbortController();
        sharedControllers.push(controller);
        return controller;
      },
      onError: vi.fn(),
    }).start();
    const firstController = createFakeAbortController();
    const cancelled = broker.loadAboutAccountPayload(
      consumerIdentity('reply'), consumerContext(firstController),
    );
    firstController.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedControllers[0].signal.aborted).toBe(true);
    expect(broker.getInFlightCount()).toBe(0);

    const activeController = createFakeAbortController();
    const successful = broker.loadAboutAccountPayload(
      consumerIdentity('profile'), consumerContext(activeController),
    );
    const payload = { fresh: true };
    pending[1].resolve({ ok: true, status: 200, json: () => payload });
    await expect(successful).resolves.toBe(payload);
    const laterController = createFakeAbortController();
    const later = broker.loadAboutAccountPayload(
      consumerIdentity('profile'), consumerContext(laterController),
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    broker.stop();
    await expect(later).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedControllers[2].signal.aborted).toBe(true);
    expect(broker.getInFlightCount()).toBe(0);
  });

  it('delivers a transport rejection to all consumers and retries only on a later request', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('private network failure'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => ({ fresh: true }) });
    const createRequest = vi.fn((account) => descriptor(account.handle));
    const transport = createXAboutAccountRequestTransport({ fetch, createRequest });
    const broker = createXAboutAccountPayloadBroker({
      loadPayload: transport.loadPayload,
      abortControllerFactory: () => createFakeAbortController(),
      onError: vi.fn(),
    }).start();
    const first = broker.loadAboutAccountPayload(
      consumerIdentity('profile'), consumerContext(createFakeAbortController()),
    );
    const second = broker.loadAboutAccountPayload(
      consumerIdentity('timeline'), consumerContext(createFakeAbortController()),
    );
    await expect(first).rejects.toEqual(new Error('X About Account request failed'));
    await expect(second).rejects.toEqual(new Error('X About Account request failed'));
    expect(fetch).toHaveBeenCalledTimes(1);
    const later = broker.loadAboutAccountPayload(
      consumerIdentity('reply'), consumerContext(createFakeAbortController()),
    );
    await expect(later).resolves.toEqual({ fresh: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(createRequest).toHaveBeenCalledTimes(2);
    expect(createRequest.mock.calls.every(([account]) => account.source === null)).toBe(true);
    broker.stop();
  });
});
