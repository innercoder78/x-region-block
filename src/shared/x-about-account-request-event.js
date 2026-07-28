export const X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION = 1;
export const X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE = 'x-region-block:about-account:request';
export const X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE = 'x-region-block:about-account:cancel';
export const X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE = 'x-region-block:about-account:response';
export const X_ABOUT_ACCOUNT_COMMAND_LIMIT = 256;
export const X_ABOUT_ACCOUNT_RESPONSE_LIMIT = 262_144;
export const X_ABOUT_ACCOUNT_RETRY_LIMIT = 300_000;

const ID = /^[A-Za-z0-9_-]{16,64}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const CODES = new Set(['ABORTED', 'PAGE_BRIDGE_UNAVAILABLE', 'NO_METADATA', 'NETWORK',
  'HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_429', 'HTTP_5XX',
  'INVALID_RESPONSE', 'INVALID_PAYLOAD', 'UNKNOWN']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length
  && Reflect.ownKeys(value).every((key) => typeof key === 'string') && keys.every((key) => own(value, key));
const validStatus = (value) => value === null
  || (Number.isInteger(value) && value >= 100 && value <= 599);
const validRetry = (value) => value === null
  || (Number.isInteger(value) && value >= 0 && value <= X_ABOUT_ACCOUNT_RETRY_LIMIT);
const canonicalParse = (input, limit) => {
  if (typeof input !== 'string' || input.length === 0 || input.length > limit) return null;
  try {
    const value = JSON.parse(input);
    return JSON.stringify(value) === input ? value : null;
  } catch { return null; }
};

export function validOpaqueRequestId(value) { return typeof value === 'string' && ID.test(value); }
export function validCanonicalHandle(value) { return typeof value === 'string' && HANDLE.test(value); }
export function serializeAboutAccountRequest(id, handle) {
  if (!validOpaqueRequestId(id) || !validCanonicalHandle(handle)) throw new TypeError('Invalid request');
  return JSON.stringify({ version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id, handle });
}
export function parseAboutAccountRequestDetail(input) {
  const value = canonicalParse(input, X_ABOUT_ACCOUNT_COMMAND_LIMIT);
  return exact(value, ['version', 'id', 'handle'])
    && value.version === X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION
    && validOpaqueRequestId(value.id) && validCanonicalHandle(value.handle)
    ? { version: value.version, id: value.id, handle: value.handle } : null;
}
export function serializeAboutAccountCancel(id) {
  if (!validOpaqueRequestId(id)) throw new TypeError('Invalid cancellation');
  return JSON.stringify({ version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id });
}
export function parseAboutAccountCancelDetail(input) {
  const value = canonicalParse(input, X_ABOUT_ACCOUNT_COMMAND_LIMIT);
  return exact(value, ['version', 'id']) && value.version === X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION
    && validOpaqueRequestId(value.id) ? { version: value.version, id: value.id } : null;
}
export function serializeAboutAccountResponse(value) {
  const canonical = value?.ok === true
    ? { version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id: value.id, ok: true, payload: value.payload }
    : { version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id: value?.id, ok: false,
      code: value?.code, status: value?.status, retryAfterMs: value?.retryAfterMs };
  if (!validOpaqueRequestId(canonical.id) || typeof canonical.ok !== 'boolean'
    || (!canonical.ok && (!CODES.has(canonical.code) || !validStatus(canonical.status)
      || !validRetry(canonical.retryAfterMs)))) throw new TypeError('Invalid response');
  let serialized;
  try { serialized = JSON.stringify(canonical); } catch { throw new TypeError('Invalid response'); }
  if (typeof serialized !== 'string' || serialized.length > X_ABOUT_ACCOUNT_RESPONSE_LIMIT) {
    throw new TypeError('Invalid response');
  }
  return serialized;
}
export function parseAboutAccountResponseDetail(input) {
  const value = canonicalParse(input, X_ABOUT_ACCOUNT_RESPONSE_LIMIT);
  if (!value || value.version !== X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION
    || !validOpaqueRequestId(value.id) || typeof value.ok !== 'boolean') return null;
  if (value.ok) return exact(value, ['version', 'id', 'ok', 'payload'])
    ? { version: value.version, id: value.id, ok: true, payload: value.payload } : null;
  return exact(value, ['version', 'id', 'ok', 'code', 'status', 'retryAfterMs'])
    && CODES.has(value.code) && validStatus(value.status) && validRetry(value.retryAfterMs)
    ? { version: value.version, id: value.id, ok: false, code: value.code,
      status: value.status, retryAfterMs: value.retryAfterMs } : null;
}
