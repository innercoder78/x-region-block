import { SUPPORTED_HOSTNAMES } from '../shared/constants.js';
import {
  normalizeXHandle,
  RESERVED_X_ROUTE_SEGMENTS,
} from '../shared/account-identity.js';

export const X_ROUTE_CLASSIFIER_VERSION = 1;

const supportedHostnames = new Set(SUPPORTED_HOSTNAMES);
const reservedSegments = new Set(RESERVED_X_ROUTE_SEGMENTS);
const profileSections = new Map([
  ['with_replies', 'replies'],
  ['media', 'media'],
  ['likes', 'likes'],
  ['highlights', 'highlights'],
  ['articles', 'articles'],
]);

function descriptor(type, handle = null, profileSection = null, statusId = null) {
  return Object.freeze({
    version: X_ROUTE_CLASSIFIER_VERSION,
    type,
    handle,
    profileSection,
    statusId,
  });
}

const UNSUPPORTED = descriptor('unsupported');
const hasAsciiControl = (value) => [...value].some((character) => {
  const code = character.charCodeAt(0);
  return code <= 31 || code === 127;
});

function parseSegments(value) {
  if (hasAsciiControl(value)) return null;
  const trimmed = value.trim();
  // URL repairs malformed slash and backslash spellings, so reject them first.
  if (!/^https:\/\/[A-Za-z0-9]/i.test(trimmed) || trimmed.includes('\\')) return null;
  const afterScheme = trimmed.slice(trimmed.indexOf('//') + 2);
  const authorityEnd = afterScheme.search(/[/?#]/);
  const authority = authorityEnd < 0 ? afterScheme : afterScheme.slice(0, authorityEnd);
  if (authority.includes(':') || authority.includes('@')) return null;

  let rawPathname = '/';
  if (authorityEnd >= 0 && afterScheme[authorityEnd] === '/') {
    const pathAndSuffix = afterScheme.slice(authorityEnd);
    const suffixStart = pathAndSuffix.search(/[?#]/);
    rawPathname = suffixStart < 0 ? pathAndSuffix : pathAndSuffix.slice(0, suffixStart);
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !supportedHostnames.has(url.hostname.toLowerCase())
    || url.username !== '' || url.password !== '' || url.port !== '') return null;

  const encoded = rawPathname.split('/').slice(1);
  if (encoded.at(-1) === '') encoded.pop();
  if (encoded.some((segment) => segment === '')) return null;
  try {
    const segments = encoded.map((segment) => decodeURIComponent(segment));
    return segments.some((segment) => segment === '.' || segment === '..'
      || segment.includes('/') || segment.includes('\\')
      || hasAsciiControl(segment))
      ? null : segments;
  } catch {
    return null;
  }
}

function canonicalHandle(segment) {
  try {
    const handle = normalizeXHandle(segment);
    return segment.toLowerCase() === handle && !reservedSegments.has(handle) ? handle : null;
  } catch {
    return null;
  }
}

/** Classifies one explicitly supplied absolute X or Twitter URL. */
export function classifyXRoute(value) {
  if (typeof value !== 'string') throw new TypeError('X route URL must be a string');
  const segments = parseSegments(value);
  if (segments === null) return UNSUPPORTED;
  const lower = segments.map((segment) => segment.toLowerCase());

  if (segments.length === 0 || (segments.length === 1 && lower[0] === 'home')) {
    return descriptor('home');
  }
  if ((segments.length === 1 && lower[0] === 'explore')
    || (segments.length === 3 && lower[0] === 'explore'
      && lower[1] === 'tabs' && segments[2] !== '')) return descriptor('explore');
  if (segments.length === 1 && lower[0] === 'search') return descriptor('search');
  if ((segments.length === 1 && lower[0] === 'notifications')
    || (segments.length === 2 && lower[0] === 'notifications'
      && lower[1] === 'mentions')) return descriptor('notifications');

  const handle = segments.length > 0 ? canonicalHandle(segments[0]) : null;
  if (handle === null) return UNSUPPORTED;
  if (segments.length === 1) return descriptor('profile', handle, 'posts');
  if (segments.length === 2 && profileSections.has(lower[1])) {
    return descriptor('profile', handle, profileSections.get(lower[1]));
  }
  if ((segments.length === 3 || segments.length === 5) && lower[1] === 'status'
    && /^\d+$/.test(segments[2])) {
    if (segments.length === 5
      && (!['photo', 'video'].includes(lower[3]) || !/^[1-9]\d*$/.test(segments[4]))) {
      return UNSUPPORTED;
    }
    return descriptor('status', handle, null, segments[2]);
  }
  return UNSUPPORTED;
}
