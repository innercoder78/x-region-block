import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const entryPoints = {
  'background/service-worker': 'src/background/service-worker.js',
  'content/content-script': 'src/content/content-script.js',
  'page/page-script': 'src/page/page-script.js',
  'popup/popup': 'src/popup/popup.js',
  'options/options': 'src/options/options.js',
};

export const browserOutputDirectories = {
  chrome: 'dist/chrome',
  firefox: 'dist/firefox',
};

const staticFiles = [
  ['src/content/account-actions.css', 'content/account-actions.css'],
  ['src/popup/popup.html', 'popup/popup.html'],
  ['src/popup/popup.css', 'popup/popup.css'],
  ['src/options/options.html', 'options/options.html'],
  ['src/options/options.css', 'options/options.css'],
];

function copyExtensionFiles(browser, outputDirectory) {
  return {
    name: 'copy-extension-files',
    async writeBundle() {
      const files = [
        [`manifests/${browser}.json`, 'manifest.json'],
        ...staticFiles,
      ];

      await Promise.all(files.map(async ([source, destination]) => {
        const outputPath = path.join(outputDirectory, destination);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await copyFile(source, outputPath);
      }));
    },
  };
}

const browser = process.env.BROWSER ?? 'chrome';

if (!Object.hasOwn(browserOutputDirectories, browser)) {
  throw new Error('Set BROWSER to either "chrome" or "firefox".');
}

const outputDirectory = browserOutputDirectories[browser];

export default Object.entries(entryPoints).map(([name, input], index, entries) => ({
  input,
  output: {
    file: path.join(outputDirectory, `${name}.js`),
    format: 'iife',
  },
  plugins: index === entries.length - 1
    ? [copyExtensionFiles(browser, outputDirectory)]
    : [],
}));
