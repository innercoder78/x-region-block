import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditRelease } from './release-audit.js';

export const browsers = ['chrome', 'firefox'];
export const expectedFiles = [
  'background/service-worker.js',
  'content/account-actions.css',
  'content/content-script.js',
  'manifest.json',
  'options/options.css',
  'options/options.html',
  'options/options.js',
  'page/page-script.js',
  'popup/popup.css',
  'popup/popup.html',
  'popup/popup.js',
];

function invariant(value, message) {
  if (!value) throw new Error(message);
}

async function metadata(packagePath) {
  let value;
  try {
    value = JSON.parse(await readFile(packagePath, 'utf8'));
  } catch {
    throw new Error('package metadata is missing or malformed');
  }
  invariant(typeof value.name === 'string' && /^[a-z0-9-]+$/.test(value.name),
    'package name is not safe for artifact filenames');
  invariant(typeof value.version === 'string' && /^\d+(?:\.\d+){0,3}$/.test(value.version),
    'package version is invalid');
  return value;
}

async function buildFiles(root) {
  try {
    await lstat(root);
  } catch {
    throw new Error(`missing build directory: ${root}`);
  }
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const relative = path.relative(root, filename).split(path.sep).join('/');
      const info = await lstat(filename);
      invariant(!info.isSymbolicLink(), `symbolic links are prohibited: ${relative}`);
      if (info.isDirectory()) await visit(filename);
      else if (info.isFile()) files.push(relative);
      else throw new Error(`unsupported generated path: ${relative}`);
    }
  }
  await visit(root);
  files.sort();
  invariant(JSON.stringify(files) === JSON.stringify(expectedFiles),
    `unexpected or missing generated files in ${root}`);
  return files;
}

async function zipFiles(root, files, output) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const relative of files) {
    const contents = await readFile(path.join(root, relative));
    const name = Buffer.from(relative);
    const crc = crc32(contents);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(contents.length, 18);
    header.writeUInt32LE(contents.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, contents);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(0x0314, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(contents.length, 20);
    directory.writeUInt32LE(contents.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + contents.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  const buffer = Buffer.concat([...local, centralBuffer, end]);
  await writeFile(output, buffer);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function artifactNames(packageJson) {
  return Object.fromEntries(browsers.map((browser) => [browser,
    `${packageJson.name}-${browser}-${packageJson.version}.zip`]));
}

export async function packageRelease({
  distRoot = 'dist', artifactRoot = 'artifacts', packagePath = 'package.json', audit = true,
} = {}) {
  if (audit) await auditRelease({ distRoot, packagePath });
  const packageJson = await metadata(packagePath);
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  const names = artifactNames(packageJson);
  const checksumLines = [];
  for (const browser of browsers) {
    const root = path.join(distRoot, browser);
    const files = await buildFiles(root);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    invariant(manifest.version === packageJson.version, `${browser} manifest version mismatch`);
    const output = path.join(artifactRoot, names[browser]);
    const buffer = await zipFiles(root, files, output);
    const digest = createHash('sha256').update(buffer).digest('hex');
    invariant(digest.length === 64, `could not generate checksum for ${names[browser]}`);
    checksumLines.push(`${digest}  ${names[browser]}`);
  }
  await writeFile(path.join(artifactRoot, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`);
  return { names, checksumLines };
}

async function readZip(filename) {
  const archive = await readFile(filename);
  const result = new Map();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    invariant(archive.readUInt16LE(offset + 8) === 0, 'archive uses an unsupported compression method');
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    invariant(!result.has(name), `archive contains duplicate path: ${name}`);
    const contents = archive.subarray(start, start + size);
    invariant(contents.length === size && crc32(contents) === archive.readUInt32LE(offset + 14),
      `archive entry is truncated or corrupt: ${name}`);
    result.set(name, contents);
    offset = start + size;
  }
  invariant(result.size > 0 && archive.readUInt32LE(offset) === 0x02014b50,
    'archive central directory is missing');
  return result;
}

function assertSafeContents(name, entries) {
  const text = [...entries.entries()]
    .filter(([entry]) => /\.(?:js|html|css|json)$/i.test(entry))
    .map(([, contents]) => contents.toString('utf8')).join('\n');
  const prohibited = [
    /sourceMappingURL=/i,
    /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
    /["'](?:x-csrf-token|x-guest-token|x-client-transaction-id)["']\s*:\s*["'][^"']{8,}/i,
    /\/graphql\/[A-Za-z0-9_-]{8,}\/UserByScreenName/i,
    /\b(?:localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|EventSource)\b/,
    /\b(?:runtime|tabs)\.(?:sendMessage|connect)\s*\(/,
  ];
  invariant(!prohibited.some((pattern) => pattern.test(text)),
    `${name} contains unexpected remote assets, sensitive material, snapshots, or prohibited APIs`);
  const remoteHosts = [...text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/gi)]
    .map((match) => match[1].toLowerCase());
  invariant(remoteHosts.every((host) => ['x.com', 'twitter.com'].includes(host)),
    `${name} contains unexpected remote assets, sensitive material, snapshots, or prohibited APIs`);
}

export async function verifyPackages({ artifactRoot = 'artifacts', packagePath = 'package.json' } = {}) {
  const packageJson = await metadata(packagePath);
  const names = artifactNames(packageJson);
  const expectedArtifacts = [...Object.values(names), 'SHA256SUMS.txt'].sort();
  const actualArtifacts = (await readdir(artifactRoot)).sort();
  invariant(JSON.stringify(actualArtifacts) === JSON.stringify(expectedArtifacts),
    'artifact directory contains unexpected or missing files');
  const sums = await readFile(path.join(artifactRoot, 'SHA256SUMS.txt'), 'utf8');
  for (const browser of browsers) {
    const name = names[browser];
    const filename = path.join(artifactRoot, name);
    const entries = await readZip(filename);
    const paths = [...entries.keys()];
    invariant(paths.every((entry) => entry === path.posix.normalize(entry)
      && !path.posix.isAbsolute(entry) && !entry.split('/').includes('..') && !entry.includes('\\')),
    `${name} contains an unsafe archive path`);
    invariant(JSON.stringify(paths) === JSON.stringify(expectedFiles),
      `${name} has incomplete or unexpected contents`);
    invariant(!paths.some((entry) => /(?:\.map$|(^|\/)(?:src|tests?)(\/|$))/i.test(entry)),
      `${name} contains source, test, or source-map files`);
    assertSafeContents(name, entries);
    let manifest;
    try { manifest = JSON.parse(entries.get('manifest.json').toString('utf8')); } catch {
      throw new Error(`${name} has a malformed root manifest`);
    }
    invariant(manifest.name === packageJson.extensionName && manifest.version === packageJson.version,
      `${name} manifest metadata mismatch`);
    invariant(browser === 'chrome' ? Boolean(manifest.background?.service_worker)
      : Array.isArray(manifest.background?.scripts), `${name} contains the wrong browser manifest`);
    const buffer = await readFile(filename);
    const digest = createHash('sha256').update(buffer).digest('hex');
    invariant(sums.includes(`${digest}  ${name}\n`), `${name} checksum does not match`);
  }
  invariant(sums.trim().split('\n').length === browsers.length, 'checksum file has unexpected entries');
}

export const isMain = (url) => process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(url);
