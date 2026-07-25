import { describe, expect, it, vi } from 'vitest';

import { evaluateFilterSubject } from '../src/shared/filter-subject.js';
import { createSettingsRuntime } from '../src/shared/settings-runtime.js';
import { normalizeSettings } from '../src/shared/settings-schema.js';

const base = (location = {
  status: 'known', countryCode: 'CA', countryName: 'Canada',
}) => ({
  identity: { handle: 'Account_A', source: 'profile' }, location,
  languages: ['EN'], tags: ['News'],
});
const settings = (overrides = {}) => normalizeSettings({ schemaVersion: 1, ...overrides });

describe('filter subject evaluation', () => {
  it.each([
    ['allowlist over country hide', base(), { allowlist: ['@account_a'], country: { hide: ['CA'] } }, 'show'],
    ['allowlist over region hide', base(), { allowlist: ['@account_a'], region: { hide: ['NORTH_AMERICA'] } }, 'show'],
    ['allowlist over unknown hide', base({ status: 'unknown' }), { allowlist: ['@account_a'], other: { hide: ['unknown'] } }, 'show'],
    ['always-show over country and region hides', base(), { country: { alwaysShow: ['CA'], hide: ['CA'] }, region: { hide: ['NORTH_AMERICA'] } }, 'show'],
    ['country hide over highlight', base(), { country: { hide: ['CA'] }, tag: { highlight: ['news'] } }, 'hide'],
    ['region hide over highlight', base(), { region: { hide: ['NORTH_AMERICA'] }, language: { highlight: ['en'] } }, 'hide'],
    ['unknown hide over highlight', base({ status: 'unknown' }), { other: { hide: ['unknown'], highlight: ['unknown'] } }, 'hide'],
    ['country highlight', base(), { country: { highlight: ['CA'] } }, 'highlight'],
    ['region highlight', base(), { region: { highlight: ['NORTH_AMERICA'] } }, 'highlight'],
    ['language highlight', base(), { language: { highlight: ['en'] } }, 'highlight'],
    ['tag highlight', base(), { tag: { highlight: ['news'] } }, 'highlight'],
    ['unknown highlight', base({ status: 'unknown' }), { other: { highlight: ['unknown'] } }, 'highlight'],
    ['default', base(), {}, 'show'],
  ])('%s', (_name, subject, configured, action) => {
    expect(evaluateFilterSubject(subject, settings(configured)).action).toBe(action);
  });

  it('uses exact case-sensitive allowlist matching', () => {
    expect(evaluateFilterSubject(base(), settings({ allowlist: ['@ACCOUNT_A'], country: { hide: ['CA'] } })).action)
      .toBe('hide');
    expect(evaluateFilterSubject(base(), settings({ allowlist: ['@account_a'] })).action).toBe('show');
  });

  it.each(['hidden', 'missing', 'unavailable', 'unknown'])('targets only the distinct %s state', (status) => {
    const other = status === 'hidden' ? 'missing' : 'hidden';
    expect(evaluateFilterSubject(base({ status }), settings({ other: { hide: [status] } })).action).toBe('hide');
    expect(evaluateFilterSubject(base({ status }), settings({ other: { hide: [other] } })).action).toBe('show');
  });

  it('returns only a deeply immutable subject and action without mutating settings', () => {
    const canonical = settings({ tag: { highlight: ['news'] } });
    const before = structuredClone(canonical);
    const evaluation = evaluateFilterSubject(base(), canonical);
    expect(Object.keys(evaluation)).toEqual(['subject', 'action']);
    expect(Object.isFrozen(evaluation)).toBe(true);
    expect(Object.isFrozen(evaluation.subject)).toBe(true);
    expect(canonical).toEqual(before);
  });

  it('propagates malformed settings errors', () => {
    expect(() => evaluateFilterSubject(base(), { country: ['CA'] })).toThrow(TypeError);
  });

  it('accepts a settings runtime snapshot directly and is structurally repeatable', async () => {
    const canonical = settings({ language: { highlight: ['en'] } });
    const runtime = createSettingsRuntime({
      repository: { initializeSettings: vi.fn().mockResolvedValue(canonical) },
      changeAdapter: { subscribe: vi.fn(() => vi.fn()) }, onError: vi.fn(),
    });
    const snapshot = await runtime.start();
    const first = evaluateFilterSubject(base(), snapshot);
    const second = evaluateFilterSubject(structuredClone(base()), snapshot);
    expect(first).toEqual(second);
    expect(first.subject.languages).not.toBe(second.subject.languages);
    runtime.stop();
  });
});
