import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const browsers = ['chrome', 'firefox'];
const expectedMatches = ['https://x.com/*', 'https://twitter.com/*'];

async function readManifest(browser) {
  return JSON.parse(await readFile(`manifests/${browser}.json`, 'utf8'));
}

describe.each(browsers)('%s manifest', (browser) => {
  it('contains the expected foundation metadata', async () => {
    const manifest = await readManifest(browser);

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe('0.0.1');
    expect(manifest.name).toBe('X Region Reveal & Block');
  });

  it('limits page access to X and Twitter', async () => {
    const manifest = await readManifest(browser);
    const matches = manifest.content_scripts.flatMap((script) => script.matches);

    expect(matches).toEqual(expectedMatches);
    expect(manifest.host_permissions).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toMatch(/cloud|cache/i);
  });

  it('requests no extension permissions', async () => {
    const manifest = await readManifest(browser);

    expect(manifest.permissions).toBeUndefined();
    expect(manifest.optional_permissions).toBeUndefined();
  });
});
