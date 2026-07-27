import { isMain, verifyPackages } from './release-packages.js';

if (isMain(import.meta.url)) {
  await verifyPackages();
  console.log('Verified Chrome and Firefox archives and SHA-256 checksums.');
}
