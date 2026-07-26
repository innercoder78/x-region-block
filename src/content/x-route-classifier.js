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

function parseSegments(value) {
  const trimmed = value.trim();
  // URL repairs malformed slash and backslash spellings, so reject them first.
  if (!/^https:\/\/[A-Za-z0-9]/i.test(trimmed) || trimmed.includes('\\')) return null;
  const authority = trimmed.slice(trimmed.indexOf('//') + 2).split(/[/?#]/, 1)[0];
  if (authority.includes(':') || authority.includes('@')) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !supportedHostnames.has(url.hostname.toLowerCase())
    || url.username !== '' || url.password !== '' || url.port !== '') return null;

  const encoded = url.pathname.split('/').slice(1);
  if (encoded.at(-1) === '') encoded.pop();
  if (encoded.some((segment) => segment === '')) return null;
  try {
    const segments = encoded.map((segment) => decodeURIComponent(segment));
    return segments.some((segment) => segment.includes('/') || segment.includes('\\'))
      ? null : segments;
  } catch {
    return null;
  }
}

function canonicalHandle(segment) {
  if (reservedSegments.has(segment.toLowerCase())) return null;
  try {
    const handle = normalizeXHandle(segment);
    return handle === segment.trim().replace(/^@/, '').toLowerCase() ? handle : null;
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
