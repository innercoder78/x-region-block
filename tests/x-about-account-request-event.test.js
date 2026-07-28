import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  X_ABOUT_ACCOUNT_COMMAND_LIMIT, parseAboutAccountCancelDetail,
  parseAboutAccountRequestDetail, parseAboutAccountResponseDetail,
  serializeAboutAccountCancel, serializeAboutAccountRequest, serializeAboutAccountResponse,
} from '../src/shared/x-about-account-request-event.js';

const id = 'opaque_request_0001';

describe('string-only About Account event protocol', () => {
  it('serializes every cross-world detail and reconstructs local objects', () => {
    const foreign = vm.runInNewContext(`JSON.stringify({version:1,id:"${id}",handle:"OpenAI",metadataRevision:1})`);
    const request = parseAboutAccountRequestDetail(foreign);
    expect(typeof serializeAboutAccountRequest(id, 'OpenAI', 1)).toBe('string');
    expect(typeof serializeAboutAccountCancel(id)).toBe('string');
    expect(typeof serializeAboutAccountResponse({ id, ok: true, payload: { value: 1 } })).toBe('string');
    expect(request).toEqual({ version: 1, id, handle: 'OpenAI', metadataRevision: 1 });
    expect(Object.getPrototypeOf(request)).toBe(Object.prototype);
  });

  it('rejects non-strings, malformed, noncanonical, duplicate, unknown, and oversized commands', () => {
    const valid = serializeAboutAccountRequest(id, 'OpenAI', 1);
    const hostile = new Proxy({}, { get() { throw new Error('hostile'); } });
    for (const value of [null, {}, hostile, '', '{', `${valid} `,
      `{"version":1,"version":1,"id":"${id}","handle":"OpenAI"}`,
      `{"version":1,"id":"${id}","handle":"OpenAI","url":"https://x.com"}`,
      'x'.repeat(X_ABOUT_ACCOUNT_COMMAND_LIMIT + 1)]) {
      expect(() => parseAboutAccountRequestDetail(value)).not.toThrow();
      expect(parseAboutAccountRequestDetail(value)).toBeNull();
    }
  });

  it('requires exact bounded cancel and response schemas', () => {
    expect(parseAboutAccountCancelDetail(serializeAboutAccountCancel(id))).toEqual({ version: 1, id });
    expect(parseAboutAccountResponseDetail(serializeAboutAccountResponse({
      id, ok: false, code: 'HTTP_429', status: 429, retryAfterMs: 60_000,
    }))).toMatchObject({ id, code: 'HTTP_429', status: 429, retryAfterMs: 60_000 });
    for (const input of [{}, '[]', `{"version":1,"id":"${id}","ok":false,"code":"BAD","status":99,"retryAfterMs":-1}`]) {
      expect(parseAboutAccountCancelDetail(input)).toBeNull();
      expect(parseAboutAccountResponseDetail(input)).toBeNull();
    }
  });

  it('rejects successful payloads that JSON would omit or silently alter', () => {
    const cyclic = {}; cyclic.self = cyclic;
    for (const payload of [undefined, () => {}, Symbol('value'), cyclic,
      { omitted: undefined }, { callable: () => {} }, { symbolic: Symbol('value') }]) {
      expect(() => serializeAboutAccountResponse({ id, ok: true, payload })).toThrow('Invalid response');
    }
  });
});
