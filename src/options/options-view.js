import { REGIONS, REGION_CODES } from '../shared/regions.js';

const STATUS_LABELS = Object.freeze({
  hidden: 'Hidden — location was intentionally hidden',
  missing: 'Missing — no location was provided',
  unavailable: 'Unavailable — location could not be retrieved',
  unknown: 'Unknown — location could not be classified',
});

function addChoices(document, container, name, choices) {
  for (const [value, labelText] of choices) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.name = name; input.value = value;
    label.append(input, document.createTextNode(labelText));
    container.append(label);
  }
}

export function createOptionsView(document) {
  const form = document.querySelector('#settings-form');
  const textFields = {
    countryHide: document.querySelector('#country-hide'), countryHighlight: document.querySelector('#country-highlight'),
    countryAlwaysShow: document.querySelector('#country-always-show'), allowlist: document.querySelector('#allowlist'),
  };
  const regionChoices = Object.values(REGIONS).filter(({ code }) => code !== REGION_CODES.UNKNOWN).map(({ code, name }) => [code, name]);
  addChoices(document, document.querySelector('#region-hide'), 'regionHide', regionChoices);
  addChoices(document, document.querySelector('#region-highlight'), 'regionHighlight', regionChoices);
  addChoices(document, document.querySelector('#other-hide'), 'otherHide', Object.entries(STATUS_LABELS));
  addChoices(document, document.querySelector('#other-highlight'), 'otherHighlight', Object.entries(STATUS_LABELS));

  const checked = (name) => [...form.elements].filter((control) => control.name === name && control.checked).map(({ value }) => value);
  const setChecked = (name, values) => { for (const control of form.elements) if (control.name === name) control.checked = values.includes(control.value); };
  return Object.freeze({
    onSubmit(handler) { form.addEventListener('submit', (event) => { event.preventDefault(); void handler(); }); },
    onReset(handler) { document.querySelector('#reset-settings').addEventListener('click', () => { void handler(); }); },
    readModel() { return { ...Object.fromEntries(Object.entries(textFields).map(([key, field]) => [key, field.value])), regionHide: checked('regionHide'), regionHighlight: checked('regionHighlight'), otherHide: checked('otherHide'), otherHighlight: checked('otherHighlight') }; },
    writeModel(model) { for (const [key, field] of Object.entries(textFields)) field.value = model[key]; for (const name of ['regionHide', 'regionHighlight', 'otherHide', 'otherHighlight']) setChecked(name, model[name]); },
    setEnabled(enabled) { for (const control of form.elements) control.disabled = !enabled; },
    setActionsEnabled(enabled) { document.querySelector('#save-settings').disabled = !enabled; document.querySelector('#reset-settings').disabled = !enabled; },
    showStatus(message, kind) { const status = document.querySelector('#status'); status.textContent = message; status.dataset.kind = kind; },
  });
}
