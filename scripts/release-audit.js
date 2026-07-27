import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID, X_ABOUT_ACCOUNT_OPERATION_NAME } from '../src/shared/x-about-account-query.js';

const browsers = ['chrome', 'firefox'];
const matches = ['https://x.com/*', 'https://twitter.com/*'];
const bundles = [
  'background/service-worker.js',
  'content/content-script.js',
  'page/page-script.js',
  'popup/popup.js',
  'options/options.js',
];
const fixedGraphqlId = new RegExp(`/graphql/(?!${X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID}/${X_ABOUT_ACCOUNT_OPERATION_NAME})[A-Za-z0-9_-]{8,}/[A-Za-z0-9_-]+`, 'i');
const sensitiveMaterial = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i, 'embedded bearer token'],
  [/["'](?:x-csrf-token|x-guest-token|x-client-transaction-id)["']\s*:\s*["'][^"']{8,}/i,
    'embedded request token'],
  [fixedGraphqlId, 'fixed GraphQL query ID'],
  [/(?:["'](?:features|fieldToggles)["']|\b(?:features|fieldToggles)\b)\s*:\s*\{[^}]+\}/i,
    'captured feature or field-toggle snapshot'],
];
const prohibitedApis = [
  [/\b(?:localStorage|sessionStorage|indexedDB)\b/, 'prohibited persistence API'],
  [/\b(?:runtime|tabs)\.(?:sendMessage|connect)\s*\(/, 'prohibited runtime messaging API'],
  [/\b(?:setInterval|WebSocket|EventSource)\s*\(|new\s+XMLHttpRequest\s*\(/,
    'prohibited polling or communication API'],
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
    ...manifest.content_scripts.flatMap((item) => [...item.js, ...item.css]),
    ...manifest.web_accessible_resources.flatMap((item) => item.resources),
    manifest.action?.default_popup,
    manifest.options_page,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ].filter(Boolean);
}

function assertAllowedRemoteDestinations(relative, text) {
  const absoluteUrls = [...text.matchAll(/https?:\/\/[^\s"'`<>\\)]+/gi)]
    .map((match) => match[0]);
  for (const value of absoluteUrls) {
    let url;
    try {
      url = new URL(value.replace(/\*$/, ''));
    } catch {
      throw new Error(`${relative} contains malformed remote destination`);
    }
    invariant(url.protocol === 'https:' && ['https://x.com', 'https://twitter.com'].includes(url.origin),
      `${relative} contains unexpected remote destination`);
  }

  const quotedSchemeRelative = [...text.matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
    .some((match) => /^\/\/[^/\s]/.test(match[2].trim()));
  const cssSchemeRelative = /(?:url\(\s*["']?\/\/|@import\s+(?:url\()?\s*["']?\/\/)/i;
  invariant(!quotedSchemeRelative && !cssSchemeRelative.test(text),
    `${relative} contains scheme-relative remote destination`);
}

function assertNoRemoteHtmlAssets(relative, text) {
  const loadingAttribute = /\b(?:src|href|action|poster|srcset|data|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of text.matchAll(loadingAttribute)) {
    const value = match[1] ?? match[2] ?? match[3];
    invariant(!/(?:https?:)?\/\//i.test(value),
      `${relative} contains a remote HTML asset`);
  }
}

function assertNoRemoteCssAssets(relative, text) {
  const remoteCssAsset = /(?:url\(\s*["']?|@import\s+(?:url\(\s*)?["']?)(?:https?:)?\/\//i;
  invariant(!remoteCssAsset.test(text), `${relative} contains a remote CSS asset`);
}

function auditJavaScript(relative, text) {
  invariant(!/sourceMappingURL=/i.test(text), `${relative} contains a source-map reference`);
  for (const [pattern, description] of sensitiveMaterial) {
    invariant(!pattern.test(text), `${relative} contains ${description}`);
  }
  for (const [pattern, description] of prohibitedApis) {
    invariant(!pattern.test(text), `${relative} contains ${description}`);
  }
}

async function readGeneratedManifest(distRoot, browser) {
  const root = path.join(distRoot, browser);
  try {
    await access(root);
  } catch {
    throw new Error(`missing ${browser} build directory`);
  }
  try {
    return {
      manifest: JSON.parse(await readFile(await requiredFile(root, 'manifest.json'), 'utf8')),
      root,
    };
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${browser} manifest is not valid JSON`);
    throw error;
  }
}

function assertManifestContract(browser, manifest, packageJson) {
  invariant(manifest.name === packageJson.extensionName,
    `${browser} manifest name differs from package extensionName`);
  invariant(manifest.version === packageJson.version,
    `${browser} manifest version differs from package version`);
  invariant(manifest.manifest_version === 3, `${browser} manifest must use Manifest V3`);
  invariant(JSON.stringify(manifest.permissions) === JSON.stringify(['storage']),
    `${browser} manifest has unexpected permission`);
  invariant(manifest.optional_permissions === undefined,
    `${browser} manifest has unexpected optional permission`);
  invariant(manifest.host_permissions === undefined && manifest.optional_host_permissions === undefined,
    `${browser} manifest has unexpected host permission`);
  invariant(manifest.content_scripts?.length === 1, `${browser} must have exactly one content script`);
  const content = manifest.content_scripts[0];
  invariant(JSON.stringify(content.matches) === JSON.stringify(matches),
    `${browser} manifest has unexpected match pattern`);
  invariant(content.run_at === 'document_start', `${browser} content script must run at document_start`);
  invariant(JSON.stringify(content.js) === JSON.stringify(['content/content-script.js']),
    `${browser} manifest has an unexpected content JavaScript entry`);
  invariant(JSON.stringify(content.css) === JSON.stringify(['content/account-actions.css']),
    `${browser} manifest has an unexpected content CSS entry`);
  invariant(!content.js.includes('page/page-script.js'),
    `${browser} page script must not run as an isolated content script`);
  invariant(manifest.web_accessible_resources?.length === 1
    && JSON.stringify(manifest.web_accessible_resources[0].resources) === JSON.stringify(['page/page-script.js'])
    && JSON.stringify(manifest.web_accessible_resources[0].matches) === JSON.stringify(matches),
  `${browser} manifest has unexpected web-accessible resource`);
  invariant(manifest.action?.default_popup === 'popup/popup.html',
    `${browser} manifest has an unexpected popup entry`);
  if (browser === 'chrome') {
    invariant(manifest.background?.service_worker === 'background/service-worker.js'
      && manifest.background.scripts === undefined,
    'chrome manifest has an unexpected background entry');
    invariant(manifest.options_page === 'options/options.html' && manifest.options_ui === undefined,
      'chrome manifest has an unexpected options entry');
  } else {
    invariant(JSON.stringify(manifest.background?.scripts) === JSON.stringify(['background/service-worker.js'])
      && manifest.background.service_worker === undefined,
    'firefox manifest has an unexpected background entry');
    invariant(manifest.options_page === undefined
      && manifest.options_ui?.page === 'options/options.html'
      && manifest.options_ui.open_in_tab === true,
    'firefox manifest has an unexpected options entry');
  }
}

async function auditBrowser(browser, root, manifest, packageJson) {
  assertManifestContract(browser, manifest, packageJson);
  await Promise.all(manifestAssets(manifest).map((asset) => requiredFile(root, asset)));
  for (const bundle of bundles) {
    const filename = await requiredFile(root, bundle);
    invariant((await stat(filename)).size > 0, `${browser}/${bundle} is empty`);
  }
  for (const filename of await walk(root)) {
    if (!/\.(?:js|html|css|json)$/i.test(filename)) continue;
    const relative = path.relative(root, filename);
    const text = await readFile(filename, 'utf8');
    assertAllowedRemoteDestinations(relative, text);
    if (/\.html$/i.test(filename)) assertNoRemoteHtmlAssets(relative, text);
    if (/\.css$/i.test(filename)) assertNoRemoteCssAssets(relative, text);
    if (/\.js$/i.test(filename)) auditJavaScript(relative, text);
  }
}

export async function auditRelease({ distRoot = 'dist', packagePath = 'package.json' } = {}) {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  invariant(typeof packageJson.extensionName === 'string' && packageJson.extensionName.trim() !== '',
    'package extensionName must be a nonempty string');
  invariant(typeof packageJson.version === 'string' && /^\d+(?:\.\d+){0,3}$/.test(packageJson.version),
    'package version must be a valid nonempty extension version');
  const generated = [];
  for (const browser of browsers) generated.push(await readGeneratedManifest(distRoot, browser));
  invariant(generated[0].manifest.name === generated[1].manifest.name,
    'generated Chrome and Firefox manifest names disagree');
  invariant(generated[0].manifest.version === generated[1].manifest.version,
    'generated Chrome and Firefox manifest versions disagree');
  for (let index = 0; index < browsers.length; index += 1) {
    await auditBrowser(browsers[index], generated[index].root, generated[index].manifest, packageJson);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await auditRelease();
  console.log('Release audit passed for generated Chrome and Firefox extensions.');
}
