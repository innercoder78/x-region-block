export const X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION = 1;
export const X_ABOUT_ACCOUNT_REQUEST_EVENT_TYPE = 'x-region-block:about-account:request';
export const X_ABOUT_ACCOUNT_CANCEL_EVENT_TYPE = 'x-region-block:about-account:cancel';
export const X_ABOUT_ACCOUNT_RESPONSE_EVENT_TYPE = 'x-region-block:about-account:response';
export const X_ABOUT_ACCOUNT_COMMAND_LIMIT = 256;
export const X_ABOUT_ACCOUNT_RESPONSE_LIMIT = 262_144;
export const X_ABOUT_ACCOUNT_RETRY_LIMIT = 300_000;
export const X_ABOUT_ACCOUNT_METADATA_REVISION_LIMIT = 2_147_483_647;

const ID = /^[A-Za-z0-9_-]{16,64}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const CODES = new Set(['ABORTED', 'PAGE_BRIDGE_UNAVAILABLE', 'NO_METADATA', 'METADATA_SYNC', 'NETWORK',
  'HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_429', 'HTTP_5XX',
  'INVALID_RESPONSE', 'INVALID_PAYLOAD', 'BRIDGE_TIMEOUT', 'UNKNOWN']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length
  && Reflect.ownKeys(value).every((key) => typeof key === 'string') && keys.every((key) => own(value, key));
const validStatus = (value) => value === null
  || (Number.isInteger(value) && value >= 100 && value <= 599);
const validRetry = (value) => value === null
  || (Number.isInteger(value) && value >= 0 && value <= X_ABOUT_ACCOUNT_RETRY_LIMIT);
const validRequestRevision = (value) => Number.isInteger(value)
  && value >= 1 && value <= X_ABOUT_ACCOUNT_METADATA_REVISION_LIMIT;
const validResponseRevision = (value) => value === null || validRequestRevision(value);
const canonicalParse = (input, limit) => {
  if (typeof input !== 'string' || input.length === 0 || input.length > limit) return null;
  try {
    const value = JSON.parse(input);
    return JSON.stringify(value) === input ? value : null;
  } catch { return null; }
};
const validateJsonValue = (value, ancestors = new Set(), depth = 0) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError(); return; }
  if (typeof value !== 'object' || depth > 32 || ancestors.has(value)) throw new TypeError();
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError();
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw new TypeError();
  if (array && (keys.length !== value.length + 1
    || keys.some((key) => key !== 'length' && !/^(?:0|[1-9]\d*)$/.test(key)))) throw new TypeError();
  ancestors.add(value);
  for (const key of keys) {
    if (key === 'length' && array) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !own(descriptor, 'value') || (!array && descriptor.enumerable !== true)) throw new TypeError();
    validateJsonValue(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
};

export function validOpaqueRequestId(value) { return typeof value === 'string' && ID.test(value); }
export function validCanonicalHandle(value) { return typeof value === 'string' && HANDLE.test(value); }
export function serializeAboutAccountRequest(id, handle, metadataRevision) {
  if (!validOpaqueRequestId(id) || !validCanonicalHandle(handle) || !validRequestRevision(metadataRevision)) {
    throw new TypeError('Invalid request');
  }
  return JSON.stringify({ version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id, handle, metadataRevision });
}
export function parseAboutAccountRequestDetail(input) {
  const value = canonicalParse(input, X_ABOUT_ACCOUNT_COMMAND_LIMIT);
  return exact(value, ['version', 'id', 'handle', 'metadataRevision'])
    && value.version === X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION
    && validOpaqueRequestId(value.id) && validCanonicalHandle(value.handle)
    && validRequestRevision(value.metadataRevision)
    ? { version: value.version, id: value.id, handle: value.handle,
      metadataRevision: value.metadataRevision } : null;
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
  if (value?.ok === true) {
    try { validateJsonValue(value.payload); } catch { throw new TypeError('Invalid response'); }
  }
  const canonical = value?.ok === true
    ? { version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id: value.id, ok: true, payload: value.payload }
    : { version: X_ABOUT_ACCOUNT_REQUEST_PROTOCOL_VERSION, id: value?.id, ok: false,
      code: value?.code, status: value?.status, retryAfterMs: value?.retryAfterMs,
      metadataRevision: value?.metadataRevision ?? null };
  if (!validOpaqueRequestId(canonical.id) || typeof canonical.ok !== 'boolean'
    || (!canonical.ok && (!CODES.has(canonical.code) || !validStatus(canonical.status)
      || !validRetry(canonical.retryAfterMs) || !validResponseRevision(canonical.metadataRevision)))) {
    throw new TypeError('Invalid response');
  }
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
  return exact(value, ['version', 'id', 'ok', 'code', 'status', 'retryAfterMs', 'metadataRevision'])
    && CODES.has(value.code) && validStatus(value.status) && validRetry(value.retryAfterMs)
    && validResponseRevision(value.metadataRevision)
    ? { version: value.version, id: value.id, ok: false, code: value.code,
      status: value.status, retryAfterMs: value.retryAfterMs,
      metadataRevision: value.metadataRevision } : null;
}
