import {
  X_PAGE_RUNTIME_ERROR_EVENT_TYPE, X_PAGE_RUNTIME_READY_EVENT_TYPE,
  X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, X_PAGE_RUNTIME_STOP_EVENT_TYPE,
} from '../shared/x-page-runtime-event.js';
import { installXAboutAccountRequestCapture } from './x-about-account-request-capture.js';
import { installXNavigationSignal } from './x-navigation-signal.js';

export const X_PAGE_RUNTIME_VERSION = 1;

export function installXPageRuntime(globalScope) {
  let document;
  let EventConstructor;
  let add;
  let remove;
  let dispatch;
  try {
    document = globalScope.document;
    EventConstructor = globalScope.Event;
    add = document.addEventListener;
    remove = document.removeEventListener;
    dispatch = document.dispatchEvent;
    if (typeof EventConstructor !== 'function' || typeof add !== 'function'
      || typeof remove !== 'function' || typeof dispatch !== 'function') throw new Error();
  } catch {
    try {
      globalScope.document.dispatchEvent(new globalScope.Event(X_PAGE_RUNTIME_ERROR_EVENT_TYPE, {
        bubbles: false, cancelable: false, composed: false,
      }));
    } catch { /* no usable page event boundary */ }
    throw new Error('Unable to install X page runtime');
  }
  const emit = (type) => Reflect.apply(dispatch, document, [new EventConstructor(type, {
    bubbles: false, cancelable: false, composed: false,
  })]);
  let found = false;
  const probe = () => { found = true; };
  try {
    Reflect.apply(add, document, [X_PAGE_RUNTIME_READY_EVENT_TYPE, probe]);
    emit(X_PAGE_RUNTIME_REQUEST_EVENT_TYPE);
  } catch {
    try { Reflect.apply(remove, document, [X_PAGE_RUNTIME_READY_EVENT_TYPE, probe]); } catch { /* best effort */ }
    throw new Error('Unable to install X page runtime');
  }
  try { Reflect.apply(remove, document, [X_PAGE_RUNTIME_READY_EVENT_TYPE, probe]); } catch {
    throw new Error('Unable to install X page runtime');
  }
  if (found) return null;

  let navigation = null;
  let capture = null;
  let active = false;
  let requestAdded = false;
  let stopAdded = false;
  const respond = () => { if (active) { try { emit(X_PAGE_RUNTIME_READY_EVENT_TYPE); } catch { /* best effort */ } } };
  const stop = () => {
    if (!active && !requestAdded && !stopAdded && navigation === null && capture === null) return;
    active = false;
    if (requestAdded) { try { Reflect.apply(remove, document, [X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, respond]); } catch { /* contained */ } }
    if (stopAdded) { try { Reflect.apply(remove, document, [X_PAGE_RUNTIME_STOP_EVENT_TYPE, stop]); } catch { /* contained */ } }
    requestAdded = false; stopAdded = false;
    try { capture?.stop(); } catch { /* contained */ }
    try { navigation?.stop(); } catch { /* contained */ }
    capture = null; navigation = null; document = null; EventConstructor = null;
    add = null; remove = null; dispatch = null;
  };
  const isActive = () => active;
  const controller = Object.freeze({ stop, isActive });
  try {
    navigation = installXNavigationSignal(globalScope);
    capture = installXAboutAccountRequestCapture(globalScope);
    requestAdded = true;
    Reflect.apply(add, document, [X_PAGE_RUNTIME_REQUEST_EVENT_TYPE, respond]);
    stopAdded = true;
    Reflect.apply(add, document, [X_PAGE_RUNTIME_STOP_EVENT_TYPE, stop]);
    active = true;
    emit(X_PAGE_RUNTIME_READY_EVENT_TYPE);
    return controller;
  } catch {
    const errorDocument = document;
    const ErrorEvent = EventConstructor;
    const errorDispatch = dispatch;
    stop();
    try {
      Reflect.apply(errorDispatch, errorDocument, [new ErrorEvent(X_PAGE_RUNTIME_ERROR_EVENT_TYPE, {
        bubbles: false, cancelable: false, composed: false,
      })]);
    } catch { /* installation may have lost its event boundary */ }
    throw new Error('Unable to install X page runtime');
  }
}
