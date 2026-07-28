import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { COUNTRY_CODES } from '../src/shared/country-regions.js';

export const FLAG_SOURCE_DIRECTORY = 'src/assets/flags';
export const FLAG_COUNT = 249;
export const FLAG_WIDTH = 20;
export const FLAG_MIN_HEIGHT = 8;
export const FLAG_MAX_HEIGHT = 24;
export const FLAG_PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const flagFilenames = Object.freeze(
  COUNTRY_CODES.map((code) => `${code.toLowerCase()}.png`).sort(),
);
export const flagAssetPaths = Object.freeze(flagFilenames.map((name) => `assets/flags/${name}`));

function invariant(value, message) {
  if (!value) throw new Error(message);
}

export function inspectFlagPng(contents, name = 'flag') {
  invariant(Buffer.isBuffer(contents) && contents.length >= 24, `${name} is a truncated PNG`);
  invariant(contents.subarray(0, 8).equals(FLAG_PNG_SIGNATURE), `${name} has an invalid PNG signature`);
  invariant(contents.readUInt32BE(8) === 13 && contents.subarray(12, 16).toString('ascii') === 'IHDR',
    `${name} has an invalid IHDR`);
  const width = contents.readUInt32BE(16);
  const height = contents.readUInt32BE(20);
  invariant(width === FLAG_WIDTH, `${name} must be exactly ${FLAG_WIDTH} pixels wide`);
  invariant(height >= FLAG_MIN_HEIGHT && height <= FLAG_MAX_HEIGHT,
    `${name} has an invalid height: ${height}`);
  return Object.freeze({ width, height, bytes: contents.length });
}

export async function validateFlagAssets(directory = FLAG_SOURCE_DIRECTORY) {
  invariant(COUNTRY_CODES.length === FLAG_COUNT, `canonical country registry must contain ${FLAG_COUNT} codes`);
  invariant(new Set(COUNTRY_CODES).size === FLAG_COUNT, 'canonical country registry contains duplicate codes');
  invariant(new Set(flagFilenames).size === FLAG_COUNT, 'derived flag filenames contain duplicates');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch {
    throw new Error(`flag asset directory is missing: ${directory}`);
  }
  const names = entries.map(({ name }) => name).sort();
  invariant(JSON.stringify(names) === JSON.stringify(flagFilenames),
    `flag asset inventory mismatch (missing: ${flagFilenames.filter((name) => !names.includes(name)).join(', ') || 'none'}; unexpected: ${names.filter((name) => !flagFilenames.includes(name)).join(', ') || 'none'})`);
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    invariant(/^[a-z]{2}\.png$/.test(entry.name), `unsafe or unsupported flag filename: ${entry.name}`);
    invariant(entry.name !== 'xk.png', 'unsupported subdivision flag: xk.png');
    const filename = path.join(directory, entry.name);
    const info = await lstat(filename);
    invariant(!info.isSymbolicLink(), `symbolic flag assets are prohibited: ${entry.name}`);
    invariant(info.isFile() && entry.isFile(), `unsupported object in flag directory: ${entry.name}`);
    const contents = await readFile(filename);
    files.push(Object.freeze({ name: entry.name, filename, contents, ...inspectFlagPng(contents, entry.name) }));
  }
  return Object.freeze(files);
}
