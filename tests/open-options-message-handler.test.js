import { describe, expect, it, vi } from 'vitest';
import { OPEN_OPTIONS_MESSAGE, isOpenOptionsMessage } from '../src/shared/open-options-message.js';
import { registerOpenOptionsMessageHandler } from '../src/background/open-options-message-handler.js';

function runtimeFixture(kind, openOptionsPage) {
  let listener;
  const runtime = { id: 'extension-id', openOptionsPage,
    onMessage: { addListener: vi.fn((value) => { listener = value; }), removeListener: vi.fn() } };
  return { scope: { [kind]: { runtime } }, runtime, listener: () => listener };
}

describe('open Options message contract and background handler', () => {
  it('accepts only the exact privacy-minimal shape', () => {
    expect(isOpenOptionsMessage(OPEN_OPTIONS_MESSAGE)).toBe(true);
    expect(isOpenOptionsMessage({ ...OPEN_OPTIONS_MESSAGE, handle: '@private' })).toBe(false);
    expect(isOpenOptionsMessage({ type: OPEN_OPTIONS_MESSAGE.type })).toBe(false);
  });

  it('opens once with the browser Promise API and ignores malformed messages', async () => {
    const open = vi.fn(async () => undefined); const fixture = runtimeFixture('browser', open);
    registerOpenOptionsMessageHandler(fixture.scope);
    expect(fixture.listener()({ type: 'other', version: 1 }, { id: 'extension-id' })).toBeUndefined();
    expect(fixture.listener()(OPEN_OPTIONS_MESSAGE, { id: 'another-extension' })).toBeUndefined();
    await expect(fixture.listener()(OPEN_OPTIONS_MESSAGE, { id: 'extension-id' })).resolves.toEqual({ ok: true });
    expect(open).toHaveBeenCalledOnce();
  });

  it('supports Chrome callbacks and contains runtime.lastError', async () => {
    const open = vi.fn((callback) => callback()); const fixture = runtimeFixture('chrome', open);
    registerOpenOptionsMessageHandler(fixture.scope); const sendResponse = vi.fn();
    expect(fixture.listener()(OPEN_OPTIONS_MESSAGE, {}, sendResponse)).toBe(true);
    await Promise.resolve(); await Promise.resolve(); expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    fixture.runtime.lastError = { message: 'contained' };
    fixture.listener()(OPEN_OPTIONS_MESSAGE, {}, sendResponse); await Promise.resolve(); await Promise.resolve();
    expect(sendResponse).toHaveBeenLastCalledWith({ ok: false });
  });
});
