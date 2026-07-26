import { describe, expect, it, vi } from 'vitest';
import { classifyXRoute } from '../src/content/x-route-classifier.js';
import { createXAccountTargetSessionPlans } from '../src/content/account-target-route-planner.js';
import { createXAccountTargetSessionGroup } from '../src/content/account-target-session-group.js';
import { findLocationBadge } from '../src/content/location-badge-renderer.js';
import { getAccountAction } from '../src/content/account-action-renderer.js';
import { FakeDocument } from './helpers/fake-dom.js';
import { createFakeAbortController } from './helpers/fake-abort-controller.js';
import { createFakeObserverFactory } from './helpers/fake-mutation-observer.js';

function accountSurface(document, kind, handle) {
  const surface = document.createElement(kind === 'tweet' ? 'article' : 'div');
  surface.setAttribute('data-testid', kind === 'tweet' ? 'tweet' : 'UserName');
  const name = kind === 'tweet' ? document.createElement('div') : surface;
  if (kind === 'tweet') name.setAttribute('data-testid', 'User-Name');
  const link = document.createElement('a');
  link.setAttribute('href', `/${handle}`);
  name.appendChild(link);
  if (kind === 'tweet') surface.appendChild(name);
  document.appendChild(surface);
  return { surface, name };
}

function dependencies(loadPayload) {
  const listeners = [];
  const observer = createFakeObserverFactory();
  return {
    listeners,
    observer,
    options: {
      settingsRuntime: {
        getSettings: vi.fn(() => ({})),
        subscribe: vi.fn((listener) => {
          listeners.push(listener);
          return vi.fn();
        }),
      },
      observerFactory: observer.factory,
      loadPayload,
      brokerAbortControllerFactory: vi.fn(createFakeAbortController),
      consumerAbortControllerFactory: vi.fn(createFakeAbortController),
      onError: vi.fn(),
    },
  };
}

const payload = {
  data: { user_result_by_screen_name: { result: { about_profile: { account_based_in: 'Japan' } } } },
};

describe('route planning through the real session group', () => {
  it('orders profile before timeline, shares lookup, reevaluates, and cleans up', async () => {
    const document = new FakeDocument();
    const profile = accountSurface(document, 'profile', 'OpenAI');
    const tweet = accountSurface(document, 'tweet', 'openai');
    const plans = createXAccountTargetSessionPlans(
      document, classifyXRoute('https://x.com/OpenAI'),
    );
    expect(plans.map(({ source }) => source)).toEqual(['profile', 'timeline']);
    const loadPayload = vi.fn(async () => payload);
    const { options, listeners } = dependencies(loadPayload);
    const group = createXAccountTargetSessionGroup(plans, options);
    expect(group.start()).toHaveLength(2);
    expect(loadPayload).toHaveBeenCalledTimes(1);
    expect(loadPayload.mock.calls[0][0].source).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(findLocationBadge(profile.name)).not.toBeNull();
    expect(findLocationBadge(tweet.name)).not.toBeNull();
    for (const listener of listeners) listener({});
    expect(loadPayload).toHaveBeenCalledTimes(1);
    group.stop();
    expect(findLocationBadge(profile.name)).toBeNull();
    expect(findLocationBadge(tweet.name)).toBeNull();
    expect(getAccountAction(profile.surface)).toBe('show');
    expect(getAccountAction(tweet.surface)).toBe('show');
    expect(group.isActive()).toBe(false);
  });

  it('uses one reply session on status pages and discovers each article once', async () => {
    const document = new FakeDocument();
    const primary = accountSurface(document, 'tweet', 'openai');
    const reply = accountSurface(document, 'tweet', 'openai');
    const plans = createXAccountTargetSessionPlans(
      document, classifyXRoute('https://x.com/openai/status/001'),
    );
    expect(plans.map(({ source }) => source)).toEqual(['reply']);
    const loadPayload = vi.fn(async () => payload);
    const { options } = dependencies(loadPayload);
    const group = createXAccountTargetSessionGroup(plans, options);
    expect(group.start()).toHaveLength(2);
    expect(new Set(group.getTargets().map(({ accountContainer }) => accountContainer)).size).toBe(2);
    expect(loadPayload).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(findLocationBadge(primary.name)).not.toBeNull();
    expect(findLocationBadge(reply.name)).not.toBeNull();
    group.stop();
    expect(findLocationBadge(primary.name)).toBeNull();
    expect(findLocationBadge(reply.name)).toBeNull();
    expect(group.getTargets()).toEqual([]);
  });

  it('plans profile replies in profile-then-reply order', () => {
    const plans = createXAccountTargetSessionPlans(
      new FakeDocument(), classifyXRoute('https://x.com/openai/with_replies'),
    );
    expect(plans.map(({ source }) => source)).toEqual(['profile', 'reply']);
  });

  it.each([
    'https://x.com/openai/../home/status/1',
    'https://x.com/%40home/status/1',
  ])('does not start a group or lookup for malformed route %s', (url) => {
    const root = { querySelectorAll: vi.fn(() => []) };
    const loadPayload = vi.fn();
    const plans = createXAccountTargetSessionPlans(root, classifyXRoute(url));
    expect(plans).toEqual([]);
    // Empty plans are deliberately not passed to the session-group constructor.
    expect(root.querySelectorAll).not.toHaveBeenCalled();
    expect(loadPayload).not.toHaveBeenCalled();
  });

  it.each([
    ['https://x.com/home', ['timeline']],
    ['https://x.com/search', ['search']],
    ['https://x.com/notifications/mentions', ['notification']],
    ['https://example.com/home', []],
  ])('keeps focused route policy isolated for %s', (url, sources) => {
    const plans = createXAccountTargetSessionPlans(new FakeDocument(), classifyXRoute(url));
    expect(plans.map(({ source }) => source)).toEqual(sources);
  });
});
