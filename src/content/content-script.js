import { createXProductionContentRuntime } from './x-production-runtime.js';

const key = Symbol.for('x-region-block.content-runtime.v1');
let runtime = null;
let failed = false;
const fail = () => {
  if (failed) return;
  failed = true;
  try { runtime?.stop(); } catch { /* contained */ }
  try { if (globalThis[key] === runtime) delete globalThis[key]; } catch { /* contained */ }
  globalThis.console?.error?.('Unable to initialize X Region Reveal & Block');
};
try {
  runtime = globalThis[key];
  if (!runtime?.isActive?.()) {
    runtime = createXProductionContentRuntime(globalThis);
    Object.defineProperty(globalThis, key, {
      value: runtime, configurable: true, writable: true, enumerable: false,
    });
  }
  Promise.resolve(runtime.start()).catch(fail);
} catch { fail(); }
