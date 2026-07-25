export function splitRuleList(value) {
  const seen = new Set();
  return value.split(/[,\r\n]+/u).map((entry) => entry.trim()).filter((entry) => {
    if (entry === '' || seen.has(entry)) return false;
    seen.add(entry);
    return true;
  });
}

export function settingsToFormModel(settings) {
  return {
    countryHide: settings.country.hide.join('\n'),
    countryHighlight: settings.country.highlight.join('\n'),
    countryAlwaysShow: settings.country.alwaysShow.join('\n'),
    regionHide: [...settings.region.hide],
    regionHighlight: [...settings.region.highlight],
    languageHighlight: settings.language.highlight.join('\n'),
    tagHighlight: settings.tag.highlight.join('\n'),
    otherHide: [...settings.other.hide],
    otherHighlight: [...settings.other.highlight],
    allowlist: settings.allowlist.join('\n'),
  };
}

export function formModelToSettingsInput(model) {
  return {
    country: { hide: splitRuleList(model.countryHide), highlight: splitRuleList(model.countryHighlight), alwaysShow: splitRuleList(model.countryAlwaysShow) },
    region: { hide: [...model.regionHide], highlight: [...model.regionHighlight] },
    language: { highlight: splitRuleList(model.languageHighlight) },
    tag: { highlight: splitRuleList(model.tagHighlight) },
    other: { hide: [...model.otherHide], highlight: [...model.otherHighlight] },
    allowlist: splitRuleList(model.allowlist),
  };
}
