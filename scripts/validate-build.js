import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const browsers = ['chrome', 'firefox'];
const expectedName = 'X Region Reveal & Block';
const expectedVersion = '0.0.1';
const expectedJavaScriptEntries = [
  'background/service-worker.js',
  'content/content-script.js',
  'page/page-script.js',
  'popup/popup.js',
  'options/options.js',
];

async function requireFile(root, relativePath) {
  const filePath = path.join(root, relativePath);
  await access(filePath);
  return filePath;
}

function backgroundFiles(manifest) {
  if (manifest.background.service_worker) {
    return [manifest.background.service_worker];
  }
  return manifest.background.scripts;
}

function optionsPage(manifest) {
  return manifest.options_page ?? manifest.options_ui.page;
}

function localAssets(html) {
  return [...html.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => match[1]);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function validateHtml(root, relativePath) {
  const filePath = await requireFile(root, relativePath);
  const html = await readFile(filePath, 'utf8');
  const assets = localAssets(html);

  for (const asset of assets) {
    assert(!/^(?:[a-z]+:)?\/\//i.test(asset), `${relativePath} references remote asset ${asset}`);
    await requireFile(path.dirname(filePath), asset);
  }

  assert(assets.some((asset) => asset.endsWith('.js')), `${relativePath} must reference JavaScript`);
  assert(assets.some((asset) => asset.endsWith('.css')), `${relativePath} must reference CSS`);
}

async function validateBrowser(browser) {
  const root = path.join('dist', browser);
  const manifestPath = await requireFile(root, 'manifest.json');
  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);

  assert(manifest.manifest_version === 3, `${browser} manifest must use Manifest V3`);
  assert(manifest.name === expectedName, `${browser} manifest has an unexpected name`);
  assert(manifest.version === expectedVersion, `${browser} manifest has an unexpected version`);
  assert(JSON.stringify(manifest.permissions) === JSON.stringify(['storage']),
    `${browser} manifest must request only the storage permission`);
  assert(!/(?:community.?cache|cloud|https?:\/\/(?!x\.com|twitter\.com))/i.test(manifestText),
    `${browser} manifest contains a prohibited endpoint`);

  for (const file of expectedJavaScriptEntries) {
    await requireFile(root, file);
  }

  for (const file of backgroundFiles(manifest)) {
    await requireFile(root, file);
  }
  for (const contentScript of manifest.content_scripts) {
    for (const file of contentScript.js) {
      await requireFile(root, file);
    }
  }

  const popup = manifest.action.default_popup;
  const options = optionsPage(manifest);
  await validateHtml(root, popup);
  await validateHtml(root, options);
}

await Promise.all(browsers.map(validateBrowser));
console.log('Validated generated Chrome and Firefox extensions.');
