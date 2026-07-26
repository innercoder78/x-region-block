import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_TARGET_SESSION_GROUP_VERSION,
  createXAccountTargetSessionGroup,
} from '../src/content/account-target-session-group.js';
import { findLocationBadge } from '../src/content/location-badge-renderer.js';
import { FakeDocument } from './helpers/fake-dom.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';
import { createFakeObserverFactory } from './helpers/fake-mutation-observer.js';

function dependencies(overrides = {}) {
  const observer = createFakeObserverFactory();
  const runtime = {
    getSettings: vi.fn(() => ({})),
    subscribe: vi.fn(() => vi.fn()),
    start: vi.fn(),
    stop: vi.fn(),
  };
  return {
    runtime,
    observer,
    options: {
      settingsRuntime: runtime,
      observerFactory: observer.factory,
      loadPayload: vi.fn(() => ({})),
      brokerAbortControllerFactory: vi.fn(createFakeAbortController),
      consumerAbortControllerFactory: vi.fn(createFakeAbortController),
      onError: vi.fn(),
      ...overrides,
    },
  };
}

function timeline(handle) {
  const document = new FakeDocument();
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  const name = document.createElement('div');
  name.setAttribute('data-testid', 'User-Name');
  const link = document.createElement('a');
  link.setAttribute('href', `/${handle}`);
  name.appendChild(link);
  article.appendChild(name);
  document.appendChild(article);
  return { root: document, article, name };
}

function profile(handle) {
  const document = new FakeDocument();
  const root = document.createElement('div');
  root.setAttribute('data-testid', 'UserName');
  const link = document.createElement('a');
  link.setAttribute('href', `/${handle}`);
  root.appendChild(link);
  document.appendChild(root);
  return { root, name: root };
}

describe('account target session group validation', () => {
  it('exports version 1 and an exact frozen, lazy controller', () => {
    const { options, runtime, observer } = dependencies();
    const group = createXAccountTargetSessionGroup(
      [{ root: new FakeDocument(), source: ' TiMeLiNe ' }], options,
    );
    expect(ACCOUNT_TARGET_SESSION_GROUP_VERSION).toBe(1);
    expect(Object.keys(group)).toEqual([
      'start', 'stop', 'rescan', 'getTargets', 'getInFlightCount', 'isActive',
    ]);
    expect(Object.isFrozen(group)).toBe(true);
    expect(group.getTargets()).toBe(group.getTargets());
    expect(group.getInFlightCount()).toBe(0);
    expect(runtime.getSettings).not.toHaveBeenCalled();
    expect(observer.instances).toHaveLength(0);
  });

  it.each([undefined, null, {}, new Set(), [], 'plans', () => {}])(
    'rejects invalid plan arrays',
    (plans) => expect(() => createXAccountTargetSessionGroup(plans, {}))
      .toThrow(new TypeError('account target session group plans must be a non-empty array')),
  );

  it('validates exact plain plans, roots, sources, symbols, and duplicates atomically', () => {
    const { options } = dependencies();
    const root = new FakeDocument();
    const invalid = [
      null, {}, { root, source: 'other' }, { root: {}, source: 'profile' },
      { root, source: 'profile', extra: true },
      Object.assign({ root, source: 'profile' }, { [Symbol('extra')]: true }),
      new (class Plan { constructor() { this.root = root; this.source = 'profile'; } })(),
    ];
    for (const plan of invalid) {
      expect(() => createXAccountTargetSessionGroup([plan], options))
        .toThrow(new TypeError('Invalid account target session group plan'));
    }
    expect(() => createXAccountTargetSessionGroup([
      { root, source: 'profile' }, { root, source: ' PROFILE ', baseUrl: undefined },
    ], options)).toThrow(new TypeError('Duplicate account target session group plan'));
    const querySelectorAll = vi.fn(() => []);
    expect(() => createXAccountTargetSessionGroup([
      Object.assign(Object.create(null), { root: { querySelectorAll }, source: 'search' }),
      { root: { querySelectorAll }, source: 'notification', baseUrl: undefined },
    ], options)).not.toThrow();
    expect(querySelectorAll).not.toHaveBeenCalled();
  });

  it('validates own options dependencies and never owns the settings runtime', () => {
    const root = new FakeDocument();
    const { options } = dependencies();
    expect(() => createXAccountTargetSessionGroup([{ root, source: 'profile' }], null))
      .toThrow(new TypeError('account target session group options must be a plain object'));
    expect(() => createXAccountTargetSessionGroup(
      [{ root, source: 'profile' }], { ...options, accountId: null },
    )).toThrow(new TypeError('accountId is not supported by account target session groups'));
    for (const [property, message] of [
      ['settingsRuntime', 'settingsRuntime must provide getSettings and subscribe'],
      ['observerFactory', 'observerFactory must be a function'],
      ['loadPayload', 'loadPayload must be a function'],
      ['brokerAbortControllerFactory', 'brokerAbortControllerFactory must be a function'],
      ['consumerAbortControllerFactory', 'consumerAbortControllerFactory must be a function'],
      ['onError', 'onError must be a function'],
    ]) {
      expect(() => createXAccountTargetSessionGroup(
        [{ root, source: 'profile' }], { ...options, [property]: null },
      )).toThrow(new TypeError(message));
    }
  });
});

describe('account target session group lifecycle', () => {
  it('shares one lookup across roots, aggregates in plan order, and restarts cleanly', async () => {
    let resolve;
    const pending = new Promise((accept) => { resolve = accept; });
    const loadPayload = vi.fn(() => pending);
    const { options, runtime, observer } = dependencies({ loadPayload });
    const first = profile('OpenAI');
    const second = timeline('openai');
    const group = createXAccountTargetSessionGroup([
      { root: first.root, source: 'profile' },
      { root: second.root, source: 'timeline' },
    ], options);
    expect(group.start()).toHaveLength(2);
    expect(group.start()).toHaveLength(2);
    expect(loadPayload).toHaveBeenCalledTimes(1);
    expect(loadPayload.mock.calls[0][0].source).toBeNull();
    expect(runtime.subscribe).toHaveBeenCalledTimes(2);
    expect(observer.instances).toHaveLength(2);
    expect(group.getInFlightCount()).toBe(1);
    resolve({
      data: { user_result_by_screen_name: { result: { about_profile: { account_based_in: 'Japan' } } } },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(findLocationBadge(first.name)).not.toBeNull();
    expect(findLocationBadge(second.name)).not.toBeNull();
    expect(group.getTargets().map((target) => target.accountContainer))
      .toEqual([first.name, second.article]);
    expect(group.getInFlightCount()).toBe(0);
    group.stop();
    expect(findLocationBadge(first.name)).toBeNull();
    expect(findLocationBadge(second.name)).toBeNull();
    expect(group.getTargets()).toBe(group.getTargets());
    expect(group.isActive()).toBe(false);
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it('rolls back startup, reports rescan failures generically, and can retry', () => {
    const failure = new Error('settings failed');
    const { options } = dependencies();
    options.settingsRuntime.getSettings = vi.fn()
      .mockImplementationOnce(() => { throw failure; })
      .mockReturnValue({});
    const group = createXAccountTargetSessionGroup(
      [{ root: new FakeDocument(), source: 'profile' }], options,
    );
    expect(() => group.start()).toThrow(failure);
    expect(group.isActive()).toBe(false);
    expect(group.getTargets()).toEqual([]);
    expect(group.getInFlightCount()).toBe(0);
    expect(options.onError).not.toHaveBeenCalled();
    expect(group.start()).toEqual([]);
    group.rescan();
    group.stop();
    expect(() => group.rescan())
      .toThrow(new TypeError('account target session group is not active'));
  });

  it.each(['observer', 'unsubscribe', 'consumer', 'broker'])(
    'converts a synchronous %s cleanup failure into one group stop error',
    (failureKind) => {
      const events = [];
      const onError = vi.fn(() => {
        events.push('group-error');
        throw new Error('ignored error-boundary failure');
      });
      const observerFactory = (callback) => ({
        observe() {},
        disconnect() {
          events.push('observer-stop');
          if (failureKind === 'observer') throw new Error('private observer failure');
        },
        callback,
      });
      const settingsRuntime = {
        getSettings: () => ({}),
        subscribe: () => () => {
          events.push('unsubscribe');
          if (failureKind === 'unsubscribe') throw new Error('private settings failure');
        },
      };
      const group = createXAccountTargetSessionGroup(
        [{ root: timeline('openai').root, source: 'timeline' }],
        {
          settingsRuntime,
          observerFactory,
          loadPayload: () => new Promise(() => {}),
          brokerAbortControllerFactory: () => {
            const controller = createFakeAbortController({ failAbort: failureKind === 'broker' });
            return {
              signal: controller.signal,
              abort() { events.push('broker-stop'); controller.abort(); },
            };
          },
          consumerAbortControllerFactory: () => {
            const controller = createFakeAbortController({ failAbort: failureKind === 'consumer' });
            return {
              signal: controller.signal,
              abort() { events.push('consumer-stop'); controller.abort(); },
            };
          },
          onError,
        },
      );
      group.start();
      expect(() => group.stop()).not.toThrow();
      expect(group.isActive()).toBe(false);
      expect(group.getTargets()).toBe(group.getTargets());
      expect(group.getInFlightCount()).toBe(0);
      expect(events.indexOf('observer-stop')).toBeLessThan(events.indexOf('unsubscribe'));
      if (events.includes('consumer-stop')) {
        expect(events.indexOf('unsubscribe')).toBeLessThan(events.indexOf('consumer-stop'));
      }
      expect(events.at(-1)).toBe('group-error');
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        new Error('Unable to stop account target session group'),
      );
      group.stop();
      expect(onError).toHaveBeenCalledTimes(1);
    },
  );
});
