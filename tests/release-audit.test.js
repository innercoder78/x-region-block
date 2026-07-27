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
  await writeFile(packagePath, JSON.stringify({
    extensionName: 'X Region Reveal & Block',
    version: '0.0.1',
  }));
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
        : { options_ui: { page: 'options/options.html', open_in_tab: true } }),
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

  it('accepts legitimate X and Twitter JavaScript endpoint literals', async () => {
    const context = await fixture();
    await writeFile(path.join(context.distRoot, 'chrome/content/content-script.js'),
      'const endpoints = ["https://x.com/path", "https://twitter.com/path"];');
    await expect(auditRelease(context)).resolves.toBeUndefined();
  });

  it('rejects missing package extensionName', async () => {
    const context = await fixture();
    await writeFile(context.packagePath, JSON.stringify({ version: '0.0.1' }));
    await expect(auditRelease(context)).rejects.toThrow(/extensionName/);
  });

  it.each([
    ['manifest name differs', (manifest) => { manifest.name = 'Synthetic mismatch'; }, /names disagree/],
    ['manifest version differs', (manifest) => { manifest.version = '0.0.2'; }, /versions disagree/],
  ])('rejects when browser %s from the other browser', async (label, mutate, error) => {
    const context = await fixture();
    await editManifest(context, 'firefox', mutate);
    await expect(auditRelease(context)).rejects.toThrow(error);
  });

  it.each([
    ['manifest name', (manifest) => { manifest.name = 'Wrong name'; }, /chrome manifest name/],
    ['manifest version', (manifest) => { manifest.version = '0.0.2'; }, /chrome manifest version/],
  ])('rejects a %s mismatch with package metadata', async (label, mutate, error) => {
    const context = await fixture();
    await editManifest(context, 'chrome', mutate);
    await editManifest(context, 'firefox', mutate);
    await expect(auditRelease(context)).rejects.toThrow(error);
  });

  it('rejects a missing generated asset', async () => {
    const context = await fixture();
    await rm(path.join(context.distRoot, 'chrome/page/page-script.js'));
    await expect(auditRelease(context)).rejects.toThrow(/missing generated asset/);
  });

  it.each([
    ['unexpected permission', (manifest) => manifest.permissions.push('tabs')],
    ['unexpected host permission', (manifest) => { manifest.host_permissions = ['https://example.com/*']; }],
    ['unexpected optional permission', (manifest) => { manifest.optional_permissions = ['tabs']; }],
    ['unexpected match pattern', (manifest) => manifest.content_scripts[0].matches.push('https://example.com/*')],
    ['unexpected web-accessible resource', (manifest) => manifest.web_accessible_resources[0].resources.push('private.js')],
  ])('rejects an %s', async (message, mutate) => {
    const context = await fixture();
    await editManifest(context, 'chrome', mutate);
    await expect(auditRelease(context)).rejects.toThrow(message);
  });

  it.each([
    ['background entry', (manifest) => { manifest.background.service_worker = 'background/extra.js'; }],
    ['content CSS entry', (manifest) => manifest.content_scripts[0].css.push('content/extra.css')],
    ['popup entry', (manifest) => { manifest.action.default_popup = 'popup/other.html'; }],
    ['options entry', (manifest) => { manifest.options_page = 'options/other.html'; }],
  ])('rejects a changed or extra %s', async (message, mutate) => {
    const context = await fixture();
    await editManifest(context, 'chrome', mutate);
    await expect(auditRelease(context)).rejects.toThrow(message);
  });

  it.each([
    ['unexpected remote destination', 'popup/popup.html', '<script src="https://example.com/a.js"></script>'],
    ['embedded bearer token', 'content/content-script.js', 'const value = "Bearer abcdefghijklmnop";'],
    ['unexpected remote destination', 'content/content-script.js', 'const value = "https://example.com/api";'],
    ['source-map reference', 'content/content-script.js', '//# sourceMappingURL=bundle.js.map'],
    ['unexpected remote destination', 'content/content-script.js', 'const value = "https://api.x.com/collect";'],
    ['unexpected remote destination', 'content/content-script.js', 'const value = "http://x.com/path";'],
    ['scheme-relative remote destination', 'content/content-script.js', 'const value = "//example.com/collect";'],
    ['scheme-relative remote destination', 'content/account-actions.css', 'body { background: url(//example.com/image.png); }'],
    ['unexpected remote destination', 'popup/popup.html', '<form action="https://example.com/submit"></form>'],
    ['remote HTML asset', 'popup/popup.html', '<script src="https://x.com/remote.js"></script>'],
    ['remote CSS asset', 'content/account-actions.css', 'body { background-image: url("https://twitter.com/remote.png"); }'],
    ['embedded request token', 'content/content-script.js', 'const h = { "x-csrf-token": "synthetic-token-value" };'],
    ['fixed GraphQL query ID', 'content/content-script.js', 'const p = "/graphql/SYNTHETIC123/AboutAccountQuery";'],
    ['captured feature or field-toggle snapshot', 'content/content-script.js', 'const p = { "features": { enabled: true } };'],
    ['captured feature or field-toggle snapshot', 'content/content-script.js', 'const p = { features: { enabled: true } };'],
    ['captured feature or field-toggle snapshot', 'content/content-script.js', 'const p = { fieldToggles: { enabled: true } };'],
    ['prohibited persistence API', 'content/content-script.js', 'localStorage.setItem("synthetic", "value");'],
    ['prohibited runtime messaging API', 'content/content-script.js', 'browser.runtime.sendMessage({ synthetic: true });'],
    ['prohibited polling or communication API', 'content/content-script.js', 'setInterval(() => {}, 1000);'],
    ['prohibited polling or communication API', 'content/content-script.js', 'new XMLHttpRequest();'],
    ['prohibited polling or communication API', 'content/content-script.js', 'new window.XMLHttpRequest();'],
    ['prohibited polling or communication API', 'content/content-script.js', 'new globalThis.XMLHttpRequest();'],
    ['prohibited polling or communication API', 'content/content-script.js', 'XMLHttpRequest();'],
    ['prohibited polling or communication API', 'content/content-script.js', 'Reflect.construct(XMLHttpRequest, []);'],
    ['prohibited polling or communication API', 'content/content-script.js', 'Reflect.construct(window.XMLHttpRequest, []);'],
  ])('rejects a %s', async (message, relative, contents) => {
    const context = await fixture();
    await writeFile(path.join(context.distRoot, 'firefox', relative), contents);
    await expect(auditRelease(context)).rejects.toThrow(message);
  });

  it('allows ordinary feature-name references without embedded snapshots', async () => {
    const context = await fixture();
    await writeFile(path.join(context.distRoot, 'firefox/content/content-script.js'),
      'const names = ["features", "fieldToggles"]; const features = readFeatures();');
    await expect(auditRelease(context)).resolves.toBeUndefined();
  });

  it('rejects an empty required production bundle', async () => {
    const context = await fixture();
    await writeFile(path.join(context.distRoot, 'chrome/page/page-script.js'), '');
    await expect(auditRelease(context)).rejects.toThrow(/is empty/);
  });

  it('rejects invalid generated manifest JSON', async () => {
    const context = await fixture();
    await writeFile(path.join(context.distRoot, 'firefox/manifest.json'), '{ invalid');
    await expect(auditRelease(context)).rejects.toThrow(/not valid JSON/);
  });
});
