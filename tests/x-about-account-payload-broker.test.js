import { describe, expect, it, vi } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { ACCOUNT_TARGET_PROCESSOR_VERSION } from '../src/content/account-target-processor.js';
import {
  createXAboutAccountPayloadBroker,
  X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION,
} from '../src/content/x-about-account-payload-broker.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const identity = (source = 'profile', handle = 'Example', accountId = '12') =>
  createAccountIdentity({ handle, accountId, source });
const context = (signal) => ({ version: ACCOUNT_TARGET_PROCESSOR_VERSION, signal });
const setup = (overrides = {}) => {
  const controllers = [];
  const pending = deferred();
  const loadPayload = overrides.loadPayload ?? vi.fn(() => pending.promise);
  const broker = createXAboutAccountPayloadBroker({
    loadPayload,
    abortControllerFactory: overrides.abortControllerFactory ?? (() => {
      const controller = createFakeAbortController();
      controllers.push(controller);
      return controller;
    }),
    onError: overrides.onError ?? vi.fn(),
  });
  return { broker, controllers, pending, loadPayload };
};

describe('X About Account payload broker', () => {
  it('exposes the exact frozen lazy controller API', () => {
    const { broker, loadPayload } = setup();
    expect(X_ABOUT_ACCOUNT_PAYLOAD_BROKER_VERSION).toBe(1);
    expect(Object.keys(broker)).toEqual([
      'start', 'stop', 'loadAboutAccountPayload', 'getInFlightCount', 'isActive',
    ]);
    expect(Object.isFrozen(broker)).toBe(true);
    expect(broker.start()).toBe(broker);
    expect(broker.start()).toBe(broker);
    expect(loadPayload).not.toHaveBeenCalled();
    expect(broker.getInFlightCount()).toBe(0);
  });

  it('validates options and accepts null-prototype options', () => {
    const message = 'X About Account payload broker options must be a plain object';
    for (const value of [null, [], 1, () => {}, new (class {})()]) {
      expect(() => createXAboutAccountPayloadBroker(value)).toThrowError(new TypeError(message));
    }
    const options = Object.assign(Object.create(null), {
      loadPayload() {}, abortControllerFactory() {}, onError() {},
    });
    expect(createXAboutAccountPayloadBroker(options).isActive()).toBe(false);
    expect(() => createXAboutAccountPayloadBroker({ abortControllerFactory() {}, onError() {} }))
      .toThrowError(new TypeError('loadPayload must be a function'));
    expect(() => createXAboutAccountPayloadBroker({ loadPayload() {}, onError() {} }))
      .toThrowError(new TypeError('abortControllerFactory must be a function'));
    expect(() => createXAboutAccountPayloadBroker({ loadPayload() {}, abortControllerFactory() {} }))
      .toThrowError(new TypeError('onError must be a function'));
  });

  it('throws while inactive and validates malformed requests atomically', () => {
    const { broker, loadPayload, controllers } = setup();
    expect(() => broker.loadAboutAccountPayload({}, {}))
      .toThrowError(new TypeError('X About Account payload broker is not active'));
    broker.start();
    expect(() => broker.loadAboutAccountPayload({}, {}))
      .toThrowError(new TypeError('Invalid X About Account payload broker request'));
    expect(loadPayload).not.toHaveBeenCalled();
    expect(controllers).toHaveLength(0);
    expect(broker.getInFlightCount()).toBe(0);
  });

  it('deduplicates sources with distinct promises and a source-neutral identity', async () => {
    const { broker, pending, loadPayload, controllers } = setup();
    broker.start();
    const firstSignal = createFakeAbortController();
    const secondSignal = createFakeAbortController();
    const first = broker.loadAboutAccountPayload(identity('profile'), context(firstSignal.signal));
    const second = broker.loadAboutAccountPayload(identity('timeline'), context(secondSignal.signal));
    expect(first).not.toBe(second);
    expect(loadPayload).toHaveBeenCalledTimes(1);
    expect(loadPayload.mock.calls[0][0]).toEqual(identity(null));
    expect(Object.isFrozen(loadPayload.mock.calls[0][1])).toBe(true);
    expect(loadPayload.mock.calls[0][1]).toEqual({ version: 1, signal: controllers[0].signal });
    expect(broker.getInFlightCount()).toBe(1);
    const payload = {};
    pending.resolve(payload);
    await expect(first).resolves.toBe(payload);
    await expect(second).resolves.toBe(payload);
    expect(broker.getInFlightCount()).toBe(0);
    expect(firstSignal.listenerCount).toBe(0);
    expect(secondSignal.listenerCount).toBe(0);
  });

  it('cancels consumers independently and aborts only after the final consumer', async () => {
    const { broker, pending, controllers } = setup();
    broker.start();
    const firstSignal = createFakeAbortController();
    const secondSignal = createFakeAbortController();
    const first = broker.loadAboutAccountPayload(identity('profile'), context(firstSignal.signal));
    const second = broker.loadAboutAccountPayload(identity('timeline'), context(secondSignal.signal));
    firstSignal.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError', message: 'The operation was aborted' });
    expect(controllers[0].abortCount).toBe(0);
    pending.resolve('payload');
    await expect(second).resolves.toBe('payload');
    expect(controllers[0].abortCount).toBe(0);

    const thirdSignal = createFakeAbortController();
    const third = broker.loadAboutAccountPayload(identity(), context(thirdSignal.signal));
    thirdSignal.abort();
    await expect(third).rejects.toMatchObject({ name: 'AbortError' });
    expect(controllers[1].abortCount).toBe(1);
    expect(broker.getInFlightCount()).toBe(0);
  });

  it('retires and aborts all entries on stop, then restarts fresh', async () => {
    const { broker, controllers, loadPayload } = setup();
    broker.start();
    const signal = createFakeAbortController();
    const consumer = broker.loadAboutAccountPayload(identity(), context(signal.signal));
    expect(broker.stop()).toBe(broker);
    await expect(consumer).rejects.toMatchObject({ name: 'AbortError' });
    expect(controllers[0].abortCount).toBe(1);
    expect(signal.listenerCount).toBe(0);
    expect(broker.getInFlightCount()).toBe(0);
    expect(broker.stop()).toBe(broker);
    broker.start();
    const restarted = broker.loadAboutAccountPayload(
      identity(), context(createFakeAbortController().signal),
    );
    restarted.catch(() => {});
    expect(loadPayload).toHaveBeenCalledTimes(2);
    broker.stop();
  });

  it('turns synchronous loader and factory failures into promise rejections', async () => {
    const loaderError = new Error('transport');
    const loader = setup({ loadPayload: () => { throw loaderError; } });
    loader.broker.start();
    await expect(loader.broker.loadAboutAccountPayload(
      identity(), context(createFakeAbortController().signal),
    )).rejects.toBe(loaderError);

    const factoryError = new Error('factory');
    const factory = setup({ abortControllerFactory: () => { throw factoryError; } });
    factory.broker.start();
    await expect(factory.broker.loadAboutAccountPayload(
      identity(), context(createFakeAbortController().signal),
    )).rejects.toBe(factoryError);
  });
});
