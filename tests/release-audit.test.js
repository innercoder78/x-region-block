import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditRelease } from '../scripts/release-audit.js';

const temporaryDirectories = [];
const expectedMatches = ['https://x.com/*', 'https://twitter.com/*'];
const required = [
  'background/service-worker.js', 'content/content-script.js', 'page/page-script.js',
  'popup/popup.js', 'options/options.js', 'content/account-actions.css',
];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-audit-'));
  temporaryDirectories.push(root);
  const distRoot = path.join(root, 'dist');
  const packagePath = path.join(root, 'package.json');
  await writeFile(packagePath, JSON.stringify({ version: '0.0.1' }));
  for (const browser of ['chrome', 'firefox']) {
    const directory = path.join(distRoot, browser);
    const manifest = {
      manifest_version: 3,
      name: 'X Region Reveal & Block',
      version: '0.0.1',
      permissions: ['storage'],
      background: browser === 'chrome'
        ? { service_worker: required[0] }
        : { scripts: [required[0]] },
      content_scripts: [{
        matches: expectedMatches,
        js: [required[1]],
        css: [required[5]],
        run_at: 'document_start',
      }],
      web_accessible_resources: [{ resources: [required[2]], matches: expectedMatches }],
      action: { default_popup: 'popup/popup.html' },
      ...(browser === 'chrome'
        ? { options_page: 'options/options.html' }
        : { options_ui: { page: 'options/options.html' } }),
    };
    for (const relative of [...required, 'popup/popup.html', 'options/options.html']) {
      const filename = path.join(directory, relative);
      await mkdir(path.dirname(filename), { recursive: true });
      const contents = relative.endsWith('.html')
        ? '<link href="popup.css"><script src="popup.js"></script>'
        : 'const releaseFixture = true;';
      await writeFile(filename, contents);
    }
    await writeFile(path.join(directory, 'popup/popup.css'), 'body{}');
    await writeFile(path.join(directory, 'options/options.css'), 'body{}');
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  }
  return { distRoot, packagePath };
}

async function editManifest(context, browser, mutate) {
  const filename = path.join(context.distRoot, browser, 'manifest.json');
  const manifest = JSON.parse(await readFile(filename, 'utf8'));
  mutate(manifest);
  await writeFile(filename, JSON.stringify(manifest));
}

afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((root) => rm(root, {
  recursive: true,
  force: true,
}))));

describe('release audit', () => {
  it('accepts complete synthetic Chrome and Firefox builds', async () => {
    await expect(auditRelease(await fixture())).resolves.toBeUndefined();
  });

  it('rejects a missing generated asset', async () => {
    const context = await fixture();
    await rm(path.join(context.distRoot, 'chrome/page/page-script.js'));
    await expect(auditRelease(context)).rejects.toThrow(/missing generated asset/);
  });

  it.each([
    ['unexpected permission', (manifest) => manifest.permissions.push('tabs')],
    ['unexpected host permission', (manifest) => { manifest.host_permissions = ['https://example.com/*']; }],
    ['unexpected match pattern', (manifest) => manifest.content_scripts[0].matches.push('https://example.com/*')],
    ['unexpected web-accessible resource', (manifest) => manifest.web_accessible_resources[0].resources.push('private.js')],
  ])('rejects an %s', async (message, mutate) => {
    const context = await fixture();
    await editManifest(context, 'chrome', mutate);
    await expect(auditRelease(context)).rejects.toThrow(message);
  });

  it.each([
    ['remote asset', 'popup/popup.html', '<script src="https://example.com/a.js"></script>'],
    ['embedded bearer token', 'content/content-script.js', 'const value = "Bearer abcdefghijklmnop";'],
    ['unexpected external endpoint', 'content/content-script.js', 'const value = "https://example.com/api";'],
    ['source-map reference', 'content/content-script.js', '//# sourceMappingURL=bundle.js.map'],
  ])('rejects a %s', async (message, relative, contents) => {
    const context = await fixture();
    await writeFile(path.join(context.distRoot, 'firefox', relative), contents);
    await expect(auditRelease(context)).rejects.toThrow(message);
  });
});
