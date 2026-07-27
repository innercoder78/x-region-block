import { isMain, packageRelease } from './release-packages.js';

if (isMain(import.meta.url)) {
  await packageRelease();
  console.log('Created deterministic Chrome and Firefox release packages in artifacts/.');
}
