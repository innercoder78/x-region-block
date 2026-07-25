import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_TARGET_PROCESSOR_VERSION,
  createXAccountTargetProcessor,
} from '../src/content/account-target-processor.js';
import { createAccountIdentity } from '../src/shared/account-identity.js';
import { normalizeSettings } from '../src/shared/settings-schema.js';
import { FakeDocument } from './helpers/fake-dom.js';

const payload = (location = 'Japan') => ({
  data: { user_result_by_screen_name: { result: { about_profile: { account_based_in: location } } } },
});

function target(handle = 'openai', source = 'timeline') {
  const document = new FakeDocument();
  const accountContainer = document.createElement('article');
  const badgeContainer = document.createElement('div');
  const link = document.createElement('a');
  link.setAttribute('href', `/${handle}`);
  return Object.freeze({
    version: 1,
    source,
    accountContainer,
    link,
    badgeContainer,
    identity: createAccountIdentity({ handle, source }),
  });
}

function change(current, reason = 'initial') {
  return Object.freeze({
    version: 1,
    reason,
    source: 'timeline',
    current: Object.freeze(current),
    added: Object.freeze([]),
    updated: Object.freeze([]),
    removed: Object.freeze([]),
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function setup(overrides = {}) {
  const controllers = [];
  const options = {
    source: 'timeline',
    settings: {},
    loadAboutAccountPayload: vi.fn(() => payload()),
    abortControllerFactory: vi.fn(() => {
      const controller = { signal: Object.freeze({}), abort: vi.fn() };
      controllers.push(controller);
      return controller;
    }),
    onError: vi.fn(),
    ...overrides,
  };
  return { processor: createXAccountTargetProcessor(options), options, controllers };
}

const settle = () => Promise.resolve().then(() => Promise.resolve());

describe('account target processor API', () => {
  it('exports version 1 and an exact frozen controller', () => {
    const { processor } = setup();
    expect(ACCOUNT_TARGET_PROCESSOR_VERSION).toBe(1);
    expect(Object.keys(processor)).toEqual([
      'start', 'stop', 'processChange', 'setSettings', 'getTargets', 'isActive',
    ]);
    expect(Object.isFrozen(processor)).toBe(true);
  });

  it('accepts null-prototype options and normalizes source and settings', () => {
    const base = setup().options;
    const options = Object.assign(Object.create(null), base, { source: ' TIMELINE ' });
    const processor = createXAccountTargetProcessor(options);
    expect(processor.setSettings(Object.freeze({}))).toEqual(normalizeSettings({}));
  });

  it.each([null, [], 1, 'x', () => {}, new (class Options {})()])(
    'rejects invalid options %s', (options) => {
      expect(() => createXAccountTargetProcessor(options))
        .toThrow('account target processor options must be a plain object');
    },
  );

  it('rejects own account IDs and missing injected boundaries', () => {
    expect(() => createXAccountTargetProcessor({ ...setup().options, accountId: '1' }))
      .toThrow('accountId is not supported by account target processing');
    for (const property of ['loadAboutAccountPayload', 'abortControllerFactory', 'onError']) {
      const options = { ...setup().options };
      delete options[property];
      expect(() => createXAccountTargetProcessor(options)).toThrow(TypeError);
    }
  });

  it('starts lazily and restarts with the shared empty snapshot', () => {
    const { processor, options } = setup();
    const initial = processor.getTargets();
    expect(processor.start()).toBe(initial);
    expect(processor.start()).toBe(initial);
    expect(options.loadAboutAccountPayload).not.toHaveBeenCalled();
    processor.stop();
    expect(processor.isActive()).toBe(false);
    expect(processor.start()).toBe(initial);
  });
});

describe('lookup, reconciliation, and races', () => {
  it('deduplicates a lookup and presents every same-account target', async () => {
    const first = target();
    const second = target();
    const { processor, options } = setup();
    processor.start();
    expect(processor.processChange(change([first, second]))).toEqual([first, second]);
    expect(options.loadAboutAccountPayload).toHaveBeenCalledOnce();
    const [identity, context] = options.loadAboutAccountPayload.mock.calls[0];
    expect(identity).toBe(first.identity);
    expect(Object.keys(context)).toEqual(['version', 'signal']);
    expect(Object.isFrozen(context)).toBe(true);
    await settle();
    expect(first.badgeContainer.children).toHaveLength(1);
    expect(second.badgeContainer.children).toHaveLength(1);
  });

  it('joins pending and resolved entries without another lookup', async () => {
    const pending = deferred();
    const first = target();
    const second = target();
    const { processor, options } = setup({ loadAboutAccountPayload: vi.fn(() => pending.promise) });
    processor.start();
    processor.processChange(change([first]));
    processor.processChange(change([first, second], 'mutation'));
    expect(options.loadAboutAccountPayload).toHaveBeenCalledOnce();
    pending.resolve(payload('Canada'));
    await settle();
    const third = target();
    processor.processChange(change([first, second, third], 'manual'));
    expect(options.loadAboutAccountPayload).toHaveBeenCalledOnce();
    expect(third.badgeContainer.children).toHaveLength(1);
  });

  it('aborts only after the final target and starts fresh on reappearance', () => {
    const pending = deferred();
    const first = target();
    const second = target();
    const { processor, options, controllers } = setup({
      loadAboutAccountPayload: vi.fn(() => pending.promise),
    });
    processor.start();
    processor.processChange(change([first, second]));
    processor.processChange(change([second], 'mutation'));
    expect(controllers[0].abort).not.toHaveBeenCalled();
    processor.processChange(change([], 'mutation'));
    expect(controllers[0].abort).toHaveBeenCalledOnce();
    processor.processChange(change([target()], 'mutation'));
    expect(options.loadAboutAccountPayload).toHaveBeenCalledTimes(2);
  });

  it('rejects stale completion after removal, stop, and restart', async () => {
    const old = deferred();
    const first = target();
    const { processor } = setup({ loadAboutAccountPayload: vi.fn(() => old.promise) });
    processor.start();
    processor.processChange(change([first]));
    processor.stop();
    processor.start();
    old.resolve(payload());
    await settle();
    expect(first.badgeContainer.children).toHaveLength(0);
    expect(processor.getTargets()).toEqual([]);
  });

  it('guards against link drift before asynchronous presentation', async () => {
    const pending = deferred();
    const current = target();
    const { processor } = setup({ loadAboutAccountPayload: vi.fn(() => pending.promise) });
    processor.start();
    processor.processChange(change([current]));
    current.link.setAttribute('href', '/different');
    pending.resolve(payload());
    await settle();
    expect(current.badgeContainer.children).toHaveLength(0);
  });

  it('re-presents resolved accounts on settings changes without a lookup', async () => {
    const current = target();
    const { processor, options } = setup();
    processor.start();
    processor.processChange(change([current]));
    await settle();
    const oldBadge = current.badgeContainer.children[0];
    const canonical = processor.setSettings({ country: { hide: ['jp'] } });
    expect(Object.isFrozen(canonical)).toBe(true);
    expect(options.loadAboutAccountPayload).toHaveBeenCalledOnce();
    expect(current.badgeContainer.children[0]).toBe(oldBadge);
    expect(current.badgeContainer.children).toHaveLength(1);
  });

  it('reports generic load and parse errors while keeping targets presentable', async () => {
    const errors = [];
    const current = target();
    const { processor } = setup({
      loadAboutAccountPayload: vi.fn(() => Promise.reject(new Error('secret'))),
      onError: (error) => errors.push(error.message),
    });
    processor.start();
    processor.processChange(change([current]));
    await settle();
    expect(errors).toEqual(['Unable to load account location']);
    expect(current.badgeContainer.textContent).toContain('unavailable');
  });

  it('validates atomically and rejects duplicate containers', () => {
    const current = target();
    const { processor, options } = setup();
    processor.start();
    const before = processor.getTargets();
    expect(() => processor.processChange(change([current, current])))
      .toThrow('Invalid account target change');
    expect(processor.getTargets()).toBe(before);
    expect(options.loadAboutAccountPayload).not.toHaveBeenCalled();
  });
});
