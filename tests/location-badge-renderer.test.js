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
import { parseXAboutAccountDetailsPayload } from '../src/shared/x-about-account-details.js';

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
  it('renders a region-only location without resolving a flag', () => {
    const { container } = createContainer();
    const resolver = vi.fn();
    const root = renderLocationBadge(container, { status: 'known', regionCode: 'NORTH_AMERICA',
      regionName: 'North America', rawLocation: 'North America', source: 'x-about-account' }, resolver);
    expect(root.textContent).toBe('🌐 North America');
    expect(root.children).toHaveLength(1);
    expect(root.children[0].getAttribute('class')).toBe(LOCATION_BADGE_CLASSES.region);
    expect(root.getAttribute('aria-label')).toBe('Region: North America');
    expect(root.getAttribute('title')).toBe('North America');
    expect(resolver).not.toHaveBeenCalled();
  });

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
    expect(root.getAttribute('aria-label')).toBe('Country: United States');
    expect(root.getAttribute('title')).toBe('United States');
    image.dispatchEvent({ type: 'error' });
    image.dispatchEvent({ type: 'error' });
    expect(country.textContent).toBe('US');
    expect(root.textContent).toBe('US');
  });

  it('renders Canada with exact semantics, order, text, and safe attributes', () => {
    const { container } = createContainer();
    const root = renderLocationBadge(container, known());
    expect(root.tagName).toBe('SPAN');
    expect(attributesOf(root)).toEqual({
      class: LOCATION_BADGE_CLASSES.root,
      [LOCATION_BADGE_ATTRIBUTE]: '1',
      'data-x-region-block-status': 'known', role: 'group',
      'aria-label': 'Country: Canada', title: 'Canada',
    });
    expect(root.children.map((child) => child.getAttribute('class'))).toEqual([
      LOCATION_BADGE_CLASSES.country,
    ]);
    expect(attributesOf(root.children[0])).toEqual({
      class: LOCATION_BADGE_CLASSES.country, 'aria-hidden': 'true', title: 'Canada',
      'data-x-region-block-country-code': 'CA',
    });
    expect(root.children[0].textContent).toBe('CA');
    expect(container.ownerDocument.created.map((element) => element.tagName))
      .toEqual(['DIV', 'SPAN', 'SPAN']);
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
  ])('does not display the canonical configured region for %s', (code, name) => {
    const { container } = createContainer();
    const root = renderLocationBadge(container, known(code, name));
    expect(root.children).toHaveLength(1);
    expect(root.textContent).toBe(code);
  });

  it('accepts matching region assertions', () => {
    const { container } = createContainer();
    expect(renderLocationBadge(container, known('CA', 'Canada', {
      regionCode: 'NORTH_AMERICA', regionName: 'North America',
    })).getAttribute('data-x-region-block-status')).toBe('known');
  });
});

describe('post About Account details rendering', () => {
  const resolver = (code) => `chrome-extension://test/assets/flags/${code.toLowerCase()}.png`;
  const details = (accountBasedIn, source, locationAccurate) => parseXAboutAccountDetailsPayload({
    version: 2, accountBasedIn, source, locationAccurate,
  });
  const render = (container, value) => renderLocationBadge(container, value.location, resolver,
    { postHeader: true, details: value });

  it.each([
    ['United States', 'App Store', false,
      'Country: | VPN/proxy detected | Connection: iOS app',
      'Country: United States. VPN or proxy detected. Connection: iOS app.'],
    ['United States', 'Web', true, 'Country: | Connection: Web',
      'Country: United States. Connection: Web.'],
    ['North America', 'Google Play', true, 'Region: 🌐 North America | Connection: Android app',
      'Region: North America. Connection: Android app.'],
    ['North America', 'Android', false,
      'Region: 🌐 North America | VPN/proxy detected | Connection: Android app',
      'Region: North America. VPN or proxy detected. Connection: Android app.'],
    ['Atlantis', null, null, 'Location: Unknown | Unknown connection method',
      'Location: Unknown. Unknown connection method.'],
  ])('renders independent post segments for %s / %s / %s',
    (location, source, accurate, visible, accessible) => {
      const { container } = createContainer();
      const root = render(container, details(location, source, accurate));
      expect(root.textContent).toBe(visible);
      expect(root.getAttribute('aria-label')).toBe(accessible);
      const separators = root.children.slice(1).map((segment) => segment.children[0]);
      expect(separators.every((separator) => separator.textContent === ' | '
        && separator.getAttribute('aria-hidden') === 'true')).toBe(true);
      expect(root.textContent).not.toMatch(/^\||\|$|\|\||\|\s*\|/);
    });

  it('falls back to Country: US and safely retains a bounded source title', async () => {
    const { container } = createContainer();
    const value = details('United States', 'United States App Store', false);
    const root = render(container, value);
    root.children[0].children[0].dispatchEvent({ type: 'error' });
    expect(root.textContent).toBe('Country: US | VPN/proxy detected | Connection: iOS app');
    expect(root.getAttribute('title')).toBe('Reported account source: United States App Store');
    expect(await readFile('src/content/location-badge-renderer.js', 'utf8')).not.toContain('innerHTML');
  });

  it('removes stale VPN, source, country, region, and flag children across transitions', () => {
    const { container } = createContainer();
    const root = render(container, details('United States', 'App Store', false));
    for (const value of [
      details('United States', 'Web', true), details('North America', 'Google Play', null),
      details('Canada', null, null), details('Canada', 'Android', false),
    ]) render(container, value);
    expect(root.textContent).toBe('Country: | VPN/proxy detected | Connection: Android app');
    expect(root.textContent).not.toMatch(/iOS|Web|North America|Unknown connection/);
    expect(root.querySelectorAll('[data-x-region-block-country-code="US"]')).toHaveLength(0);
  });
});

describe('Antarctica and non-known locations', () => {
  it('keeps Antarctica known and renders its unknown region distinctly', () => {
    const { container } = createContainer();
    const root = renderLocationBadge(container, known('AQ', 'Antarctica'));
    expect(root.getAttribute('data-x-region-block-status')).toBe('known');
    expect(root.getAttribute('aria-label')).toBe('Country: Antarctica');
    expect(root.getAttribute('title')).toBe('Antarctica');
    expect(root.children[0].textContent).toBe('AQ');
    expect(root.children[0].getAttribute('data-x-region-block-country-code')).toBe('AQ');
    expect(root.children).toHaveLength(1);
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
    expect(first.children.map((child) => child.textContent)).toEqual(['JP']);
    renderLocationBadge(container, { status: 'hidden' });
    expect(first.children.map((child) => child.textContent)).toEqual(['🌐 Location hidden']);
    renderLocationBadge(container, known());
    expect(first.children).toHaveLength(1);
    renderLocationBadge(container, { status: 'known', regionCode: 'NORTH_AMERICA',
      regionName: 'North America' });
    expect(first.textContent).toBe('🌐 North America');
    renderLocationBadge(container, known('AQ', 'Antarctica'));
    expect(first.children).toHaveLength(1);
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
