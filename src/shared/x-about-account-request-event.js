export const X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION = 1;
export const X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE = 'x-region-block:about-account:request';
export const X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE = 'x-region-block:about-account:cancel';
export const X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE = 'x-region-block:about-account:response';
export const X_ABOUT_ACCOUNT_RESPONSE_LIMIT = 262_144;

const ID = /^[A-Za-z0-9_-]{16,64}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const CODES = new Set(['ABORTED', 'PAGE_BRIDGE_UNAVAILABLE', 'NO_METADATA', 'NETWORK',
  'HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_429', 'HTTP_5XX',
  'INVALID_RESPONSE', 'INVALID_PAYLOAD', 'UNKNOWN']);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [null, Object.prototype].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

export function validOpaqueRequestId(value) { return typeof value === 'string' && ID.test(value); }
export function validCanonicalHandle(value) { return typeof value === 'string' && HANDLE.test(value); }
export function createAboutAccountRequestDetail(id, handle) {
  if (!validOpaqueRequestId(id) || !validCanonicalHandle(handle)) throw new TypeError('Invalid request');
  return Object.freeze({ version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id, handle });
}
export function parseAboutAccountRequestDetail(value) {
  return exact(value, ['version', 'id', 'handle'])
    && value.version === X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION
    && validOpaqueRequestId(value.id) && validCanonicalHandle(value.handle)
    ? { version: value.version, id: value.id, handle: value.handle } : null;
}
export function createAboutAccountCancelDetail(id) {
  if (!validOpaqueRequestId(id)) throw new TypeError('Invalid cancellation');
  return Object.freeze({ version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id });
}
export function parseAboutAccountCancelDetail(value) {
  return exact(value, ['version', 'id']) && value.version === X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION
    && validOpaqueRequestId(value.id) ? { version: value.version, id: value.id } : null;
}
export function parseAboutAccountResponseDetail(value) {
  if (!plain(value)) return null;
  let serialized;
  try { serialized = JSON.stringify(value); } catch { return null; }
  if (serialized.length > X_ABOUT_ACCOUNT_RESPONSE_LIMIT || !validOpaqueRequestId(value.id)
    || value.version !== X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION || typeof value.ok !== 'boolean') return null;
  if (value.ok) return exact(value, ['version', 'id', 'ok', 'payload'])
    ? { version: value.version, id: value.id, ok: true, payload: value.payload } : null;
  return exact(value, ['version', 'id', 'ok', 'code', 'status', 'retryAfterMs'])
    && CODES.has(value.code) && (value.status === null || Number.isInteger(value.status))
    && (value.retryAfterMs === null || (Number.isInteger(value.retryAfterMs) && value.retryAfterMs >= 0))
    ? { version: value.version, id: value.id, ok: false, code: value.code,
      status: value.status, retryAfterMs: value.retryAfterMs } : null;
}
