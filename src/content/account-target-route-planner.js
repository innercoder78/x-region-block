import {
  ACCOUNT_IDENTITY_SOURCES,
  normalizeXHandle,
  RESERVED_X_ROUTE_SEGMENTS,
} from '../shared/account-identity.js';

export const ACCOUNT_TARGET_ROUTE_PLANNER_VERSION = 1;

const ROUTE_KEYS = ['version', 'type', 'handle', 'profileSection', 'statusId'];
const PROFILE_SECTIONS = new Set([
  'posts', 'replies', 'media', 'likes', 'highlights', 'articles',
]);
const SOURCES = new Set(ACCOUNT_IDENTITY_SOURCES);
const RESERVED_HANDLES = new Set(RESERVED_X_ROUTE_SEGMENTS);
const EMPTY = Object.freeze([]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function validateRoot(root) {
  let valid = false;
  try {
    valid = root !== null && typeof root === 'object' && !Array.isArray(root)
      && typeof root.querySelectorAll === 'function';
  } catch { /* Invalid facade roots use the public validation error. */ }
  if (!valid) throw new TypeError('Invalid account target route planning root');
}

function validateRoute(route) {
  if (!isPlainObject(route)) throw new TypeError('Invalid X route descriptor');
  let keys;
  let values;
  try {
    keys = Reflect.ownKeys(route);
    if (keys.length !== ROUTE_KEYS.length || keys.some((key) => typeof key !== 'string')
      || ROUTE_KEYS.some((key) => !hasOwn(route, key))) throw new Error('invalid');
    values = ROUTE_KEYS.map((key) => route[key]);
  } catch {
    throw new TypeError('Invalid X route descriptor');
  }
  const [version, type, handle, profileSection, statusId] = values;
  if (version !== 1 || typeof type !== 'string') {
    throw new TypeError('Invalid X route descriptor');
  }
  const emptyFields = handle === null && profileSection === null && statusId === null;
  if (['home', 'explore', 'search', 'notifications', 'unsupported'].includes(type)) {
    if (!emptyFields) throw new TypeError('Invalid X route descriptor');
  } else {
    let canonical = false;
    try {
      canonical = normalizeXHandle(handle) === handle && !RESERVED_HANDLES.has(handle);
    } catch { /* invalid */ }
    if (!canonical) throw new TypeError('Invalid X route descriptor');
    if (type === 'profile') {
      if (!PROFILE_SECTIONS.has(profileSection) || statusId !== null) {
        throw new TypeError('Invalid X route descriptor');
      }
    } else if (type === 'status') {
      if (profileSection !== null || typeof statusId !== 'string' || !/^\d+$/.test(statusId)) {
        throw new TypeError('Invalid X route descriptor');
      }
    } else {
      throw new TypeError('Invalid X route descriptor');
    }
  }
  return { type, profileSection };
}

function normalizeOptions(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('account target route planner options must be a plain object');
  }
  try {
    const keys = Reflect.ownKeys(options);
    if (keys.length > 1 || keys.some((key) => key !== 'baseUrl')) throw new Error('invalid');
    if (!hasOwn(options, 'baseUrl')) return { hasBaseUrl: false };
    return { hasBaseUrl: true, baseUrl: options.baseUrl };
  } catch {
    throw new TypeError('Invalid account target route planner options');
  }
}

function sourcePolicy(type, profileSection) {
  if (type === 'home' || type === 'explore') return ['timeline'];
  if (type === 'profile') {
    return profileSection === 'replies' ? ['profile', 'reply'] : ['profile', 'timeline'];
  }
  if (type === 'status') return ['reply'];
  if (type === 'search') return ['search'];
  if (type === 'notifications') return ['notification'];
  return EMPTY;
}

/** Converts an explicit route and root into immutable session-group plans. */
export function createXAccountTargetSessionPlans(root, route, options = {}) {
  validateRoot(root);
  const canonicalRoute = validateRoute(route);
  const normalizedOptions = normalizeOptions(options);
  const sources = sourcePolicy(canonicalRoute.type, canonicalRoute.profileSection);
  if (sources === EMPTY) return EMPTY;
  return Object.freeze(sources.map((source) => {
    if (!SOURCES.has(source)) throw new TypeError('Invalid X route descriptor');
    const plan = { root, source };
    if (normalizedOptions.hasBaseUrl) plan.baseUrl = normalizedOptions.baseUrl;
    return Object.freeze(plan);
  }));
}
