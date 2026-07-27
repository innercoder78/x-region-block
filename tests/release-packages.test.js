import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expectedFiles, packageRelease, verifyPackages } from '../scripts/release-packages.js';

const roots = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-package-'));
  roots.push(root);
  const distRoot = path.join(root, 'dist');
  const artifactRoot = path.join(root, 'artifacts');
  const packagePath = path.join(root, 'package.json');
  await writeFile(packagePath, JSON.stringify({
    name: 'x-region-block', extensionName: 'X Region Reveal & Block', version: '0.0.1',
  }));
  for (const browser of ['chrome', 'firefox']) {
    for (const relative of expectedFiles) {
      const filename = path.join(distRoot, browser, relative);
      await mkdir(path.dirname(filename), { recursive: true });
      let contents = 'const fixture = true;';
      if (relative.endsWith('.css')) contents = 'body {}';
      if (relative.endsWith('.html')) contents = '<!doctype html><p>fixture</p>';
      if (relative === 'manifest.json') contents = JSON.stringify({
        manifest_version: 3,
        name: 'X Region Reveal & Block',
        version: '0.0.1',
        permissions: ['storage'],
        background: browser === 'chrome'
          ? { service_worker: 'background/service-worker.js' }
          : { scripts: ['background/service-worker.js'] },
      });
      await writeFile(filename, contents);
    }
  }
  return { root, distRoot, artifactRoot, packagePath, audit: false };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {
  recursive: true, force: true,
}))));

describe('release packages', () => {
  it('creates and verifies exactly the named root-layout archives and checksums', async () => {
    const context = await fixture();
    const result = await packageRelease(context);
    expect(result.names).toEqual({
      chrome: 'x-region-block-chrome-0.0.1.zip',
      firefox: 'x-region-block-firefox-0.0.1.zip',
    });
    await expect(verifyPackages(context)).resolves.toBeUndefined();
    expect((await readFile(path.join(context.artifactRoot, 'SHA256SUMS.txt'), 'utf8'))
      .trim().split('\n')).toHaveLength(2);
  });

  it('is byte-for-byte deterministic for identical fixture directories', async () => {
    const context = await fixture();
    await packageRelease(context);
    const first = await Promise.all(['chrome', 'firefox'].map((browser) => readFile(path.join(
      context.artifactRoot, `x-region-block-${browser}-0.0.1.zip`,
    ))));
    const firstSums = await readFile(path.join(context.artifactRoot, 'SHA256SUMS.txt'));
    await packageRelease(context);
    const second = await Promise.all(['chrome', 'firefox'].map((browser) => readFile(path.join(
      context.artifactRoot, `x-region-block-${browser}-0.0.1.zip`,
    ))));
    expect(second).toEqual(first);
    expect(await readFile(path.join(context.artifactRoot, 'SHA256SUMS.txt'))).toEqual(firstSums);
  });

  it('fails clearly for a missing build', async () => {
    const context = await fixture();
    await rm(path.join(context.distRoot, 'firefox'), { recursive: true });
    await expect(packageRelease(context)).rejects.toThrow(/missing build directory.*firefox/);
  });

  it('fails for malformed manifests and unexpected generated files', async () => {
    const context = await fixture();
    await writeFile(path.join(context.distRoot, 'chrome/manifest.json'), '{broken');
    await expect(packageRelease(context)).rejects.toThrow();
    context.audit = false;
    await writeFile(path.join(context.distRoot, 'chrome/manifest.json'), '{}');
    await writeFile(path.join(context.distRoot, 'chrome/secret.env'), 'secret');
    await expect(packageRelease(context)).rejects.toThrow(/unexpected or missing generated files/);
  });

  it('rejects tampered checksums', async () => {
    const context = await fixture();
    await packageRelease(context);
    await writeFile(path.join(context.artifactRoot, 'SHA256SUMS.txt'), `${'0'.repeat(64)}  wrong.zip\n`);
    await expect(verifyPackages(context)).rejects.toThrow(/checksum does not match/);
  });

  it('rejects prohibited content before it can be accepted as a package', async () => {
    const context = await fixture();
    await writeFile(path.join(context.distRoot, 'firefox/content/content-script.js'),
      'const remote = "https://example.com/tracker.js";');
    await packageRelease(context);
    await expect(verifyPackages(context)).rejects.toThrow(/unexpected remote assets/);
  });

  it.each([
    'new self.XMLHttpRequest();',
    "new window['XMLHttpRequest']();",
    "new globalThis['XMLHttpRequest']();",
    "Reflect.construct(self['XMLHttpRequest'], []);",
  ])('rejects packaged XHR construction bypass: %s', async (source) => {
    const context = await fixture();
    await writeFile(path.join(context.distRoot, 'firefox/content/content-script.js'), source);
    await packageRelease(context);
    await expect(verifyPackages(context)).rejects.toThrow(/prohibited APIs/);
  });
});
