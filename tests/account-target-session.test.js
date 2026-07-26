import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_TARGET_SESSION_VERSION,
  createXAccountTargetSession,
} from '../src/content/account-target-session.js';
import { FakeDocument } from './helpers/fake-dom.js';
import { createFakeObserverFactory } from './helpers/fake-mutation-observer.js';

function dependencies(overrides = {}) {
  const fakeObservers = createFakeObserverFactory();
  const listeners = [];
  const runtime = {
    getSettings: vi.fn(() => ({})),
    subscribe: vi.fn((listener) => {
      listeners.push(listener);
      return vi.fn();
    }),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const options = {
    source: 'timeline',
    settingsRuntime: runtime,
    observerFactory: fakeObservers.factory,
    loadAboutAccountPayload: vi.fn(() => ({})),
    abortControllerFactory: vi.fn(() => ({ signal: Object.freeze({}), abort: vi.fn() })),
    onError: vi.fn(),
    ...overrides,
  };
  return { options, runtime, listeners, fakeObservers };
}

describe('account target session API and validation', () => {
  it('exports version 1 and an exact frozen controller', () => {
    const { options } = dependencies();
    const session = createXAccountTargetSession(new FakeDocument(), options);
    expect(ACCOUNT_TARGET_SESSION_VERSION).toBe(1);
    expect(Object.keys(session)).toEqual(['start', 'stop', 'rescan', 'getTargets', 'isActive']);
    expect(Object.isFrozen(session)).toBe(true);
    expect(session.getTargets()).toBe(session.getTargets());
    expect(Object.isFrozen(session.getTargets())).toBe(true);
  });

  it.each([null, [], 'options', 1, () => {}, new (class Options {})()])(
    'rejects a non-plain options container',
    (options) => {
      expect(() => createXAccountTargetSession(new FakeDocument(), options))
        .toThrow(new TypeError('account target session options must be a plain object'));
    },
  );

  it('accepts null-prototype options and canonicalizes the source', () => {
    const { options } = dependencies();
    const nullOptions = Object.assign(Object.create(null), options, { source: ' TiMeLiNe ' });
    const session = createXAccountTargetSession(new FakeDocument(), nullOptions);
    expect(session.start()).toEqual([]);
    session.stop();
  });

  it.each([null, [], {}, { querySelectorAll: null }])('rejects an invalid root', (root) => {
    const { options } = dependencies();
    expect(() => createXAccountTargetSession(root, options))
      .toThrow(new TypeError('Invalid account target session root'));
  });

  it('rejects missing sources and an own account ID while ignoring inherited values', () => {
    const { options } = dependencies();
    expect(() => createXAccountTargetSession(new FakeDocument(), { ...options, source: undefined }))
      .toThrow(new TypeError('Invalid account target session source'));
    expect(() => createXAccountTargetSession(new FakeDocument(), { ...options, accountId: '1' }))
      .toThrow(new TypeError('accountId is not supported by account target sessions'));
    const inherited = Object.create({ source: 'timeline', accountId: '1' });
    Object.assign(inherited, options);
    delete inherited.source;
    expect(() => createXAccountTargetSession(new FakeDocument(), inherited))
      .toThrow(new TypeError('account target session options must be a plain object'));
  });

  it.each([
    ['settingsRuntime', null, 'settingsRuntime must provide getSettings and subscribe'],
    ['observerFactory', null, 'observerFactory must be a function'],
    ['loadAboutAccountPayload', null, 'loadAboutAccountPayload must be a function'],
    ['abortControllerFactory', null, 'abortControllerFactory must be a function'],
    ['onError', null, 'onError must be a function'],
  ])('validates %s', (property, value, message) => {
    const { options } = dependencies();
    expect(() => createXAccountTargetSession(
      new FakeDocument(), { ...options, [property]: value },
    )).toThrow(new TypeError(message));
  });
});

describe('account target session lifecycle', () => {
  it('starts lazily, subscribes once, rescans, and is idempotent', () => {
    const { options, runtime, fakeObservers } = dependencies();
    const root = new FakeDocument();
    const session = createXAccountTargetSession(root, options);
    expect(runtime.getSettings).not.toHaveBeenCalled();
    const started = session.start();
    expect(started).toBe(session.getTargets());
    expect(runtime.getSettings).toHaveBeenCalledTimes(1);
    expect(runtime.subscribe).toHaveBeenCalledTimes(1);
    expect(fakeObservers.instances).toHaveLength(1);
    expect(fakeObservers.instances[0].observations[0].target).toBe(root);
    expect(session.start()).toBe(started);
    expect(session.rescan()).toBe(started);
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it('forwards settings errors generically and ignores an old listener', () => {
    const { options, listeners } = dependencies();
    const session = createXAccountTargetSession(new FakeDocument(), options);
    session.start();
    listeners[0](null);
    expect(options.onError).toHaveBeenCalledWith(
      new Error('Unable to apply account target settings'),
    );
    expect(session.isActive()).toBe(true);
    session.stop();
    options.onError.mockClear();
    listeners[0]({});
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('stops, clears targets, and restarts with fresh dependencies', () => {
    const { options, runtime, fakeObservers } = dependencies();
    const session = createXAccountTargetSession(new FakeDocument(), options);
    session.start();
    const unsubscribe = runtime.subscribe.mock.results[0].value;
    session.stop();
    expect(fakeObservers.instances[0].disconnectCount).toBe(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(session.isActive()).toBe(false);
    expect(session.getTargets()).toEqual([]);
    session.stop();
    session.start();
    expect(fakeObservers.instances).toHaveLength(2);
    expect(runtime.subscribe).toHaveBeenCalledTimes(2);
  });

  it('requires current settings and a callable unsubscriber', () => {
    const missing = dependencies();
    missing.runtime.getSettings.mockReturnValue(null);
    const missingSession = createXAccountTargetSession(new FakeDocument(), missing.options);
    expect(() => missingSession.start())
      .toThrow(new TypeError('settings runtime has no current settings'));
    expect(missingSession.isActive()).toBe(false);

    const invalid = dependencies();
    invalid.runtime.subscribe.mockReturnValue(null);
    const invalidSession = createXAccountTargetSession(new FakeDocument(), invalid.options);
    expect(() => invalidSession.start())
      .toThrow(new TypeError('settingsRuntime.subscribe must return an unsubscribe function'));
    expect(invalidSession.isActive()).toBe(false);
    expect(invalidSession.getTargets()).toEqual([]);
  });

  it('continues failed cleanup and reports only one generic stop error', () => {
    const order = [];
    const { options, runtime } = dependencies({
      onError: vi.fn(() => { throw new Error('callback failure'); }),
    });
    options.observerFactory = (callback) => ({
      observe: vi.fn(),
      disconnect: () => { order.push('observer'); throw new Error('disconnect'); },
      callback,
    });
    runtime.subscribe.mockReturnValue(() => {
      order.push('unsubscribe');
      throw new Error('unsubscribe');
    });
    const session = createXAccountTargetSession(new FakeDocument(), options);
    session.start();
    expect(() => session.stop()).not.toThrow();
    expect(order).toEqual(['observer', 'unsubscribe']);
    expect(options.onError).toHaveBeenCalledWith(
      new Error('Unable to stop account target session'),
    );
    expect(session.isActive()).toBe(false);
  });

  it('rejects rescanning while inactive', () => {
    const { options } = dependencies();
    const session = createXAccountTargetSession(new FakeDocument(), options);
    expect(() => session.rescan())
      .toThrow(new TypeError('account target session is not active'));
  });
});
