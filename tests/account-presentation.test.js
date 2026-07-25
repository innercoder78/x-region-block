import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_PRESENTATION_VERSION,
  presentXAccountLink,
} from '../src/content/account-presentation.js';
import {
  LOCATION_BADGE_ATTRIBUTE,
  findLocationBadge,
  renderLocationBadge,
} from '../src/content/location-badge-renderer.js';
import { normalizeSettings } from '../src/shared/settings-schema.js';
import { createSettingsRuntime } from '../src/shared/settings-runtime.js';
import { attributesOf, createContainer, FakeDocument, snapshot } from './helpers/fake-dom.js';

function anchor(href, baseURI = 'https://x.com/home') {
  const attributes = new Map();
  if (href !== undefined) attributes.set('href', href);
  return {
    tagName: 'A',
    ownerDocument: { baseURI },
    getAttribute: vi.fn((name) => attributes.get(name) ?? null),
  };
}

const known = (countryCode = 'CA', countryName = 'Canada', extra = {}) => ({
  status: 'known', countryCode, countryName, ...extra,
});
const settings = (overrides = {}) => normalizeSettings({ schemaVersion: 1, ...overrides });
const present = (container, observation = {}, configured = {}) => presentXAccountLink(
  anchor('/OpenAI'), container, { location: known(), ...observation }, settings(configured),
);

describe('account presentation boundary', () => {
  it('exports version 1 and returns the canonical deeply immutable evaluation', () => {
    const { container } = createContainer();
    const result = present(container, { languages: ['EN'], tags: ['News'] });
    expect(ACCOUNT_PRESENTATION_VERSION).toBe(1);
    expect(Object.keys(result)).toEqual(['version', 'subject', 'action', 'display']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.subject.identity)).toBe(true);
    expect(Object.isFrozen(result.subject.location)).toBe(true);
    expect(Object.isFrozen(result.subject.languages)).toBe(true);
    expect(Object.isFrozen(result.display.region)).toBe(true);
    expect(Object.values(result)).not.toContain(container);
  });

  it('validates the container before reading any other input and without mutation', () => {
    const link = {};
    Object.defineProperty(link, 'tagName', { get: () => { throw new Error('link read'); } });
    expect(() => presentXAccountLink(link, null, null, null))
      .toThrow(new TypeError('Invalid location badge container'));
  });

  it('works with disconnected and cross-document containers', () => {
    const document = new FakeDocument();
    const container = document.createElement('aside');
    container.isConnected = false;
    expect(present(container).action).toBe('show');
    expect(findLocationBadge(container).ownerDocument).toBe(document);
  });
});

describe('rendering and action independence', () => {
  it.each([
    ['CA', 'Canada', 'NORTH_AMERICA', '🇨🇦', '🌐 North America'],
    ['ZA', 'South Africa', 'AFRICA', '🇿🇦', '🌐 Africa'],
    ['JP', 'Japan', 'ASIA', '🇯🇵', '🌐 Asia'],
    ['FR', 'France', 'EUROPE', '🇫🇷', '🌐 Europe'],
    ['AE', 'United Arab Emirates', 'MIDDLE_EAST', '🇦🇪', '🌐 Middle East'],
    ['AU', 'Australia', 'OCEANIA', '🇦🇺', '🌐 Oceania'],
    ['BR', 'Brazil', 'SOUTH_AMERICA', '🇧🇷', '🌐 South America'],
    ['JM', 'Jamaica', 'CARIBBEAN', '🇯🇲', '🌐 Caribbean'],
    ['CR', 'Costa Rica', 'CENTRAL_AMERICA', '🇨🇷', '🌐 Central America'],
  ])('renders canonical region-enriched %s presentation', (code, name, region, flag, label) => {
    const { container } = createContainer();
    const result = present(container, { location: known(code, name) });
    const root = findLocationBadge(container);
    expect(root.children.map((child) => child.textContent)).toEqual([flag, ' ', label]);
    expect(root.children[2].getAttribute('data-x-region-block-region-code')).toBe(region);
    expect(root.getAttribute('aria-label'))
      .toBe(`${result.display.country.ariaLabel}; ${result.display.region.ariaLabel}`);
    expect(root.getAttribute('title'))
      .toBe(`${result.display.country.title} · ${result.display.region.title}`);
  });

  it.each([
    ['hidden', 'Location hidden'], ['missing', 'Location not provided'],
    ['unavailable', 'Location unavailable'], ['unknown', 'Location unknown'],
  ])('renders exact %s presentation', (status, label) => {
    const { container } = createContainer();
    const result = present(container, { location: { status } });
    const root = findLocationBadge(container);
    expect(attributesOf(root)).toMatchObject({
      [LOCATION_BADGE_ATTRIBUTE]: '1', 'data-x-region-block-status': status,
      'aria-label': label, title: label,
    });
    expect(root.children.map((child) => child.textContent)).toEqual([`🌐 ${label}`]);
    expect(result.display.region.label).toBe(label);
  });

  it('keeps Antarctica known without a region-code attribute', () => {
    const { container } = createContainer();
    present(container, { location: known('AQ', 'Antarctica') });
    const root = findLocationBadge(container);
    expect(root.children.map((child) => child.textContent)).toEqual(['🇦🇶', ' ', '🌐 Unknown region']);
    expect(root.children[2].hasAttribute('data-x-region-block-region-code')).toBe(false);
  });

  it.each([
    [{}, 'show'],
    [{ country: { highlight: ['CA'] } }, 'highlight'],
    [{ country: { hide: ['CA'] }, language: { highlight: ['en'] } }, 'hide'],
    [{ allowlist: ['@openai'], country: { hide: ['CA'] } }, 'show'],
    [{ country: { alwaysShow: ['CA'] }, region: { hide: ['NORTH_AMERICA'] } }, 'show'],
    [{ region: { hide: ['NORTH_AMERICA'] }, tag: { highlight: ['news'] } }, 'hide'],
  ])('renders without applying the %s action', (configured, action) => {
    const { container } = createContainer();
    container.setAttribute('style', 'display:block');
    container.setAttribute('data-page', 'unchanged');
    const unrelated = container.ownerDocument.createElement('em');
    unrelated.textContent = 'keep';
    container.appendChild(unrelated);
    const result = present(container, { languages: ['en'], tags: ['news'] }, configured);
    expect(result.action).toBe(action);
    expect(container.getAttribute('style')).toBe('display:block');
    expect(container.getAttribute('data-page')).toBe('unchanged');
    expect(container.children[0]).toBe(unrelated);
    expect(JSON.stringify(snapshot(findLocationBadge(container)))).not.toMatch(/highlight|hide/);
  });
});

describe('cleanup, atomicity, and updates', () => {
  it.each([undefined, '/home', 'https://example.com/OpenAI', '/bad!', 'https://[bad', 'OpenAI']) (
    'cleans stale badges for rejected href %s', (href) => {
      const { container } = createContainer();
      renderLocationBadge(container, known());
      expect(presentXAccountLink(anchor(href), container, {}, { malformed: true })).toBeNull();
      expect(findLocationBadge(container)).toBeNull();
    },
  );

  it('removes all direct owned roots but preserves nested and unrelated roots', () => {
    const { container } = createContainer();
    const wrapper = container.ownerDocument.createElement('p');
    const nested = container.ownerDocument.createElement('span');
    nested.setAttribute(LOCATION_BADGE_ATTRIBUTE, '1');
    wrapper.appendChild(nested);
    const different = container.ownerDocument.createElement('span');
    different.setAttribute(LOCATION_BADGE_ATTRIBUTE, '2');
    container.appendChild(wrapper);
    container.appendChild(different);
    renderLocationBadge(container, known());
    const duplicate = container.ownerDocument.createElement('span');
    duplicate.setAttribute(LOCATION_BADGE_ATTRIBUTE, '1');
    container.appendChild(duplicate);
    expect(presentXAccountLink(anchor('/home'), container, {}, settings())).toBeNull();
    expect(container.children).toEqual([wrapper, different]);
    expect(wrapper.children).toEqual([nested]);
  });

  it.each([
    [{ location: known(), accountId: '1' }, settings()],
    [{}, settings()],
    [{ location: { status: 'bad' } }, settings()],
    [{ location: known('ZZ', 'Invalid') }, settings()],
    [{ location: known('CA', 'Canada', { regionCode: 'ASIA' }) }, settings()],
    [{ location: known(), source: 'secret' }, settings()],
    [{ location: known(), languages: 'en' }, settings()],
    [{ location: known(), tags: [null] }, settings()],
    [{ location: known() }, { country: [] }],
  ])('preserves the complete DOM when evaluation throws', (observation, configured) => {
    const { container } = createContainer();
    const unrelated = container.ownerDocument.createElement('i');
    container.appendChild(unrelated);
    renderLocationBadge(container, known());
    const duplicate = container.ownerDocument.createElement('span');
    duplicate.setAttribute(LOCATION_BADGE_ATTRIBUTE, '1');
    container.appendChild(duplicate);
    const before = snapshot(container);
    expect(() => presentXAccountLink(anchor('/OpenAI'), container, observation, configured)).toThrow();
    expect(snapshot(container)).toEqual(before);
  });

  it('preserves identity, self-heals duplicates, and performs reversible updates', () => {
    const { container } = createContainer();
    const firstResult = present(container);
    const root = findLocationBadge(container);
    const duplicate = container.ownerDocument.createElement('span');
    duplicate.setAttribute(LOCATION_BADGE_ATTRIBUTE, '1');
    container.appendChild(duplicate);
    const secondResult = present(container);
    expect(secondResult).toEqual(firstResult);
    expect(secondResult).not.toBe(firstResult);
    expect(findLocationBadge(container)).toBe(root);
    expect(container.children).toHaveLength(1);
    present(container, { location: known('JP', 'Japan') });
    expect(root.textContent).toBe('🇯🇵 🌐 Asia');
    present(container, { location: { status: 'hidden' } });
    expect(root.children).toHaveLength(1);
    present(container);
    expect(root.textContent).toBe('🇨🇦 🌐 North America');
    present(container, { location: known('AQ', 'Antarctica') });
    expect(root.children[2].hasAttribute('data-x-region-block-region-code')).toBe(false);
    present(container);
    expect(root.children[2].getAttribute('data-x-region-block-region-code')).toBe('NORTH_AMERICA');
  });
});

describe('runtime compatibility and isolation', () => {
  it('accepts runtime snapshots without subscribing or reading storage', async () => {
    const initial = settings();
    const subscribe = vi.fn(() => vi.fn());
    const initializeSettings = vi.fn().mockResolvedValue(initial);
    const runtime = createSettingsRuntime({
      repository: { initializeSettings }, changeAdapter: { subscribe }, onError: vi.fn(),
    });
    await runtime.start();
    const { container } = createContainer();
    expect(present(container, {}, runtime.getSettings()).action).toBe('show');
    expect(present(container, {}, { country: { hide: ['CA'] } }).action).toBe('hide');
    expect(subscribe).toHaveBeenCalledOnce();
    expect(initializeSettings).toHaveBeenCalledOnce();
  });

  it('does not mutate frozen inputs, leak sensitive values, or use ambient APIs', async () => {
    const { container } = createContainer();
    const link = Object.freeze(anchor('/OpenAI?token=href-secret'));
    const location = Object.freeze({ ...known(), rawLocation: 'raw-secret', secret: 'discard' });
    const observation = Object.freeze({
      location, languages: Object.freeze(['EN']), tags: Object.freeze(['News']), source: 'timeline',
    });
    const configured = settings();
    const before = structuredClone(configured);
    const result = presentXAccountLink(link, container, observation, configured);
    expect(configured).toEqual(before);
    expect(JSON.stringify(result)).not.toMatch(/href-secret|discard/);
    expect(JSON.stringify(snapshot(container))).not.toMatch(/raw-secret|href-secret|timeline|discard/);

    const source = await readFile('src/content/account-presentation.js', 'utf8');
    expect(source).not.toMatch(/querySelector|closest|matches|getElementsBy|MutationObserver|document\.|globalThis|window\.|fetch|XMLHttpRequest|storage|sendMessage|setTimeout|setInterval|addEventListener|console\./);
  });
});
