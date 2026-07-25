import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  browserOutputDirectories,
  entryPoints,
} from '../rollup.config.js';

const expectedEntries = [
  'background/service-worker',
  'content/content-script',
  'page/page-script',
  'popup/popup',
  'options/options',
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : entryPath;
  }));
  return files.flat();
}

describe('build configuration', () => {
  it('defines existing required JavaScript entry points', async () => {
    expect(Object.keys(entryPoints)).toEqual(expectedEntries);
    await expect(
      Promise.all(Object.values(entryPoints).map((file) => access(file))),
    ).resolves.toBeDefined();
  });

  it('targets separate browser output directories', () => {
    expect(browserOutputDirectories).toEqual({
      chrome: 'dist/chrome',
      firefox: 'dist/firefox',
    });
  });

  it.each(['chrome', 'firefox'])('%s manifest references existing static pages', async (browser) => {
    const manifest = JSON.parse(await readFile(`manifests/${browser}.json`, 'utf8'));
    const popup = manifest.action.default_popup;
    const options = manifest.options_page ?? manifest.options_ui.page;

    await expect(access(path.join('src', popup))).resolves.toBeUndefined();
    await expect(access(path.join('src', options))).resolves.toBeUndefined();
    await expect(access(path.join('src', path.dirname(popup), 'popup.css'))).resolves.toBeUndefined();
    await expect(access(path.join('src', path.dirname(options), 'options.css'))).resolves.toBeUndefined();
  });

  it('contains no excluded implementation systems', async () => {
    const sourceFiles = (await walk('src')).filter((file) => file.endsWith('.js'));
    const source = (await Promise.all(sourceFiles.map((file) => readFile(file, 'utf8')))).join('\n');
    const excludedTerms = [
      ['tele', 'metry'].join(''),
      ['XMLHttp', 'Request'].join(''),
      ['local', 'Storage'].join(''),
      ['browser.storage', '.local'].join(''),
      ['ios', 'application'].join(''),
      ['community', 'cache'].join(''),
    ];

    for (const term of excludedTerms) {
      expect(source.toLowerCase()).not.toContain(term.toLowerCase());
    }
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});
