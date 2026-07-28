import { describe, expect, it, vi } from 'vitest';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { ACCOUNT_IDENTITY_SOURCES } from '../src/shared/account-identity.js';
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
  it('passes a native AbortController signal to the transport loader', async () => {
    const shared = new AbortController();
    const consumer = new AbortController();
    const loadPayload = vi.fn(() => 'native payload');
    const { broker } = setup({ loadPayload, abortControllerFactory: () => shared });
    broker.start();
    await expect(broker.loadAboutAccountPayload(identity(), context(consumer.signal)))
      .resolves.toBe('native payload');
    expect(Object.hasOwn(shared, 'signal')).toBe(false);
    expect(Object.hasOwn(shared, 'abort')).toBe(false);
    expect(loadPayload.mock.calls[0][1].signal).toBe(shared.signal);
  });

  it('accepts prototype members and preserves the abort receiver on cancellation', async () => {
    const signal = { aborted: false, addEventListener() {}, removeEventListener() {} };
    let receiver = null;
    class BrowserController {
      get signal() { return signal; }
      abort() { receiver = this; signal.aborted = true; }
    }
    const shared = new BrowserController();
    const consumer = new AbortController();
    const { broker, loadPayload } = setup({ abortControllerFactory: () => shared });
    broker.start();
    const result = broker.loadAboutAccountPayload(identity(), context(consumer.signal));
    expect(loadPayload.mock.calls[0][1].signal).toBe(signal);
    consumer.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(receiver).toBe(shared);
    expect(signal.aborted).toBe(true);
  });

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

  it.each([
    ['notifies synchronously', { abortDuringAdd: true }],
    ['changes aborted without notification', { abortDuringAdd: true, notifyDuringAdd: false }],
  ])('handles a signal that %s during listener registration', async (_label, signalOptions) => {
    const { broker, loadPayload, controllers } = setup();
    broker.start();
    const signal = createFakeAbortController(signalOptions);
    const consumer = broker.loadAboutAccountPayload(identity(), context(signal.signal));
    await expect(consumer).rejects.toMatchObject({
      name: 'AbortError', message: 'The operation was aborted',
    });
    expect(loadPayload).not.toHaveBeenCalled();
    expect(signal.listenerCount).toBe(0);
    expect(controllers[0].abortCount).toBe(1);
    expect(broker.getInFlightCount()).toBe(0);
  });

  it.each([
    ['before retaining a listener', { failAddBefore: true }],
    ['after retaining a listener', { failAddAfter: true }],
  ])('fully retires a first consumer when registration throws %s', async (_label, signalOptions) => {
    const { broker, loadPayload, controllers } = setup();
    broker.start();
    const signal = createFakeAbortController(signalOptions);
    const consumer = broker.loadAboutAccountPayload(identity(), context(signal.signal));
    await expect(consumer).rejects.toThrow('fake listener registration failure');
    expect(loadPayload).not.toHaveBeenCalled();
    expect(signal.listenerCount).toBe(0);
    expect(controllers[0].abortCount).toBe(1);
    expect(broker.getInFlightCount()).toBe(0);
  });

  it('keeps an existing lookup alive when a joining consumer aborts during registration', async () => {
    const { broker, loadPayload, pending, controllers } = setup();
    broker.start();
    const firstSignal = createFakeAbortController();
    const first = broker.loadAboutAccountPayload(identity('profile'), context(firstSignal.signal));
    const joiningSignal = createFakeAbortController({ abortDuringAdd: true });
    const joining = broker.loadAboutAccountPayload(
      identity('timeline'), context(joiningSignal.signal),
    );
    await expect(joining).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadPayload).toHaveBeenCalledTimes(1);
    expect(controllers[0].abortCount).toBe(0);
    expect(broker.getInFlightCount()).toBe(1);
    pending.resolve('current');
    await expect(first).resolves.toBe('current');
    expect(firstSignal.listenerCount).toBe(0);
  });

  it('ignores stale completion after registration-time final cancellation', async () => {
    const old = deferred();
    const loadPayload = vi.fn(() => old.promise);
    const { broker, controllers } = setup({ loadPayload });
    broker.start();
    const activeSignal = createFakeAbortController();
    const active = broker.loadAboutAccountPayload(identity(), context(activeSignal.signal));
    activeSignal.abort();
    await expect(active).rejects.toMatchObject({ name: 'AbortError' });
    old.resolve('stale');
    await Promise.resolve();
    expect(controllers[0].abortCount).toBe(1);
    expect(broker.getInFlightCount()).toBe(0);
  });

  it('sanitizes several stopped entries and ignores their work after same-key restart', async () => {
    const oldFirst = deferred();
    const oldSecond = deferred();
    const fresh = deferred();
    const loadPayload = vi.fn()
      .mockReturnValueOnce(oldFirst.promise)
      .mockReturnValueOnce(oldSecond.promise)
      .mockReturnValueOnce(fresh.promise);
    const { broker, controllers } = setup({ loadPayload });
    broker.start();
    const oldSignalA = createFakeAbortController();
    const oldSignalB = createFakeAbortController();
    const stoppedA = broker.loadAboutAccountPayload(
      identity('profile', 'first', '1'), context(oldSignalA.signal),
    );
    const stoppedB = broker.loadAboutAccountPayload(
      identity('timeline', 'second', '2'), context(oldSignalB.signal),
    );
    broker.stop();
    await expect(stoppedA).rejects.toMatchObject({ name: 'AbortError' });
    await expect(stoppedB).rejects.toMatchObject({ name: 'AbortError' });
    expect(oldSignalA.listenerCount).toBe(0);
    expect(oldSignalB.listenerCount).toBe(0);
    expect(controllers.slice(0, 2).map(({ abortCount }) => abortCount)).toEqual([1, 1]);
    expect(broker.getInFlightCount()).toBe(0);

    broker.start();
    const freshSignal = createFakeAbortController();
    const current = broker.loadAboutAccountPayload(
      identity('notification', 'first', '1'), context(freshSignal.signal),
    );
    oldFirst.resolve('old payload');
    oldSecond.reject(new Error('old error'));
    await Promise.resolve();
    expect(broker.getInFlightCount()).toBe(1);
    fresh.resolve('fresh payload');
    await expect(current).resolves.toBe('fresh payload');
    expect(loadPayload).toHaveBeenCalledTimes(3);
    expect(controllers[2].abortCount).toBe(0);
    expect(freshSignal.listenerCount).toBe(0);
  });

  it('shares every supported source but separates exact account IDs including null', () => {
    const loadPayload = vi.fn(() => new Promise(() => {}));
    const { broker } = setup({ loadPayload });
    broker.start();
    const consumers = ACCOUNT_IDENTITY_SOURCES.map((source) => broker.loadAboutAccountPayload(
      identity(source, 'same', '10'), context(createFakeAbortController().signal),
    ));
    const differentId = broker.loadAboutAccountPayload(
      identity('profile', 'same', '11'), context(createFakeAbortController().signal),
    );
    const nullId = broker.loadAboutAccountPayload(
      identity('timeline', 'same', null), context(createFakeAbortController().signal),
    );
    expect(new Set(consumers).size).toBe(ACCOUNT_IDENTITY_SOURCES.length);
    expect(loadPayload).toHaveBeenCalledTimes(3);
    expect(broker.getInFlightCount()).toBe(3);
    for (const consumer of consumers) consumer.catch(() => {});
    differentId.catch(() => {});
    nullId.catch(() => {});
    broker.stop();
  });

  it.each([
    ['a throwing signal getter', () => ({
      abort() {},
      get signal() { throw new Error('private signal failure'); },
    })],
    ['a throwing abort getter', () => ({
      signal: {},
      get abort() { throw new Error('private abort failure'); },
    })],
    ['an inherited malformed signal', () => {
      const controller = Object.create({ signal: {} });
      controller.abort = () => {};
      return controller;
    }],
    ['a non-callable abort', () => ({ signal: {}, abort: null })],
  ])('atomically rejects a controller with %s and permits a later request', async (
    _label, invalidFactory,
  ) => {
    const consumerSignal = createFakeAbortController();
    const validController = createFakeAbortController();
    let signalReads = 0;
    const valid = {
      abort: validController.abort,
      get signal() {
        signalReads += 1;
        return validController.signal;
      },
    };
    const controllers = [invalidFactory(), valid];
    const loadPayload = vi.fn(() => 'payload');
    const onError = vi.fn();
    const broker = createXAboutAccountPayloadBroker({
      loadPayload,
      abortControllerFactory: () => controllers.shift(),
      onError,
    });
    broker.start();
    let request;
    expect(() => {
      request = broker.loadAboutAccountPayload(identity(), context(consumerSignal.signal));
    }).not.toThrow();
    expect(request).toBeInstanceOf(Promise);
    await expect(request).rejects.toEqual(
      new TypeError('abortControllerFactory returned an invalid controller'),
    );
    expect(consumerSignal.listenerCount).toBe(0);
    expect(loadPayload).not.toHaveBeenCalled();
    expect(broker.getInFlightCount()).toBe(0);
    expect(onError).not.toHaveBeenCalled();

    const laterSignal = createFakeAbortController();
    await expect(broker.loadAboutAccountPayload(
      identity('timeline'), context(laterSignal.signal),
    )).resolves.toBe('payload');
    expect(signalReads).toBe(1);
    expect(loadPayload).toHaveBeenCalledTimes(1);
    expect(laterSignal.listenerCount).toBe(0);
  });

  it('captures a valid shared signal exactly once and never joins failed initialization state', async () => {
    let fragileReads = 0;
    const fragileController = {
      abort() {},
      get signal() {
        fragileReads += 1;
        if (fragileReads > 1) throw new Error('signal read twice');
        return createFakeAbortController().signal;
      },
    };
    const pending = deferred();
    const loadPayload = vi.fn(() => pending.promise);
    const broker = createXAboutAccountPayloadBroker({
      loadPayload,
      abortControllerFactory: vi.fn()
        .mockReturnValueOnce({
          abort() {},
          get signal() { throw new Error('invalid first controller'); },
        })
        .mockReturnValueOnce(fragileController),
      onError: vi.fn(),
    });
    broker.start();
    await expect(broker.loadAboutAccountPayload(
      identity(), context(createFakeAbortController().signal),
    )).rejects.toEqual(new TypeError('abortControllerFactory returned an invalid controller'));
    const first = broker.loadAboutAccountPayload(
      identity('profile'), context(createFakeAbortController().signal),
    );
    const second = broker.loadAboutAccountPayload(
      identity('timeline'), context(createFakeAbortController().signal),
    );
    expect(first).not.toBe(second);
    expect(loadPayload).toHaveBeenCalledTimes(1);
    expect(fragileReads).toBe(1);
    pending.resolve('shared');
    await expect(first).resolves.toBe('shared');
    await expect(second).resolves.toBe('shared');
    expect(fragileReads).toBe(1);
  });
});
