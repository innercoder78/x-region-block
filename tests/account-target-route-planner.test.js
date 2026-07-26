import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_TARGET_ROUTE_PLANNER_VERSION,
  createXAccountTargetSessionPlans,
} from '../src/content/account-target-route-planner.js';
import { classifyXRoute } from '../src/content/x-route-classifier.js';
import { FakeDocument } from './helpers/fake-dom.js';

const route = (type, handle = null, profileSection = null, statusId = null) => ({
  version: 1, type, handle, profileSection, statusId,
});

describe('account target route planner', () => {
  it('exports version 1 and accepts explicit document, element, and facade roots without querying', () => {
    expect(ACCOUNT_TARGET_ROUTE_PLANNER_VERSION).toBe(1);
    const document = new FakeDocument();
    const roots = [document, document.createElement('main'), { querySelectorAll: vi.fn() }];
    for (const root of roots) {
      const plans = createXAccountTargetSessionPlans(root, route('home'));
      expect(plans).toEqual([{ root, source: 'timeline' }]);
      if (root.querySelectorAll.mock) expect(root.querySelectorAll).not.toHaveBeenCalled();
    }
  });

  it.each([null, undefined, {}, [], { get querySelectorAll() { throw new Error('no'); } }])(
    'rejects invalid roots',
    (root) => expect(() => createXAccountTargetSessionPlans(root, route('home')))
      .toThrow(new TypeError('Invalid account target route planning root')),
  );

  it('accepts plain and null-prototype descriptors and rejects malformed descriptors', () => {
    const root = new FakeDocument();
    const nullRoute = Object.assign(Object.create(null), route('home'));
    expect(createXAccountTargetSessionPlans(root, nullRoute)).toHaveLength(1);
    const bad = [
      null, [], { ...route('home'), extra: true },
      Object.assign(route('home'), { [Symbol('extra')]: true }),
      new (class Route { constructor() { Object.assign(this, route('home')); } })(),
      { ...route('home'), version: 2 }, { ...route('home'), handle: 'a' },
      route('profile', 'OpenAI', 'posts'), route('profile', 'openai', 'bad'),
      route('profile', 'openai', 'posts', '1'), route('status', 'openai', null, 'bad'),
      route('other'),
    ];
    for (const value of bad) {
      expect(() => createXAccountTargetSessionPlans(root, value))
        .toThrow(new TypeError('Invalid X route descriptor'));
    }
    const throwing = route('home');
    Object.defineProperty(throwing, 'type', { enumerable: true, get() { throw new Error('no'); } });
    expect(() => createXAccountTargetSessionPlans(root, throwing))
      .toThrow(new TypeError('Invalid X route descriptor'));
  });

  it.each([
    ['https://x.com/', ['timeline']],
    ['https://x.com/explore', ['timeline']],
    ['https://x.com/a', ['profile', 'timeline']],
    ['https://x.com/a/media', ['profile', 'timeline']],
    ['https://x.com/a/likes', ['profile', 'timeline']],
    ['https://x.com/a/highlights', ['profile', 'timeline']],
    ['https://x.com/a/articles', ['profile', 'timeline']],
    ['https://x.com/a/with_replies', ['profile', 'reply']],
    ['https://x.com/a/status/1', ['reply']],
    ['https://x.com/search', ['search']],
    ['https://x.com/notifications', ['notification']],
  ])('maps %s to exact ordered sources', (url, sources) => {
    const root = new FakeDocument();
    const plans = createXAccountTargetSessionPlans(root, classifyXRoute(url));
    expect(plans.map((plan) => plan.source)).toEqual(sources);
    expect(plans.every((plan) => plan.root === root)).toBe(true);
    expect(plans.every((plan) => Object.keys(plan).join(',') === 'root,source')).toBe(true);
    expect(plans.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(plans)).toBe(true);
  });

  it('accepts every representative supported descriptor produced by the classifier', () => {
    const root = { querySelectorAll: vi.fn(() => []) };
    const cases = [
      ['https://x.com/', ['timeline']],
      ['https://x.com/home/', ['timeline']],
      ['https://x.com/explore/tabs/recommended', ['timeline']],
      ['https://x.com/search?q=value', ['search']],
      ['https://x.com/notifications/mentions', ['notification']],
      ['https://x.com/OpenAI', ['profile', 'timeline']],
      ['https://x.com/OpenAI/with_replies', ['profile', 'reply']],
      ['https://x.com/OpenAI/media', ['profile', 'timeline']],
      ['https://x.com/OpenAI/likes', ['profile', 'timeline']],
      ['https://x.com/OpenAI/highlights', ['profile', 'timeline']],
      ['https://x.com/OpenAI/articles', ['profile', 'timeline']],
      ['https://x.com/OpenAI/status/001', ['reply']],
      ['https://x.com/OpenAI/status/001/photo/1', ['reply']],
      ['https://x.com/OpenAI/status/001/video/2', ['reply']],
    ];
    for (const [url, sources] of cases) {
      const classified = classifyXRoute(url);
      expect(classified.type).not.toBe('unsupported');
      expect(() => createXAccountTargetSessionPlans(root, classified)).not.toThrow();
      expect(createXAccountTargetSessionPlans(root, classified).map(({ source }) => source))
        .toEqual(sources);
    }
    expect(root.querySelectorAll).not.toHaveBeenCalled();
  });

  it('composes adversarial normalized paths into one shared empty result without querying', () => {
    const root = { querySelectorAll: vi.fn(() => []) };
    const urls = [
      'https://x.com/a/../home', 'https://x.com/a/%2e%2e/home',
      'https://x.com/a/./status/1', 'https://x.com/@home',
      'https://x.com/%40search/status/1', 'https://x.com/%20notifications%20/media',
    ];
    let empty;
    for (const url of urls) {
      const classified = classifyXRoute(url);
      expect(classified.type).toBe('unsupported');
      const plans = createXAccountTargetSessionPlans(root, classified);
      empty ??= plans;
      expect(plans).toBe(empty);
      expect(Object.isFrozen(plans)).toBe(true);
    }
    expect(root.querySelectorAll).not.toHaveBeenCalled();
  });

  it('returns one shared frozen empty result for unsupported routes', () => {
    const root = new FakeDocument();
    const first = createXAccountTargetSessionPlans(root, route('unsupported'));
    expect(first).toBe(createXAccountTargetSessionPlans(root, classifyXRoute('/relative')));
    expect(first).toEqual([]);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('validates options and preserves own baseUrl presence and exact values', () => {
    const root = new FakeDocument();
    const value = { urlLike: true };
    for (const baseUrl of ['https://x.com', value, undefined, null]) {
      const plans = createXAccountTargetSessionPlans(root, route('profile', 'a', 'posts'), { baseUrl });
      expect(plans.every((plan) => Object.hasOwn(plan, 'baseUrl') && plan.baseUrl === baseUrl)).toBe(true);
    }
    expect(Object.hasOwn(createXAccountTargetSessionPlans(root, route('home'))[0], 'baseUrl')).toBe(false);
    Object.defineProperty(Object.prototype, 'baseUrl', {
      configurable: true, value: 'ignored',
    });
    try {
      expect(Object.hasOwn(createXAccountTargetSessionPlans(root, route('home'), {})[0], 'baseUrl'))
        .toBe(false);
    } finally {
      delete Object.prototype.baseUrl;
    }
    expect(createXAccountTargetSessionPlans(
      root, route('home'), Object.assign(Object.create(null), { baseUrl: value }),
    )[0].baseUrl).toBe(value);
    for (const options of [null, [], new Map(), 'options']) {
      expect(() => createXAccountTargetSessionPlans(root, route('home'), options))
        .toThrow(new TypeError('account target route planner options must be a plain object'));
    }
    for (const options of [{ extra: true }, Object.assign({}, { [Symbol('x')]: true })]) {
      expect(() => createXAccountTargetSessionPlans(root, route('home'), options))
        .toThrow(new TypeError('Invalid account target route planner options'));
    }
    const throwing = {};
    Object.defineProperty(throwing, 'baseUrl', { get() { throw new Error('no'); } });
    expect(() => createXAccountTargetSessionPlans(root, route('home'), throwing))
      .toThrow(new TypeError('Invalid account target route planner options'));
  });
});
