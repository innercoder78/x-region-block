import { describe, expect, it, vi } from 'vitest';
import {
  X_ABOUT_ACCOUNT_REQUEST_CAPTURE_VERSION, installXAboutAccountRequestCapture,
} from '../src/page/x-about-account-request-capture.js';
import { X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE } from '../src/shared/x-about-account-request-metadata-event.js';
import { metadataFacades, observedHeaders, observedUrl } from './helpers/x-request-metadata-facade.js';

describe('X About Account request capture', () => {
  it('is versioned, idempotent, sanitizes metadata, and restores fetch', () => {
    const fetch = vi.fn(() => 'page-result');
    const { page, document } = metadataFacades(fetch);
    const details = [];
    document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE, (event) => details.push(event.detail));
    const controller = installXAboutAccountRequestCapture(page);
    expect(X_ABOUT_ACCOUNT_REQUEST_CAPTURE_VERSION).toBe(1);
    expect(Object.keys(controller)).toEqual(['stop', 'isActive', 'hasSnapshot']);
    expect(Object.isFrozen(controller)).toBe(true);
    expect(installXAboutAccountRequestCapture(page)).toBe(controller);
    const input = observedUrl();
    const init = { headers: observedHeaders };
    expect(page.fetch(input, init)).toBe('page-result');
    expect(fetch).toHaveBeenCalledWith(input, init);
    const snapshot = JSON.parse(details[0]);
    expect(Object.keys(snapshot)).toEqual([
      'version', 'origin', 'queryId', 'variables', 'features', 'fieldToggles', 'headers',
    ]);
    expect(details[0]).not.toContain('Observed');
    expect(snapshot.variables).not.toHaveProperty('screen_name');
    expect(snapshot.headers).not.toHaveProperty('cookie');
    page.fetch(input, init);
    expect(details).toHaveLength(1);
    controller.stop();
    expect(page.fetch).toBe(fetch);
    expect(controller.hasSnapshot()).toBe(false);
  });

  it('forwards malformed requests and exact original failures', () => {
    const failure = new Error('page failure');
    const fetch = vi.fn(() => { throw failure; });
    const { page } = metadataFacades(fetch);
    installXAboutAccountRequestCapture(page);
    expect(() => page.fetch('https://example.com/')).toThrow(failure);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
