import { createLocationDisplayModel } from '../shared/location-display.js';

export const LOCATION_BADGE_RENDERER_VERSION = 1;
export const LOCATION_BADGE_ATTRIBUTE = 'data-x-region-block-location-badge';
export const LOCATION_BADGE_ATTRIBUTE_VALUE = '1';

export const LOCATION_BADGE_CLASSES = Object.freeze({
  root: 'x-region-block-location-badge',
  country: 'x-region-block-location-country',
  separator: 'x-region-block-location-separator',
  region: 'x-region-block-location-region',
});

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
  return ownedChildren(container)[0] ?? null;
}

function setCommonChildAttributes(element, className, title) {
  element.setAttribute('class', className);
  element.setAttribute('aria-hidden', 'true');
  if (title !== null) element.setAttribute('title', title);
}

function createRegionElement(ownerDocument, region) {
  const element = ownerDocument.createElement('span');
  setCommonChildAttributes(element, LOCATION_BADGE_CLASSES.region, region.title);
  if (region.code !== null) element.setAttribute(REGION_CODE_ATTRIBUTE, region.code);
  element.textContent = `${region.symbol} ${region.label}`;
  return element;
}

export function renderLocationBadge(container, location) {
  validateContainer(container);
  const display = createLocationDisplayModel(location);
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

  if (display.country !== null) {
    const country = container.ownerDocument.createElement('span');
    setCommonChildAttributes(country, LOCATION_BADGE_CLASSES.country, display.country.title);
    country.setAttribute(COUNTRY_CODE_ATTRIBUTE, display.country.code);
    country.textContent = display.country.symbol;

    const separator = container.ownerDocument.createElement('span');
    setCommonChildAttributes(separator, LOCATION_BADGE_CLASSES.separator, null);
    separator.textContent = ' ';

    root.setAttribute('aria-label', `${display.country.ariaLabel}; ${display.region.ariaLabel}`);
    root.setAttribute('title', `${display.country.title} · ${display.region.title}`);
    root.appendChild(country);
    root.appendChild(separator);
  } else {
    root.setAttribute('aria-label', display.region.ariaLabel);
    root.setAttribute('title', display.region.title);
  }

  root.appendChild(createRegionElement(container.ownerDocument, display.region));
  return root;
}

export function removeLocationBadge(container) {
  validateContainer(container);
  const owned = ownedChildren(container);
  for (const root of owned) container.removeChild(root);
  return owned.length;
}
