import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_TARGET_SESSION_GROUP_VERSION,
  createXAccountTargetSessionGroup,
} from '../src/content/account-target-session-group.js';
import { findLocationBadge } from '../src/content/location-badge-renderer.js';
import { getAccountAction } from '../src/content/account-action-renderer.js';
import { FakeDocument } from './helpers/fake-dom.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';
import { createFakeObserverFactory } from './helpers/fake-mutation-observer.js';

function dependencies(overrides = {}) {
  const observer = createFakeObserverFactory();
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
  return {
    runtime,
    listeners,
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
  const shell = document.createElement('div'); const column = document.createElement('div');
  const row = document.createElement('div'); row.appendChild(name); column.appendChild(row);
  shell.appendChild(column); article.appendChild(shell);
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

  it('accepts null-prototype options and allowed non-duplicate plan combinations', () => {
    const { options } = dependencies();
    const nullOptions = Object.assign(Object.create(null), options);
    const sharedRoot = new FakeDocument();
    expect(() => createXAccountTargetSessionGroup([
      { root: sharedRoot, source: 'timeline' },
      { root: sharedRoot, source: 'reply' },
      { root: new FakeDocument(), source: 'timeline' },
    ], nullOptions)).not.toThrow();
    const inherited = Object.create(options);
    expect(() => createXAccountTargetSessionGroup(
      [{ root: sharedRoot, source: 'timeline' }], inherited,
    )).toThrow(new TypeError('account target session group options must be a plain object'));
  });

  it('distinguishes omitted base URL fallback from own undefined', () => {
    const first = profile('openai');
    const second = profile('openai');
    const { options } = dependencies();
    const omitted = createXAccountTargetSessionGroup(
      [{ root: first.root, source: 'profile' }], options,
    );
    const suppressed = createXAccountTargetSessionGroup(
      [{ root: second.root, source: 'profile', baseUrl: undefined }], options,
    );
    expect(omitted.start()).toHaveLength(1);
    expect(suppressed.start()).toHaveLength(0);
    omitted.stop();
    suppressed.stop();
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
    expect(group.start()).toHaveLength(2);
    expect(observer.instances).toHaveLength(4);
    expect(runtime.subscribe).toHaveBeenCalledTimes(4);
    expect(loadPayload).toHaveBeenCalledTimes(2);
    group.stop();
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

  it.each(['subscription', 'observer attachment'])(
    'rolls back earlier sessions when a later %s fails and retries freshly',
    (failureKind) => {
      const failure = new Error(`private ${failureKind} failure`);
      const events = [];
      let attempt = 1;
      let observerNumber = 0;
      let subscriptionNumber = 0;
      const settingsRuntime = {
        getSettings: () => ({}),
        subscribe: () => {
          subscriptionNumber += 1;
          const number = subscriptionNumber;
          if (attempt === 1 && failureKind === 'subscription' && number === 3) throw failure;
          return () => events.push(`unsubscribe-${number}`);
        },
        start: vi.fn(),
        stop: vi.fn(),
      };
      const observerFactory = () => {
        observerNumber += 1;
        const number = observerNumber;
        return {
          observe() {
            events.push(`observe-${number}`);
            if (attempt === 1 && failureKind === 'observer attachment' && number === 3) {
              throw failure;
            }
          },
          disconnect() { events.push(`disconnect-${number}`); },
        };
      };
      const onError = vi.fn();
      const group = createXAccountTargetSessionGroup(
        ['one', 'two', 'three'].map(() => ({ root: new FakeDocument(), source: 'timeline' })),
        {
          settingsRuntime,
          observerFactory,
          loadPayload: vi.fn(),
          brokerAbortControllerFactory: vi.fn(createFakeAbortController),
          consumerAbortControllerFactory: vi.fn(createFakeAbortController),
          onError,
        },
      );
      expect(() => group.start()).toThrow(failure);
      expect(group.isActive()).toBe(false);
      expect(group.getTargets()).toEqual([]);
      expect(group.getInFlightCount()).toBe(0);
      expect(onError).not.toHaveBeenCalled();
      expect(events.indexOf('disconnect-2')).toBeLessThan(events.indexOf('disconnect-1'));
      if (failureKind === 'observer attachment') {
        expect(events).toContain('disconnect-3');
        expect(events.indexOf('disconnect-3')).toBeLessThan(events.indexOf('disconnect-2'));
      }
      attempt = 2;
      group.start();
      expect(group.isActive()).toBe(true);
      expect(observerNumber).toBe(failureKind === 'subscription' ? 5 : 6);
      expect(settingsRuntime.start).not.toHaveBeenCalled();
      expect(settingsRuntime.stop).not.toHaveBeenCalled();
      group.stop();
    },
  );

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

  it('continues a failed middle rescan, preserves plan order, and recovers', () => {
    const roots = [timeline('first'), timeline('middle'), timeline('last')];
    const detach = (item) => {
      item.root.children.splice(item.root.children.indexOf(item.article), 1);
      item.article.parentNode = null;
    };
    for (const item of roots) detach(item);
    const originalMiddleQuery = roots[1].root.querySelectorAll.bind(roots[1].root);
    let failMiddle = false;
    roots[1].root.querySelectorAll = (...args) => {
      if (failMiddle) throw new Error('private scan failure');
      return originalMiddleQuery(...args);
    };
    const { options } = dependencies();
    const group = createXAccountTargetSessionGroup(
      roots.map(({ root }) => ({ root, source: 'timeline' })), options,
    );
    group.start();
    roots[0].root.appendChild(roots[0].article);
    roots[2].root.appendChild(roots[2].article);
    failMiddle = true;
    group.rescan();
    expect(options.onError).toHaveBeenCalledWith(
      new Error('Unable to rescan account target sessions'),
    );
    expect(group.isActive()).toBe(true);
    expect(group.getTargets().map((target) => target.identity.handle))
      .toEqual(['first', 'last']);
    detach(roots[0]);
    roots[1].root.appendChild(roots[1].article);
    failMiddle = false;
    group.rescan();
    expect(group.getTargets().map((target) => target.identity.handle))
      .toEqual(['middle', 'last']);
    expect(options.onError).toHaveBeenCalledTimes(1);
    group.stop();
  });

  it('reevaluates shared profile and timeline sessions without another lookup', async () => {
    const { options, listeners } = dependencies({
      loadPayload: vi.fn(() => ({
        data: { user_result_by_screen_name: { result: { about_profile: { account_based_in: 'Japan' } } } },
      })),
    });
    const first = profile('openai');
    const second = timeline('openai');
    const group = createXAccountTargetSessionGroup([
      { root: first.root, source: 'profile' }, { root: second.root, source: 'timeline' },
    ], options);
    group.start();
    await Promise.resolve();
    await Promise.resolve();
    listeners[0]({ country: { highlight: ['JP'] } });
    listeners[1]({ country: { hide: ['JP'] } });
    expect(getAccountAction(first.name)).toBe('highlight');
    expect(getAccountAction(second.article)).toBe('hide');
    expect(options.loadPayload).toHaveBeenCalledTimes(1);
    listeners[0]({ allowlist: ['@openai'], country: { hide: ['JP'] } });
    listeners[1]({ country: { alwaysShow: ['JP'], hide: ['JP'] } });
    expect(getAccountAction(first.name)).toBe('show');
    expect(getAccountAction(second.article)).toBe('show');
    expect(options.loadPayload).toHaveBeenCalledTimes(1);
    group.stop();
  });

  it('stops three sessions completely in reverse order before broker lifecycle stop', async () => {
    vi.resetModules();
    const events = [];
    let sessionNumber = 0;
    let brokerNumber = 0;
    vi.doMock('../src/content/account-target-session.js', () => ({
      createXAccountTargetSession: (_root, sessionOptions) => {
        sessionNumber += 1;
        const number = sessionNumber;
        return {
          start: () => [],
          stop: () => {
            events.push(`session-${number}-begin`);
            events.push(`session-${number}-observer`);
            events.push(`session-${number}-unsubscribe`);
            events.push(`session-${number}-processor`);
            if (number === 3) sessionOptions.onError(new Error('private child error'));
            if (number === 2) throw new Error('private thrown stop error');
            if (number === 1) sessionOptions.onError(new Error('another private child error'));
          },
          rescan: () => [],
          getTargets: () => [],
        };
      },
    }));
    vi.doMock('../src/content/x-about-account-payload-broker.js', () => ({
      createXAboutAccountPayloadBroker: ({ onError }) => {
        brokerNumber += 1;
        return {
          start() { events.push(`broker-${brokerNumber}-start`); },
          stop() {
            events.push(`broker-${brokerNumber}-lifecycle-stop`);
            if (brokerNumber === 1) onError(new Error('private broker error'));
          },
          loadAboutAccountPayload() {},
          getInFlightCount: () => 0,
        };
      },
    }));
    const { createXAccountTargetSessionGroup: createInstrumentedGroup } = await import(
      '../src/content/account-target-session-group.js'
    );
    const onError = vi.fn(() => { throw new Error('ignored boundary error'); });
    const group = createInstrumentedGroup(
      ['one', 'two', 'three'].map(() => ({ root: { querySelectorAll() {} }, source: 'timeline' })),
      {
        settingsRuntime: { getSettings() {}, subscribe() {} },
        observerFactory() {},
        loadPayload() {},
        brokerAbortControllerFactory() {},
        consumerAbortControllerFactory() {},
        onError,
      },
    );
    group.start();
    group.stop();
    expect(events).toEqual([
      'broker-1-start',
      'session-3-begin', 'session-3-observer', 'session-3-unsubscribe', 'session-3-processor',
      'session-2-begin', 'session-2-observer', 'session-2-unsubscribe', 'session-2-processor',
      'session-1-begin', 'session-1-observer', 'session-1-unsubscribe', 'session-1-processor',
      'broker-1-lifecycle-stop',
    ]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      new Error('Unable to stop account target session group'),
    );
    expect(group.isActive()).toBe(false);
    expect(group.getTargets()).toBe(group.getTargets());
    expect(group.getInFlightCount()).toBe(0);
    group.stop();
    expect(onError).toHaveBeenCalledTimes(1);
    group.start();
    expect(events.at(-1)).toBe('broker-2-start');
    expect(sessionNumber).toBe(6);
    group.stop();
    vi.doUnmock('../src/content/account-target-session.js');
    vi.doUnmock('../src/content/x-about-account-payload-broker.js');
  });
});
