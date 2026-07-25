import { readXAccountIdentityFromLink } from './account-link-reader.js';
import { ACCOUNT_IDENTITY_SOURCES } from '../shared/account-identity.js';

export const ACCOUNT_TARGET_DISCOVERY_VERSION = 1;

export const X_ACCOUNT_DISCOVERY_SELECTORS = Object.freeze({
  surfaces: Object.freeze({
    profile: '[data-testid="UserName"]',
    timeline: 'article[data-testid="tweet"]',
    reply: 'article[data-testid="tweet"]',
    search: '[data-testid="UserCell"]',
    notification: '[data-testid="UserCell"]',
  }),
  nameContainer: '[data-testid="User-Name"], [data-testid="UserName"]',
  accountLink: 'a[href]',
});

const hasOwn = (value, property) => Object.prototype.hasOwnProperty.call(value, property);

function validateRoot(root) {
  if (root === null || typeof root !== 'object' || Array.isArray(root)
    || typeof root.querySelectorAll !== 'function') {
    throw new TypeError('Invalid account discovery root');
  }
}

function normalizeOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('account discovery options must be a plain object');
  }
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('account discovery options must be a plain object');
  }
  if (hasOwn(options, 'accountId')) {
    throw new TypeError('accountId is not supported by account discovery');
  }
  if (!hasOwn(options, 'source') || typeof options.source !== 'string') {
    throw new TypeError('Invalid account discovery source');
  }
  const source = options.source.trim().toLowerCase();
  if (!ACCOUNT_IDENTITY_SOURCES.includes(source)) {
    throw new TypeError('Invalid account discovery source');
  }
  return { source, hasBaseUrl: hasOwn(options, 'baseUrl'), baseUrl: options.baseUrl };
}

function attribute(element, name) {
  return element !== null && typeof element === 'object'
    && typeof element.getAttribute === 'function' ? element.getAttribute(name) : null;
}

function isSurfaceForSource(element, source) {
  const testId = attribute(element, 'data-testid');
  if (source === 'profile') return testId === 'UserName';
  if (source === 'search' || source === 'notification') return testId === 'UserCell';
  return typeof element?.tagName === 'string' && element.tagName.toLowerCase() === 'article'
    && testId === 'tweet';
}

function isNestedBoundary(element) {
  const testId = attribute(element, 'data-testid');
  return testId === 'UserCell'
    || (typeof element?.tagName === 'string' && element.tagName.toLowerCase() === 'article'
      && testId === 'tweet');
}

function isLocalContainer(container, surface) {
  let ancestor = container?.parentElement;
  while (ancestor && ancestor !== surface) {
    if (isNestedBoundary(ancestor)) return false;
    ancestor = ancestor.parentElement;
  }
  return ancestor === surface;
}

function isAnchorLike(link) {
  try {
    return link !== null && typeof link === 'object' && typeof link.tagName === 'string'
      && link.tagName.toLowerCase() === 'a' && link.ownerDocument !== null
      && typeof link.ownerDocument === 'object' && typeof link.getAttribute === 'function';
  } catch {
    return false;
  }
}

const AMBIGUOUS = Symbol('ambiguous account target');

function resolveContainer(container, normalized) {
  if (container === null || typeof container !== 'object'
    || typeof container.querySelectorAll !== 'function') return null;
  const links = container.querySelectorAll(X_ACCOUNT_DISCOVERY_SELECTORS.accountLink);
  if (links === null || typeof links?.[Symbol.iterator] !== 'function') return null;
  let selected = null;
  for (const link of links) {
    if (!isAnchorLike(link)) continue;
    const readerOptions = normalized.hasBaseUrl
      ? { source: normalized.source, baseUrl: normalized.baseUrl }
      : { source: normalized.source };
    const identity = readXAccountIdentityFromLink(link, readerOptions);
    if (identity === null) continue;
    if (selected !== null && selected.identity.allowlistKey !== identity.allowlistKey) {
      return AMBIGUOUS;
    }
    if (selected === null) selected = { link, identity };
  }
  return selected;
}

function resolveSurface(surface, normalized) {
  let containers;
  if (normalized.source === 'profile') containers = [surface];
  else {
    if (surface === null || typeof surface !== 'object'
      || typeof surface.querySelectorAll !== 'function') return null;
    const queried = surface.querySelectorAll(X_ACCOUNT_DISCOVERY_SELECTORS.nameContainer);
    if (queried === null || typeof queried?.[Symbol.iterator] !== 'function') return null;
    containers = [...queried].filter((container) => isLocalContainer(container, surface));
  }
  let selected = null;
  for (const badgeContainer of containers) {
    const resolved = resolveContainer(badgeContainer, normalized);
    if (resolved === AMBIGUOUS) return null;
    if (resolved === null) continue;
    if (selected !== null
      && selected.identity.allowlistKey !== resolved.identity.allowlistKey) return null;
    if (selected === null) selected = { badgeContainer, ...resolved };
  }
  return selected;
}

/** Discovers account presentation targets in one explicitly supplied static root. */
export function discoverXAccountPresentationTargets(root, options) {
  validateRoot(root);
  const normalized = normalizeOptions(options);
  const queried = root.querySelectorAll(X_ACCOUNT_DISCOVERY_SELECTORS.surfaces[normalized.source]);
  if (queried === null || typeof queried?.[Symbol.iterator] !== 'function') {
    throw new TypeError('Invalid account discovery root');
  }
  const surfaces = [];
  const seenSurfaces = new Set();
  const addSurface = (surface) => {
    if (!seenSurfaces.has(surface)) {
      seenSurfaces.add(surface);
      surfaces.push(surface);
    }
  };
  if (isSurfaceForSource(root, normalized.source)) addSurface(root);
  for (const surface of queried) addSurface(surface);

  const targets = [];
  for (const accountContainer of surfaces) {
    if (!isSurfaceForSource(accountContainer, normalized.source)) continue;
    const resolved = resolveSurface(accountContainer, normalized);
    if (resolved === null) continue;
    targets.push(Object.freeze({
      version: ACCOUNT_TARGET_DISCOVERY_VERSION,
      source: normalized.source,
      accountContainer,
      link: resolved.link,
      badgeContainer: resolved.badgeContainer,
      identity: resolved.identity,
    }));
  }
  return Object.freeze(targets);
}
