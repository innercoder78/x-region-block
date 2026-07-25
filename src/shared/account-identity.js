const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const DECIMAL_ID_PATTERN = /^\d+$/;
const SUPPORTED_HOSTS = new Set(['x.com', 'twitter.com']);

/** Safe, non-sensitive contexts in which a future caller may observe an account. */
export const ACCOUNT_IDENTITY_SOURCES = Object.freeze([
  'profile',
  'timeline',
  'reply',
  'search',
  'notification',
]);

const accountIdentitySources = new Set(ACCOUNT_IDENTITY_SOURCES);

/**
 * Application paths which must never be interpreted as account handles.
 * The frozen array is the single documented definition; the private Set only
 * provides efficient, case-insensitive membership checks.
 */
export const RESERVED_X_ROUTE_SEGMENTS = Object.freeze([
  'home',
  'explore',
  'notifications',
  'messages',
  'i',
  'settings',
  'compose',
  'search',
  'hashtag',
  'intent',
  'share',
  'login',
  'logout',
  'signup',
  'tos',
  'privacy',
  'about',
  'download',
  'jobs',
]);

const reservedRoutes = new Set(RESERVED_X_ROUTE_SEGMENTS);

export function normalizeXHandle(value) {
  if (typeof value !== 'string') throw new TypeError('X handle must be a string');

  const trimmed = value.trim();
  const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (!HANDLE_PATTERN.test(handle)) throw new TypeError('Invalid X handle');
  return handle.toLowerCase();
}

function normalizeAccountId(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new TypeError('accountId must be a decimal string or null');
  const trimmed = value.trim();
  if (!DECIMAL_ID_PATTERN.test(trimmed)) throw new TypeError('Invalid accountId');
  return trimmed;
}

function normalizeSource(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new TypeError('source must be a string or null');
  const normalized = value.trim().toLowerCase();
  if (!accountIdentitySources.has(normalized)) throw new TypeError('Invalid account source');
  return normalized;
}

/** Creates a minimal value object and deliberately copies no unrelated input. */
export function createAccountIdentity(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Account identity input must be an object');
  }

  const handle = normalizeXHandle(input.handle);
  const displayHandle = `@${handle}`;
  return Object.freeze({
    handle,
    displayHandle,
    profileUrl: `https://x.com/${handle}`,
    accountId: normalizeAccountId(input.accountId),
    allowlistKey: displayHandle,
    source: normalizeSource(input.source),
  });
}

function isSafeSupportedUrl(url) {
  return (
    url.protocol === 'https:' &&
    SUPPORTED_HOSTS.has(url.hostname.toLowerCase()) &&
    url.username === '' &&
    url.password === '' &&
    url.port === ''
  );
}

function supportedBase(value) {
  if (typeof value !== 'string' && !(value instanceof URL)) return null;
  try {
    const url = new URL(value);
    return isSafeSupportedUrl(url) ? url : null;
  } catch {
    return null;
  }
}

function identityFromUrl(url, identityOptions) {
  if (!isSafeSupportedUrl(url)) return null;
  const encodedSegments = url.pathname.split('/').slice(1);
  const encodedSegment = encodedSegments[0];
  if (!encodedSegment) return null;

  let segments;
  try {
    // Decode every segment, even though only the first identifies the account,
    // so malformed encoding anywhere in the supplied path is rejected.
    segments = encodedSegments.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  const [segment] = segments;
  if (reservedRoutes.has(segment.toLowerCase())) return null;
  try {
    return createAccountIdentity({ ...identityOptions, handle: segment });
  } catch {
    return null;
  }
}

/**
 * Invalid direct handles are programmer input errors and throw. URL-like input
 * instead returns null when it is unsafe, unsupported, or not an account path.
 */
export function parseXAccountReference(value, options = {}) {
  if (typeof value !== 'string') throw new TypeError('Account reference must be a string');
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Account reference options must be an object');
  }

  const trimmed = value.trim();
  const identityOptions = { accountId: options.accountId, source: options.source };
  const relative = trimmed.startsWith('/') && !trimmed.startsWith('//');
  const looksLikeUrl = relative || trimmed.startsWith('//') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmed);

  if (!looksLikeUrl) return createAccountIdentity({ ...identityOptions, handle: trimmed });
  if (trimmed.startsWith('//')) return null;
  if (trimmed.includes('\\')) return null;

  // URL() repairs several malformed spellings. Accept only the documented
  // absolute syntax before asking it to parse and validate URL components.
  if (!relative && !/^https:\/\/[A-Za-z0-9]/i.test(trimmed)) return null;

  let url;
  try {
    if (relative) {
      const base = supportedBase(options.baseUrl);
      if (!base) return null;
      url = new URL(trimmed, base);
    } else {
      url = new URL(trimmed);
    }
  } catch {
    return null;
  }
  return identityFromUrl(url, identityOptions);
}
