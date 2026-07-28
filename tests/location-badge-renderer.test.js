import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  LOCATION_BADGE_ATTRIBUTE,
  LOCATION_BADGE_ATTRIBUTE_VALUE,
  LOCATION_BADGE_CLASSES,
  LOCATION_BADGE_RENDERER_VERSION,
  findLocationBadge,
  removeLocationBadge,
  renderLocationBadge,
} from '../src/content/location-badge-renderer.js';
import { attributesOf, createContainer, FakeDocument, snapshot } from './helpers/fake-dom.js';

const known = (countryCode = 'CA', countryName = 'Canada', extra = {}) => ({
  status: 'known', countryCode, countryName, ...extra,
});

describe('location badge renderer boundary', () => {
  it('exports stable frozen definitions', () => {
    expect(LOCATION_BADGE_RENDERER_VERSION).toBe(1);
    expect(LOCATION_BADGE_ATTRIBUTE).toBe('data-x-region-block-location-badge');
    expect(LOCATION_BADGE_ATTRIBUTE_VALUE).toBe('1');
    expect(LOCATION_BADGE_CLASSES).toEqual({
      root: 'x-region-block-location-badge', country: 'x-region-block-location-country',
      countryFlag: 'x-region-block-location-country-flag',
      separator: 'x-region-block-location-separator', region: 'x-region-block-location-region',
    });
    expect(Object.isFrozen(LOCATION_BADGE_CLASSES)).toBe(true);
  });

  it.each([null, undefined, 0, true, 'node', [], {}, { ownerDocument: {} }])(
    'rejects invalid container %j',
    (container) => expect(() => renderLocationBadge(container, { status: 'unknown' }))
      .toThrow(new TypeError('Invalid location badge container')),
  );

  it.each([
    (container) => { container.ownerDocument.createElement = null; },
    (container) => { container.children = null; },
    (container) => { container.appendChild = null; },
    (container) => { container.removeChild = null; },
  ])('rejects a container missing a required capability', (breakContainer) => {
    const { container } = createContainer();
    breakContainer(container);
    expect(() => findLocationBadge(container)).toThrow(TypeError);
    expect(() => removeLocationBadge(container)).toThrow(TypeError);
  });

  it('renders into a disconnected container through its non-global owner document', () => {
    const foreignDocument = new FakeDocument();
    const container = foreignDocument.createElement('section');
    const root = renderLocationBadge(container, { status: 'unknown' });
    expect(root.ownerDocument).toBe(foreignDocument);
    expect(root.parentNode).toBe(container);
  });

  it('validates location before any mutation', () => {
    const { container } = createContainer();
    const unrelated = container.ownerDocument.createElement('p');
    container.appendChild(unrelated);
    expect(() => renderLocationBadge(container, known('CA', 'Canada', { regionCode: 'EUROPE' })))
      .toThrow('regionCode must match the country region');
    expect(container.children).toEqual([unrelated]);
  });
});

describe('known location rendering', () => {
  it('renders a local decorative PNG and falls back to the country code after one image error', () => {
    const { container } = createContainer();
    const resolver = vi.fn((code) => `chrome-extension://test/assets/flags/${code.toLowerCase()}.png`);
    const root = renderLocationBadge(container, known('US', 'United States'), resolver);
    const country = root.children[0];
    const image = country.children[0];
    expect(resolver).toHaveBeenCalledOnce();
    expect(resolver).toHaveBeenCalledWith('US');
    expect(image.tagName).toBe('IMG');
    expect(attributesOf(image)).toMatchObject({
      src: 'chrome-extension://test/assets/flags/us.png', alt: '',
      'aria-hidden': 'true', draggable: 'false', tabindex: '-1', contenteditable: 'false',
    });
    expect(root.getAttribute('aria-label')).toBe('Country: United States; Region: North America');
    expect(root.getAttribute('title')).toBe('United States · North America');
    image.dispatchEvent({ type: 'error' });
    image.dispatchEvent({ type: 'error' });
    expect(country.textContent).toBe('US');
    expect(root.textContent).toBe('US 🌐 North America');
  });

  it('renders Canada with exact semantics, order, text, and safe attributes', () => {
    const { container } = createContainer();
    const root = renderLocationBadge(container, known());
    expect(root.tagName).toBe('SPAN');
    expect(attributesOf(root)).toEqual({
      class: LOCATION_BADGE_CLASSES.root,
      [LOCATION_BADGE_ATTRIBUTE]: '1',
      'data-x-region-block-status': 'known', role: 'group',
      'aria-label': 'Country: Canada; Region: North America',
      title: 'Canada · North America',
    });
    expect(root.children.map((child) => child.getAttribute('class'))).toEqual([
      LOCATION_BADGE_CLASSES.country, LOCATION_BADGE_CLASSES.separator, LOCATION_BADGE_CLASSES.region,
    ]);
    expect(attributesOf(root.children[0])).toEqual({
      class: LOCATION_BADGE_CLASSES.country, 'aria-hidden': 'true', title: 'Canada',
      'data-x-region-block-country-code': 'CA',
    });
    expect(root.children[0].textContent).toBe('CA');
    expect(attributesOf(root.children[1])).toEqual({
      class: LOCATION_BADGE_CLASSES.separator, 'aria-hidden': 'true',
    });
    expect(root.children[1].textContent).toBe(' ');
    expect(attributesOf(root.children[2])).toEqual({
      class: LOCATION_BADGE_CLASSES.region, 'aria-hidden': 'true', title: 'North America',
      'data-x-region-block-region-code': 'NORTH_AMERICA',
    });
    expect(root.children[2].textContent).toBe('🌐 North America');
    expect(container.ownerDocument.created.map((element) => element.tagName))
      .toEqual(['DIV', 'SPAN', 'SPAN', 'SPAN', 'SPAN']);
    expect(container.ownerDocument.created.some((element) =>
      ['A', 'BUTTON', 'INPUT'].includes(element.tagName))).toBe(false);
    expect(container.ownerDocument.created.every((element) =>
      !element.hasAttribute('tabindex') && ![...element.attributes.keys()].some((name) => name.startsWith('on')))).toBe(true);
  });

  it.each([
    ['AO', 'Angola', 'AFRICA', 'Africa'], ['JP', 'Japan', 'ASIA', 'Asia'],
    ['GB', 'United Kingdom', 'EUROPE', 'Europe'], ['AE', 'United Arab Emirates', 'MIDDLE_EAST', 'Middle East'],
    ['CA', 'Canada', 'NORTH_AMERICA', 'North America'], ['AU', 'Australia', 'OCEANIA', 'Oceania'],
    ['BR', 'Brazil', 'SOUTH_AMERICA', 'South America'], ['JM', 'Jamaica', 'CARIBBEAN', 'Caribbean'],
    ['CR', 'Costa Rica', 'CENTRAL_AMERICA', 'Central America'],
  ])('derives the canonical configured region for %s', (code, name, regionCode, regionName) => {
    const { container } = createContainer();
    const root = renderLocationBadge(container, known(code, name));
    expect(root.children[2].getAttribute('data-x-region-block-region-code')).toBe(regionCode);
    expect(root.children[2].textContent).toBe(`🌐 ${regionName}`);
  });

  it('accepts matching region assertions', () => {
    const { container } = createContainer();
    expect(renderLocationBadge(container, known('CA', 'Canada', {
      regionCode: 'NORTH_AMERICA', regionName: 'North America',
    })).getAttribute('data-x-region-block-status')).toBe('known');
  });
});

describe('Antarctica and non-known locations', () => {
  it('keeps Antarctica known and renders its unknown region distinctly', () => {
    const { container } = createContainer();
    const root = renderLocationBadge(container, known('AQ', 'Antarctica'));
    expect(root.getAttribute('data-x-region-block-status')).toBe('known');
    expect(root.getAttribute('aria-label')).toBe('Country: Antarctica; Region: Unknown');
    expect(root.getAttribute('title')).toBe('Antarctica · Unknown region');
    expect(root.children[0].textContent).toBe('AQ');
    expect(root.children[0].getAttribute('data-x-region-block-country-code')).toBe('AQ');
    expect(root.children[2].textContent).toBe('🌐 Unknown region');
    expect(root.children[2].hasAttribute('data-x-region-block-region-code')).toBe(false);
  });

  it.each([
    ['hidden', 'Location hidden'], ['missing', 'Location not provided'],
    ['unavailable', 'Location unavailable'], ['unknown', 'Location unknown'],
  ])('renders distinct %s presentation', (status, label) => {
    const { container } = createContainer();
    const root = renderLocationBadge(container, { status });
    expect(attributesOf(root)).toEqual({
      class: LOCATION_BADGE_CLASSES.root, [LOCATION_BADGE_ATTRIBUTE]: '1',
      'data-x-region-block-status': status, role: 'group', 'aria-label': label, title: label,
    });
    expect(root.children).toHaveLength(1);
    expect(attributesOf(root.children[0])).toEqual({
      class: LOCATION_BADGE_CLASSES.region, 'aria-hidden': 'true', title: label,
    });
    expect(root.children[0].textContent).toBe(`🌐 ${label}`);
  });
});

describe('idempotence and direct-child ownership', () => {
  it('preserves root identity, produces equivalent DOM, and performs exact updates', () => {
    const { container } = createContainer();
    const first = renderLocationBadge(container, known());
    const firstSnapshot = snapshot(first);
    expect(renderLocationBadge(container, known())).toBe(first);
    expect(snapshot(first)).toEqual(firstSnapshot);
    expect(container.children).toHaveLength(1);

    renderLocationBadge(container, known('JP', 'Japan'));
    expect(first.children.map((child) => child.textContent)).toEqual(['JP', ' ', '🌐 Asia']);
    renderLocationBadge(container, { status: 'hidden' });
    expect(first.children.map((child) => child.textContent)).toEqual(['🌐 Location hidden']);
    renderLocationBadge(container, known());
    expect(first.children).toHaveLength(3);
    renderLocationBadge(container, known('AQ', 'Antarctica'));
    expect(first.children[2].hasAttribute('data-x-region-block-region-code')).toBe(false);
  });

  it('self-heals direct duplicates without touching nested, differently owned, or unrelated nodes', () => {
    const { container } = createContainer();
    const unrelated = container.ownerDocument.createElement('p');
    const nested = container.ownerDocument.createElement('span');
    nested.setAttribute(LOCATION_BADGE_ATTRIBUTE, '1');
    unrelated.appendChild(nested);
    const different = container.ownerDocument.createElement('span');
    different.setAttribute(LOCATION_BADGE_ATTRIBUTE, '2');
    const ownedOne = container.ownerDocument.createElement('span');
    ownedOne.setAttribute(LOCATION_BADGE_ATTRIBUTE, '1');
    ownedOne.setAttribute('data-x-region-block-country-code', 'STALE');
    ownedOne.setAttribute('data-x-region-block-region-code', 'STALE');
    ownedOne.setAttribute('tabindex', '0');
    ownedOne.setAttribute('contenteditable', 'true');
    const ownedTwo = container.ownerDocument.createElement('span');
    ownedTwo.setAttribute(LOCATION_BADGE_ATTRIBUTE, '1');
    [unrelated, different, ownedOne, ownedTwo].forEach((child) => container.appendChild(child));
    expect(findLocationBadge(container)).toBe(ownedOne);
    expect(renderLocationBadge(container, { status: 'unknown' })).toBe(ownedOne);
    expect(container.children).toEqual([unrelated, different, ownedOne]);
    expect(unrelated.children).toEqual([nested]);
    expect(ownedOne.hasAttribute('data-x-region-block-country-code')).toBe(false);
    expect(ownedOne.hasAttribute('data-x-region-block-region-code')).toBe(false);
    expect(ownedOne.hasAttribute('tabindex')).toBe(false);
    expect(ownedOne.hasAttribute('contenteditable')).toBe(false);
  });
});

describe('removal', () => {
  it('removes every direct owned root, returns its count, and leaves all other content', () => {
    const { container } = createContainer();
    const unrelated = container.ownerDocument.createElement('p');
    const nested = container.ownerDocument.createElement('span');
    nested.setAttribute(LOCATION_BADGE_ATTRIBUTE, '1');
    unrelated.appendChild(nested);
    const different = container.ownerDocument.createElement('span');
    different.setAttribute(LOCATION_BADGE_ATTRIBUTE, 'other');
    container.appendChild(unrelated);
    container.appendChild(different);
    renderLocationBadge(container, { status: 'unknown' });
    const duplicate = container.ownerDocument.createElement('span');
    duplicate.setAttribute(LOCATION_BADGE_ATTRIBUTE, '1');
    container.appendChild(duplicate);
    expect(removeLocationBadge(container)).toBe(2);
    expect(container.children).toEqual([unrelated, different]);
    expect(unrelated.children).toEqual([nested]);
    expect(findLocationBadge(container)).toBeNull();
    expect(removeLocationBadge(container)).toBe(0);
  });
});

describe('renderer safety and isolation', () => {
  it('keeps markup-like names literal and does not leak arbitrary or sensitive input', () => {
    const { container } = createContainer();
    const input = Object.freeze({
      ...known('CA', '"><img src=x onerror=alert(1)>'), rawLocation: 'raw-secret',
      source: 'source-secret', token: 'token-secret', url: 'https://secret.test',
    });
    const root = renderLocationBadge(container, input);
    expect(root.getAttribute('title')).toContain('"><img src=x onerror=alert(1)>');
    expect(JSON.stringify(snapshot(root))).not.toMatch(/raw-secret|source-secret|token-secret|secret\.test|rawLocation|source/);
    expect(container.ownerDocument.created.every((element) => element.tagName === 'DIV' || element.tagName === 'SPAN')).toBe(true);
  });

  it('uses no unsafe, global, page-activity, or integration APIs', async () => {
    const source = await readFile('src/content/location-badge-renderer.js', 'utf8');
    expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|DOMParser|document\.|globalThis|window\.|eval\(|Function\(|querySelector|MutationObserver|fetch|XMLHttpRequest|localStorage|sessionStorage|runtime\.sendMessage|location\.|setTimeout|setInterval|requestAnimationFrame/);
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy;
    try {
      const { container } = createContainer();
      renderLocationBadge(container, known());
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
