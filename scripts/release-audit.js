import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const browsers = ['chrome', 'firefox'];
const matches = ['https://x.com/*', 'https://twitter.com/*'];
const bundles = [
  'background/service-worker.js',
  'content/content-script.js',
  'page/page-script.js',
  'popup/popup.js',
  'options/options.js',
];
const remoteReference = /(?:src|href|action|poster)\s*=\s*["'](?:https?:)?\/\//i;
const sensitiveMaterial = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i, 'embedded bearer token'],
  [/["'](?:x-csrf-token|x-guest-token|x-client-transaction-id)["']\s*:\s*["'][^"']{8,}/i,
    'embedded request token'],
  [/\/graphql\/[A-Za-z0-9_-]{8,}\/UserByScreenName/i, 'fixed GraphQL query ID'],
  [/["'](?:features|fieldToggles)["']\s*:\s*["']?\{[^}]+\}/i,
    'captured feature or field-toggle snapshot'],
];
const prohibitedApis = [
  [/\b(?:localStorage|sessionStorage|indexedDB)\b/, 'prohibited persistence API'],
  [/\b(?:runtime|tabs)\.(?:sendMessage|connect)\s*\(/, 'prohibited cross-context messaging API'],
  [/\b(?:setInterval|WebSocket|EventSource|XMLHttpRequest)\s*\(/, 'prohibited polling or communication API'],
];

function invariant(value, message) {
  if (!value) throw new Error(message);
}

async function requiredFile(root, relative) {
  const filename = path.join(root, relative);
  try {
    invariant((await stat(filename)).isFile(), `${relative} is not a file`);
  } catch (error) {
    if (error.message === `${relative} is not a file`) throw error;
    throw new Error(`missing generated asset: ${relative}`);
  }
  return filename;
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const filename = path.join(root, entry.name);
    return entry.isDirectory() ? walk(filename) : [filename];
  }));
  return nested.flat();
}

function manifestAssets(manifest) {
  return [
    manifest.background?.service_worker,
    ...(manifest.background?.scripts ?? []),
    ...manifest.content_scripts.flatMap((item) => [...(item.js ?? []), ...(item.css ?? [])]),
    ...manifest.web_accessible_resources.flatMap((item) => item.resources ?? []),
    manifest.action?.default_popup,
    manifest.options_page,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ].filter(Boolean);
}

function findUrls(text) {
  return [...text.matchAll(/https?:\/\/[^\s"'`<>\\)]+/gi)].map((match) => match[0]);
}

function auditText(relative, text) {
  invariant(!/\/(?:\/|\*)# sourceMappingURL=|sourceMappingURL=/i.test(text),
    `${relative} contains a source-map reference`);
  for (const [pattern, description] of sensitiveMaterial) {
    invariant(!pattern.test(text), `${relative} contains ${description}`);
  }
  for (const [pattern, description] of prohibitedApis) {
    invariant(!pattern.test(text), `${relative} contains ${description}`);
  }
  for (const url of findUrls(text)) {
    invariant(/^https:\/\/(?:api\.)?(?:x|twitter)\.com(?:\/|$)/i.test(url),
      `${relative} contains unexpected external endpoint`);
  }
}

async function auditBrowser(distRoot, browser, metadata) {
  const root = path.join(distRoot, browser);
  try {
    await access(root);
  } catch {
    throw new Error(`missing ${browser} build directory`);
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(await requiredFile(root, 'manifest.json'), 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${browser} manifest is not valid JSON`);
    throw error;
  }
  invariant(manifest.name === metadata.name, `${browser} manifest name differs from package metadata`);
  invariant(manifest.version === metadata.version, `${browser} manifest version differs from package metadata`);
  invariant(manifest.manifest_version === 3, `${browser} manifest must use Manifest V3`);
  invariant(JSON.stringify(manifest.permissions) === JSON.stringify(['storage']),
    `${browser} manifest has unexpected permission`);
  invariant(manifest.host_permissions === undefined && manifest.optional_host_permissions === undefined,
    `${browser} manifest has unexpected host permission`);
  invariant(manifest.content_scripts?.length === 1, `${browser} must have exactly one content script`);
  const content = manifest.content_scripts[0];
  invariant(JSON.stringify(content.matches) === JSON.stringify(matches),
    `${browser} manifest has unexpected match pattern`);
  invariant(content.run_at === 'document_start', `${browser} content script must run at document_start`);
  invariant(JSON.stringify(content.js) === JSON.stringify(['content/content-script.js']),
    `${browser} manifest has an unexpected isolated-world script`);
  invariant(manifest.web_accessible_resources?.length === 1
    && JSON.stringify(manifest.web_accessible_resources[0].resources) === JSON.stringify(['page/page-script.js'])
    && JSON.stringify(manifest.web_accessible_resources[0].matches) === JSON.stringify(matches),
  `${browser} manifest has unexpected web-accessible resource`);

  await Promise.all(manifestAssets(manifest).map((asset) => requiredFile(root, asset)));
  for (const bundle of bundles) {
    const filename = await requiredFile(root, bundle);
    invariant((await stat(filename)).size > 0, `${browser}/${bundle} is empty`);
  }
  const files = await walk(root);
  for (const filename of files) {
    const relative = path.relative(root, filename);
    if (!/\.(?:js|html|css|json)$/i.test(filename)) continue;
    const text = await readFile(filename, 'utf8');
    if (/\.html$/i.test(filename)) {
      invariant(!remoteReference.test(text) && !/url\(\s*["']?(?:https?:)?\/\//i.test(text),
        `${relative} references a remote asset`);
    }
    if (/\.js$/i.test(filename)) auditText(relative, text);
    for (const url of findUrls(text)) {
      invariant(/^https:\/\/(?:api\.)?(?:x|twitter)\.com(?:\/|\*|$)/i.test(url),
        `${relative} contains unexpected external endpoint`);
    }
  }
  return manifest;
}

export async function auditRelease({ distRoot = 'dist', packagePath = 'package.json' } = {}) {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  const metadata = { name: 'X Region Reveal & Block', version: packageJson.version };
  const manifests = [];
  for (const browser of browsers) manifests.push(await auditBrowser(distRoot, browser, metadata));
  invariant(manifests[0].name === manifests[1].name && manifests[0].version === manifests[1].version,
    'generated manifest names and versions must match');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await auditRelease();
  console.log('Release audit passed for generated Chrome and Firefox extensions.');
}
