import { describe, expect, it } from 'vitest';
import {
  X_ROUTE_CLASSIFIER_VERSION,
  classifyXRoute,
} from '../src/content/x-route-classifier.js';
import { RESERVED_X_ROUTE_SEGMENTS } from '../src/shared/account-identity.js';

const fields = (type, handle = null, profileSection = null, statusId = null) => ({
  version: 1, type, handle, profileSection, statusId,
});

describe('X route classifier', () => {
  it('exports version 1 and exact immutable minimal descriptors', () => {
    const route = classifyXRoute(' https://X.COM/OpenAI?secret=term#private ');
    expect(X_ROUTE_CLASSIFIER_VERSION).toBe(1);
    expect(route).toEqual(fields('profile', 'openai', 'posts'));
    expect(Object.keys(route)).toEqual(['version', 'type', 'handle', 'profileSection', 'statusId']);
    expect(Object.isFrozen(route)).toBe(true);
    expect(JSON.stringify(route)).not.toMatch(/secret|term|private|https|x\.com/i);
  });

  it.each([undefined, null, new URL('https://x.com'), {}, 1])(
    'requires a string',
    (value) => expect(() => classifyXRoute(value))
      .toThrow(new TypeError('X route URL must be a string')),
  );

  it('shares the frozen unsupported descriptor', () => {
    const first = classifyXRoute('https://example.com/home');
    expect(first).toBe(classifyXRoute('/home'));
    expect(first).toEqual(fields('unsupported'));
    expect(Object.isFrozen(first)).toBe(true);
  });

  it.each([
    ['https://x.com', fields('home')],
    ['https://twitter.com/', fields('home')],
    ['https://x.com/HOME/', fields('home')],
    ['https://x.com/explore', fields('explore')],
    ['https://x.com/EXPLORE/TABS/for-you/', fields('explore')],
    ['https://x.com/search?q=private#hash', fields('search')],
    ['https://x.com/notifications/', fields('notifications')],
    ['https://x.com/NOTIFICATIONS/MENTIONS', fields('notifications')],
    ['https://x.com/OpenAI', fields('profile', 'openai', 'posts')],
    ['https://x.com/OpenAI/with_REPLIES/', fields('profile', 'openai', 'replies')],
    ['https://x.com/a/media', fields('profile', 'a', 'media')],
    ['https://x.com/a/LIKES/', fields('profile', 'a', 'likes')],
    ['https://x.com/a/highlights', fields('profile', 'a', 'highlights')],
    ['https://x.com/a/articles/', fields('profile', 'a', 'articles')],
    ['https://x.com/OpenAI/STATUS/0010', fields('status', 'openai', null, '0010')],
    ['https://x.com/a/status/1/PHOTO/2/', fields('status', 'a', null, '1')],
    ['https://x.com/a/status/2/video/1', fields('status', 'a', null, '2')],
  ])('classifies %s', (url, expected) => expect(classifyXRoute(url)).toEqual(expected));

  it.each([
    'http://x.com/home', 'https:/x.com/home', '//x.com/home', '/home',
    'https://mobile.x.com/home', 'https://www.x.com/home', 'https://example.com/home',
    'https://x.com:443/home', 'https://user@x.com/home', 'https://user:pass@x.com/home',
    'https://x.com\\home', 'javascript:alert(1)', 'https://x.com//home',
    'https://x.com/home//', 'https://x.com/%', 'https://x.com/a/%',
    'https://x.com/a%2Fb', 'https://x.com/a%5Cb',
    'https://x.com/search/advanced', 'https://x.com/explore/tabs',
    'https://x.com/a/followers', 'https://x.com/a/following', 'https://x.com/a/lists',
    'https://x.com/a/communities', 'https://x.com/a/bookmarks', 'https://x.com/a/unknown',
    'https://x.com/a/status', 'https://x.com/a/status/no', 'https://x.com/a/status/1/gif/1',
    'https://x.com/a/status/1/photo/0', 'https://x.com/a/status/1/video/no',
    'https://x.com/a/status/1/photo/1/more', 'https://x.com/invalid-handle',
    'https://x.com/abcdefghijklmnop',
    'https://x.com/./home', 'https://x.com/a/../home',
    'https://x.com/a/./status/1', 'https://x.com/a/status/1/../2',
    'https://x.com/%2e/home', 'https://x.com/%2E/home',
    'https://x.com/a/%2e%2e/home', 'https://x.com/a/.%2e/home',
    'https://x.com/a/%2e./home', 'https://x.com/a/status/%2e/1',
    'https://x.com/ho\tme', 'https://x.com/op\renai',
    'https://x.com/a/status/\n1', 'https://x.com/explore/tabs/for\tyou',
    'https://x.\ncom/home', 'https://x.com/ho\u0001me', 'https://x.com/a\u007f',
    'https://x.com/ho%0Ame', 'https://x.com/open%09ai',
    'https://x.com/explore/tabs/%00',
    'https://x.com/explore/tabs/%0A', 'https://x.com/explore/tabs/%09',
    'https://x.com/%00', 'https://x.com/a/status/%0D',
  ])('rejects unsafe or unsupported URL %s', (url) => {
    expect(classifyXRoute(url)).toEqual(fields('unsupported'));
  });

  it('never treats a reserved application segment as a profile', () => {
    for (const segment of RESERVED_X_ROUTE_SEGMENTS) {
      const expectedTypes = new Map([
        ['home', 'home'], ['explore', 'explore'], ['notifications', 'notifications'], ['search', 'search'],
      ]);
      const route = classifyXRoute(`https://x.com/${segment}`);
      expect(route.type).toBe(expectedTypes.get(segment) ?? 'unsupported');
      expect(route.handle).toBeNull();

      for (const unsafeHandle of [
        `@${segment}`, `%40${segment}`, `%20${segment}`, `${segment}%20`,
      ]) {
        expect(classifyXRoute(`https://x.com/${unsafeHandle}`).type).toBe('unsupported');
        expect(classifyXRoute(`https://x.com/${unsafeHandle}/media`).type).toBe('unsupported');
        expect(classifyXRoute(`https://x.com/${unsafeHandle}/status/1`).type)
          .toBe('unsupported');
      }
      expect(classifyXRoute(`https://x.com/${segment}/media`).type).toBe('unsupported');
      expect(classifyXRoute(`https://x.com/${segment}/status/1`).type).toBe('unsupported');
    }
  });

  it('continues accepting mixed-case bare handles only', () => {
    expect(classifyXRoute('https://x.com/MiXeD_CaSe')).toEqual(
      fields('profile', 'mixed_case', 'posts'),
    );
    expect(classifyXRoute('https://x.com/MiXeD_CaSe/status/007')).toEqual(
      fields('status', 'mixed_case', null, '007'),
    );
  });
});
