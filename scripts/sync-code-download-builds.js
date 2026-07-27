import { isMain, syncCodeDownloadBuilds, verifyCodeDownloadBuilds } from './code-download-builds.js';

if (isMain(import.meta.url)) {
  const verify = process.argv.includes('--verify');
  if (verify) {
    await verifyCodeDownloadBuilds();
    console.log('Verified committed Code Download Chrome and Firefox extensions.');
  } else {
    await syncCodeDownloadBuilds();
    console.log('Synchronized committed Code Download Chrome and Firefox extensions.');
  }
}
