import { copyFile, lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditRelease } from './release-audit.js';
import { expectedFiles } from './release-packages.js';

export const committedRoots = { chrome: '.', firefox: 'firefox' };

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function safeRelative(relative) {
  return relative === path.posix.normalize(relative)
    && !path.posix.isAbsolute(relative)
    && !relative.includes('\\')
    && !relative.split('/').includes('..');
}

async function exactFiles(root, label, rootChrome = false) {
  const files = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch {
      throw new Error(`missing ${label} extension directory: ${root}`);
    }
    for (const entry of entries) {
      if (rootChrome && directory === root
        && !['manifest.json', 'background', 'content', 'options', 'page', 'popup'].includes(entry.name)) {
        continue;
      }
      const filename = path.join(directory, entry.name);
      const relative = path.relative(root, filename).split(path.sep).join('/');
      invariant(safeRelative(relative), `unsafe generated path: ${relative}`);
      const info = await lstat(filename);
      invariant(!info.isSymbolicLink(), `symbolic paths are prohibited: ${relative}`);
      if (info.isDirectory()) await visit(filename);
      else if (info.isFile()) files.push(relative);
      else throw new Error(`unsupported generated path: ${relative}`);
    }
  }
  await visit(root);
  files.sort();
  invariant(JSON.stringify(files) === JSON.stringify(expectedFiles),
    `${label} has missing or unexpected generated files`);
  invariant(!files.some((file) => file.endsWith('.map')), `${label} contains a source map`);
  return files;
}

async function manifests(distRoot, packagePath) {
  let packageJson;
  try { packageJson = JSON.parse(await readFile(packagePath, 'utf8')); } catch {
    throw new Error('package metadata is malformed');
  }
  const result = {};
  for (const browser of ['chrome', 'firefox']) {
    try { result[browser] = JSON.parse(await readFile(path.join(distRoot, browser, 'manifest.json'), 'utf8')); } catch {
      throw new Error(`${browser} generated manifest is malformed`);
    }
    invariant(result[browser].version === packageJson.version, `${browser} version mismatch`);
  }
  invariant(result.chrome.background?.service_worker && !result.chrome.background?.scripts,
    'generated Chrome manifest is not the Chrome manifest');
  invariant(result.firefox.background?.scripts && !result.firefox.background?.service_worker,
    'generated Firefox manifest is not the Firefox manifest');
  invariant(result.chrome.version === result.firefox.version, 'browser manifest version mismatch');
  return result;
}

async function validateGenerated(distRoot, packagePath, audit) {
  if (audit) await auditRelease({ distRoot, packagePath });
  await Promise.all(['chrome', 'firefox'].map((browser) => exactFiles(
    path.join(distRoot, browser), `generated ${browser}`,
  )));
  return manifests(distRoot, packagePath);
}

async function removeCommittedLayout(repositoryRoot) {
  await rm(path.join(repositoryRoot, 'manifest.json'), { force: true });
  for (const directory of ['background', 'content', 'options', 'page', 'popup', 'firefox']) {
    await rm(path.join(repositoryRoot, directory), { recursive: true, force: true });
  }
}

export async function syncCodeDownloadBuilds({
  repositoryRoot = '.', distRoot = 'dist', packagePath = 'package.json', audit = true,
} = {}) {
  await validateGenerated(distRoot, packagePath, audit);
  await removeCommittedLayout(repositoryRoot);
  for (const browser of ['chrome', 'firefox']) {
    const targetRoot = path.join(repositoryRoot, committedRoots[browser]);
    for (const relative of expectedFiles) {
      const target = path.join(targetRoot, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(distRoot, browser, relative), target);
    }
  }
}

export async function verifyCodeDownloadBuilds({
  repositoryRoot = '.', distRoot = 'dist', packagePath = 'package.json', audit = true,
} = {}) {
  const generatedManifests = await validateGenerated(distRoot, packagePath, audit);
  for (const browser of ['chrome', 'firefox']) {
    const committedRoot = path.join(repositoryRoot, committedRoots[browser]);
    const files = await exactFiles(committedRoot, `committed ${browser}`, browser === 'chrome');
    for (const relative of files) {
      const [generated, committed] = await Promise.all([
        readFile(path.join(distRoot, browser, relative)),
        readFile(path.join(committedRoot, relative)),
      ]);
      invariant(generated.equals(committed), `${browser}/${relative} is not synchronized`);
    }
    let manifest;
    try { manifest = JSON.parse(await readFile(path.join(committedRoot, 'manifest.json'), 'utf8')); } catch {
      throw new Error(`committed ${browser} manifest is malformed`);
    }
    invariant(JSON.stringify(manifest) === JSON.stringify(generatedManifests[browser]),
      `committed ${browser} manifest does not match generated ${browser} manifest`);
    invariant(browser === 'chrome' ? Boolean(manifest.background?.service_worker)
      : Array.isArray(manifest.background?.scripts),
    `committed ${browser} directory contains the wrong browser manifest`);
  }
}

export const isMain = (url) => process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(url);
