import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  syncCodeDownloadBuilds, verifyCodeDownloadBuilds,
} from '../scripts/code-download-builds.js';
import { expectedFiles } from '../scripts/release-packages.js';

const roots = [];

async function fixture() {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'code-download-'));
  roots.push(repositoryRoot);
  const distRoot = path.join(repositoryRoot, 'dist');
  const packagePath = path.join(repositoryRoot, 'package.json');
  await writeFile(packagePath, JSON.stringify({ version: '0.0.1' }));
  for (const browser of ['chrome', 'firefox']) {
    for (const relative of expectedFiles) {
      const filename = path.join(distRoot, browser, relative);
      await mkdir(path.dirname(filename), { recursive: true });
      const contents = relative.startsWith('assets/flags/')
        ? await readFile(path.join('src', relative)) : relative === 'manifest.json' ? JSON.stringify({
        manifest_version: 3,
        version: '0.0.1',
        background: browser === 'chrome'
          ? { service_worker: 'background/service-worker.js' }
          : { scripts: ['background/service-worker.js'] },
      }) : `${browser}:${relative}\n`;
      await writeFile(filename, contents);
    }
  }
  return { repositoryRoot, distRoot, packagePath, audit: false };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {
  recursive: true, force: true,
}))));

describe('Code Download committed browser builds', () => {
  it('synchronizes and verifies every Chrome root and Firefox file byte-for-byte', async () => {
    const context = await fixture();
    await syncCodeDownloadBuilds(context);
    await expect(verifyCodeDownloadBuilds(context)).resolves.toBeUndefined();
    expect(await readFile(path.join(context.repositoryRoot, 'manifest.json')))
      .toEqual(await readFile(path.join(context.distRoot, 'chrome/manifest.json')));
    expect(await readFile(path.join(context.repositoryRoot, 'firefox/manifest.json')))
      .toEqual(await readFile(path.join(context.distRoot, 'firefox/manifest.json')));
  });

  it('rejects stale, missing, and unexpected committed output', async () => {
    const context = await fixture();
    await syncCodeDownloadBuilds(context);
    await writeFile(path.join(context.repositoryRoot, 'popup/popup.js'), 'stale');
    await expect(verifyCodeDownloadBuilds(context)).rejects.toThrow(/not synchronized/);
    await rm(path.join(context.repositoryRoot, 'popup/popup.js'));
    await expect(verifyCodeDownloadBuilds(context)).rejects.toThrow(/missing or unexpected/);
    await writeFile(path.join(context.repositoryRoot, 'popup/unexpected.js'), 'unexpected');
    await expect(verifyCodeDownloadBuilds(context)).rejects.toThrow(/missing or unexpected/);
  });

  it('rejects swapped browser manifests, source maps, and symbolic paths', async () => {
    const context = await fixture();
    await syncCodeDownloadBuilds(context);
    await writeFile(path.join(context.repositoryRoot, 'manifest.json'),
      await readFile(path.join(context.distRoot, 'firefox/manifest.json')));
    await expect(verifyCodeDownloadBuilds(context)).rejects.toThrow(/not synchronized|wrong browser/);
    await syncCodeDownloadBuilds(context);
    await writeFile(path.join(context.repositoryRoot, 'popup/popup.js.map'), '{}');
    await expect(verifyCodeDownloadBuilds(context)).rejects.toThrow(/missing or unexpected|source map/);
    await rm(path.join(context.repositoryRoot, 'popup/popup.js.map'));
    await rm(path.join(context.repositoryRoot, 'popup/popup.js'));
    await symlink(path.join(context.distRoot, 'chrome/popup/popup.js'),
      path.join(context.repositoryRoot, 'popup/popup.js'));
    await expect(verifyCodeDownloadBuilds(context)).rejects.toThrow(/symbolic paths/);
  });

  it('rejects unexpected generated files and browser version inconsistencies', async () => {
    const context = await fixture();
    await writeFile(path.join(context.distRoot, 'chrome/content/content-script.js.map'), '{}');
    await expect(syncCodeDownloadBuilds(context)).rejects.toThrow(/missing or unexpected|source map/);
    await rm(path.join(context.distRoot, 'chrome/content/content-script.js.map'));
    const firefoxManifest = path.join(context.distRoot, 'firefox/manifest.json');
    const manifest = JSON.parse(await readFile(firefoxManifest, 'utf8'));
    manifest.version = '0.0.2';
    await writeFile(firefoxManifest, JSON.stringify(manifest));
    await expect(syncCodeDownloadBuilds(context)).rejects.toThrow(/version mismatch/);
  });
});
