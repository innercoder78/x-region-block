import { readFile } from 'node:fs/promises';

const tag = process.argv[2];
if (!/^v\d+(?:\.\d+){0,3}$/.test(tag ?? '')) throw new Error('release tag must be v followed by a version');
const expected = tag.slice(1);
for (const filename of [
  'package.json', 'manifests/chrome.json', 'manifests/firefox.json',
  'dist/chrome/manifest.json', 'dist/firefox/manifest.json',
]) {
  let metadata;
  try { metadata = JSON.parse(await readFile(filename, 'utf8')); } catch {
    throw new Error(`${filename} is missing or malformed`);
  }
  if (metadata.version !== expected) throw new Error(`${filename} version does not match ${tag}`);
}
console.log(`Confirmed ${tag} across package, source manifests, and generated manifests.`);
