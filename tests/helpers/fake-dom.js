export class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this._textContent = '';
    this.listeners = new Map();
  }

  get parentElement() {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const selectors = selector.split(',').map((value) => value.trim());
    const matchesSelector = (element, fixedSelector) => {
      if (fixedSelector === 'a[href]') {
        return element.tagName === 'A' && element.hasAttribute('href');
      }
      const match = /^(article)?\[data-testid="([^"]+)"\]$/.exec(fixedSelector);
      if (match !== null) return (!match[1] || element.tagName === match[1].toUpperCase())
        && element.getAttribute('data-testid') === match[2];
      const attribute = /^\[([^=]+)="([^"]+)"\]$/.exec(fixedSelector);
      return attribute !== null && element.getAttribute(attribute[1]) === attribute[2];
    };
    const visit = (element) => {
      for (const child of element.children) {
        if (selectors.some((candidate) => matchesSelector(child, candidate))) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  get textContent() {
    return this.children.length === 0
      ? this._textContent
      : `${this._textContent}${this.children.map((child) => child.textContent).join('')}`;
  }

  set textContent(value) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._textContent = String(value);
  }

  appendChild(child) {
    if (child.parentNode !== null) child.parentNode.removeChild(child);
    this._textContent = '';
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  insertBefore(child, reference) {
    if (child.parentNode !== null) child.parentNode.removeChild(child);
    const index = reference === null || reference === undefined
      ? this.children.length : this.children.indexOf(reference);
    if (index < 0) throw new Error('Not a child');
    this.children.splice(index, 0, child); child.parentNode = this; return child;
  }

  get nextSibling() { const siblings = this.parentNode?.children; const index = siblings?.indexOf(this) ?? -1; return index < 0 ? null : (siblings[index + 1] ?? null); }
  get nextElementSibling() { return this.nextSibling; }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error('Not a child');
    this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener, options) {
    this.listeners.set(type, { listener, once: options?.once === true });
  }

  removeEventListener(type, listener) { if (this.listeners.get(type)?.listener === listener) this.listeners.delete(type); }

  dispatchEvent(event) {
    const record = this.listeners.get(event.type);
    if (record === undefined) return true;
    if (record.once) this.listeners.delete(event.type);
    record.listener.call(this, event);
    return true;
  }
}

export class FakeDocument {
  constructor() {
    this.created = [];
    this.children = [];
    this.baseURI = 'https://x.com/home';
  }

  createElement(tagName) {
    const element = new FakeElement(tagName, this);
    this.created.push(element);
    return element;
  }

  createElementNS(namespace, tagName) { return this.createElement(tagName); }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  querySelectorAll(selector) {
    const root = new FakeElement('document-root', this);
    root.children = this.children;
    return root.querySelectorAll(selector);
  }
}

export function createContainer() {
  const ownerDocument = new FakeDocument();
  return { ownerDocument, container: ownerDocument.createElement('div') };
}

export function attributesOf(element) {
  return Object.fromEntries(element.attributes);
}

export function snapshot(element) {
  return {
    tagName: element.tagName,
    attributes: attributesOf(element),
    text: element._textContent,
    children: element.children.map(snapshot),
  };
}
