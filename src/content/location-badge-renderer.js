import { createLocationDisplayModel } from '../shared/location-display.js';

export const LOCATION_BADGE_RENDERER_VERSION = 1;
export const LOCATION_BADGE_ATTRIBUTE = 'data-x-region-block-location-badge';
export const LOCATION_BADGE_ATTRIBUTE_VALUE = '1';

export const LOCATION_BADGE_CLASSES = Object.freeze({
  root: 'x-region-block-location-badge',
  country: 'x-region-block-location-country',
  countryFlag: 'x-region-block-location-country-flag',
  separator: 'x-region-block-location-separator',
  region: 'x-region-block-location-region',
});
const SEGMENT_CLASS = 'x-region-block-location-segment';
const CONNECTION_CLASS = 'x-region-block-location-connection';
const VPN_PROXY_CLASS = 'x-region-block-location-vpn-proxy';

const STATUS_ATTRIBUTE = 'data-x-region-block-status';
const COUNTRY_CODE_ATTRIBUTE = 'data-x-region-block-country-code';
const REGION_CODE_ATTRIBUTE = 'data-x-region-block-region-code';

function validateContainer(container) {
  if (
    container === null
    || typeof container !== 'object'
    || Array.isArray(container)
    || container.ownerDocument === null
    || typeof container.ownerDocument !== 'object'
    || typeof container.ownerDocument.createElement !== 'function'
    || typeof container.appendChild !== 'function'
    || typeof container.removeChild !== 'function'
    || container.children === null
    || (typeof container.children !== 'object' && typeof container.children !== 'function')
    || typeof container.children[Symbol.iterator] !== 'function'
  ) {
    throw new TypeError('Invalid location badge container');
  }
}

function ownedChildren(container) {
  return [...container.children].filter(
    (child) => typeof child?.getAttribute === 'function'
      && child.getAttribute(LOCATION_BADGE_ATTRIBUTE) === LOCATION_BADGE_ATTRIBUTE_VALUE,
  );
}

export function findLocationBadge(container) {
  validateContainer(container);
  const direct = ownedChildren(container)[0] ?? null;
  if (direct !== null) return direct;
  for (let current = container; current?.parentElement; current = current.parentElement) {
    const siblings = current.parentElement.children;
    const index = siblings && typeof siblings[Symbol.iterator] === 'function'
      ? [...siblings].indexOf(current) : -1;
    const header = index > 0 ? siblings[index - 1] : null;
    if (header?.getAttribute?.('data-x-region-block-location-header') === '1') {
      return ownedChildren(header)[0] ?? null;
    }
    if (String(current.parentElement.tagName).toLowerCase() === 'article'
      && current.parentElement.getAttribute?.('data-testid') === 'tweet') break;
  }
  return null;
}

function setCommonChildAttributes(element, className, title) {
  element.setAttribute('class', className);
  element.setAttribute('aria-hidden', 'true');
  if (title !== null) element.setAttribute('title', title);
}

function createRegionElement(ownerDocument, region, postHeader) {
  const element = ownerDocument.createElement('span');
  setCommonChildAttributes(element, LOCATION_BADGE_CLASSES.region, region.title);
  if (region.code !== null) element.setAttribute(REGION_CODE_ATTRIBUTE, region.code);
  element.textContent = postHeader
    ? (region.code === null ? region.label : `Region: ${region.symbol} ${region.label}`)
    : `${region.symbol} ${region.label}`;
  return element;
}

function createCountryElement(ownerDocument, country, resolveFlagAssetUrl, postHeader) {
  const wrapper = ownerDocument.createElement('span');
  setCommonChildAttributes(wrapper, LOCATION_BADGE_CLASSES.country, country.title);
  wrapper.setAttribute(COUNTRY_CODE_ATTRIBUTE, country.code);
  let failed = false;
  const fallback = () => {
    if (failed) return;
    failed = true;
    wrapper.textContent = postHeader ? `Country: ${country.code}` : country.code;
  };
  try {
    if (typeof resolveFlagAssetUrl !== 'function') throw new TypeError();
    const url = resolveFlagAssetUrl(country.code);
    const expectedPath = `/assets/flags/${country.code.toLowerCase()}.png`;
    if (typeof url !== 'string'
      || !/^(?:chrome|moz)-extension:\/\/[^/]+\/assets\/flags\/[a-z]{2}\.png$/.test(url)
      || !url.endsWith(expectedPath)) throw new TypeError();
    const image = ownerDocument.createElement('img');
    image.setAttribute('class', LOCATION_BADGE_CLASSES.countryFlag);
    image.setAttribute('src', url);
    image.setAttribute('alt', '');
    image.setAttribute('aria-hidden', 'true');
    image.setAttribute('draggable', 'false');
    image.setAttribute('tabindex', '-1');
    image.setAttribute('contenteditable', 'false');
    image.addEventListener('error', fallback, { once: true });
    if (postHeader) {
      const label = ownerDocument.createElement('span');
      label.setAttribute('class', 'x-region-block-location-country-label');
      label.textContent = 'Country:';
      wrapper.appendChild(image);
      wrapper.appendChild(label);
    } else {
      wrapper.appendChild(image);
    }
  } catch { fallback(); }
  return wrapper;
}

export function renderLocationBadge(container, location, resolveFlagAssetUrl, options = undefined) {
  validateContainer(container);
  const display = createLocationDisplayModel(location);
  const postHeader = options?.postHeader === true;
  const existing = ownedChildren(container);
  let root = existing[0] ?? null;

  if (root !== null && String(root.tagName).toLowerCase() !== 'span') {
    container.removeChild(root);
    root = null;
  }
  for (const duplicate of existing) {
    if (duplicate !== root && duplicate.parentNode === container) container.removeChild(duplicate);
  }
  if (root === null) {
    root = container.ownerDocument.createElement('span');
    root.setAttribute(LOCATION_BADGE_ATTRIBUTE, LOCATION_BADGE_ATTRIBUTE_VALUE);
    container.appendChild(root);
  }

  root.textContent = '';
  root.setAttribute('class', LOCATION_BADGE_CLASSES.root);
  root.setAttribute(LOCATION_BADGE_ATTRIBUTE, LOCATION_BADGE_ATTRIBUTE_VALUE);
  root.setAttribute(STATUS_ATTRIBUTE, display.status);
  root.setAttribute('role', 'group');
  root.removeAttribute(COUNTRY_CODE_ATTRIBUTE);
  root.removeAttribute(REGION_CODE_ATTRIBUTE);
  root.removeAttribute('aria-hidden');
  root.removeAttribute('tabindex');
  root.removeAttribute('contenteditable');

  let geographicLabel;
  if (display.country !== null) {
    const country = createCountryElement(container.ownerDocument, display.country, resolveFlagAssetUrl, postHeader);

    geographicLabel = display.country.ariaLabel;
    root.setAttribute('aria-label', geographicLabel);
    root.setAttribute('title', display.country.title);
    root.appendChild(country);
  } else {
    const statusLabels = { hidden: 'Location: Hidden', missing: 'Location: Not provided',
      unavailable: 'Location: Unavailable', unknown: 'Location: Unknown' };
    const semanticLabel = postHeader && statusLabels[display.status]
      ? statusLabels[display.status] : display.region.ariaLabel;
    geographicLabel = semanticLabel;
    root.setAttribute('aria-label', semanticLabel);
    root.setAttribute('title', postHeader ? semanticLabel : display.region.title);
    const region = postHeader && display.region.code === null
      ? { ...display.region, label: semanticLabel, title: semanticLabel }
      : display.region;
    root.appendChild(createRegionElement(container.ownerDocument, region, postHeader));
  }
  if (postHeader && options?.details) {
    const details = options.details;
    const segments = [];
    if (details.locationAccuracy === 'vpn-proxy-detected') {
      segments.push({ className: VPN_PROXY_CLASS, text: 'VPN/proxy detected' });
    }
    segments.push({ className: CONNECTION_CLASS, text: details.connection.label });
    for (const segment of segments) {
      const group = container.ownerDocument.createElement('span');
      group.setAttribute('class', `${SEGMENT_CLASS} ${segment.className}`);
      group.setAttribute('aria-hidden', 'true');
      const separator = container.ownerDocument.createElement('span');
      separator.setAttribute('class', LOCATION_BADGE_CLASSES.separator);
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = '|';
      const text = container.ownerDocument.createElement('span');
      text.textContent = segment.text;
      group.appendChild(separator); group.appendChild(text); root.appendChild(group);
    }
    const semantic = [geographicLabel];
    if (details.locationAccuracy === 'vpn-proxy-detected') semantic.push('VPN or proxy detected');
    semantic.push(details.connection.label);
    root.setAttribute('aria-label', `${semantic.join('. ')}.`);
    if (details.connection.rawSource !== null) {
      root.setAttribute('title', `Reported account source: ${details.connection.rawSource}`);
    }
  }
  return root;
}

export function removeLocationBadge(container) {
  validateContainer(container);
  const owned = ownedChildren(container);
  for (const root of owned) container.removeChild(root);
  return owned.length;
}
