import { createXProductionContentRuntime } from './x-production-runtime.js';

const key = Symbol.for('x-region-block.content-runtime.v1');
let runtime = globalThis[key];
if (!runtime?.isActive?.()) {
  runtime = createXProductionContentRuntime(globalThis);
  Object.defineProperty(globalThis, key, {
    value: runtime, configurable: true, writable: true, enumerable: false,
  });
}
runtime.start().catch(() => {
  if (globalThis[key] === runtime) delete globalThis[key];
  globalThis.console?.error?.('Unable to initialize X Region Reveal & Block');
});
