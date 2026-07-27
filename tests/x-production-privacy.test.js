import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const productionFiles = [
  'src/shared/x-page-runtime-event.js',
  'src/page/x-page-runtime.js',
  'src/page/page-script.js',
  'src/content/x-page-script-injector.js',
  'src/content/x-production-runtime.js',
  'src/content/content-script.js',
];
const prohibited = [
  'document.cookie', 'localStorage', 'sessionStorage', 'indexedDB', 'CacheStorage',
  'browser.storage', 'chrome.storage', 'runtime.sendMessage', 'window.postMessage',
  'BroadcastChannel', 'MessageChannel', 'WebSocket', 'XMLHttpRequest', 'sendBeacon',
  'setTimeout', 'setInterval', 'requestAnimationFrame', 'webRequest',
  'declarativeNetRequest', 'console.log', 'console.debug',
];

describe('production source privacy boundaries', () => {
  it('uses none of the prohibited communication, persistence, polling, or logging APIs', async () => {
    const source = (await Promise.all(productionFiles.map((file) => readFile(file, 'utf8')))).join('\n');
    for (const term of prohibited) expect(source, term).not.toContain(term);
  });

  it('does not embed request metadata or write it into DOM state', async () => {
    const source = (await Promise.all(productionFiles.map((file) => readFile(file, 'utf8')))).join('\n');
    expect(source).not.toMatch(/Bearer\s+[A-Za-z0-9._~-]+/i);
    expect(source).not.toMatch(/(?:query|transaction)[-_ ]?id\s*[:=]\s*['"][^'"]+/i);
    expect(source).not.toMatch(/(?:csrf|guest)[-_ ]?token\s*[:=]\s*['"][^'"]+/i);
    expect(source).not.toMatch(/(?:dataset|setAttribute|createTextNode|textContent|innerHTML)\s*[.(]/);
  });

  it('does not retain stopped production components in a strong collection', async () => {
    const source = await readFile('src/content/x-production-runtime.js', 'utf8');
    expect(source).not.toMatch(/\bstopped\s*:\s*new Set\s*\(/);
    for (const field of [
      'bridge', 'injector', 'settingsCandidate', 'settingsRuntime',
      'routeCandidate', 'routeController',
    ]) {
      expect(source).toContain(`state[key] = null`);
      expect(source).toContain(`stopComponent(state, '${field}'`);
    }
    expect(source).toContain('state.metadataListener = null');
    expect(source).toContain('state.pagehideListener = null');
    expect(source).toContain('state.resolve = null; state.reject = null');
  });
});
