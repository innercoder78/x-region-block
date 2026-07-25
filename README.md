# X Region Reveal & Block

This repository contains the development foundation for a browser extension,
including versioned local settings, an options-page settings editor, and
content-script runtime settings synchronization. X account lookup, location
detection, country or region display, highlighting, and hiding or blocking X
content are not yet implemented.

The pure shared models include canonical X account-handle normalization and safe
parsing of X and Twitter account references, a canonical immutable filter-subject
model, and a pure subject-to-filter-action evaluation boundary. Live X DOM
account discovery, account lookup, location lookup or detection, country-name
parsing, country flags or region display, highlighting, and hiding or blocking
X content remain unimplemented. The pure models now also include a complete
static ISO alpha-2 registry, a versioned deterministic country-to-region policy,
and automatic region enrichment for known country locations.

## Development

Install dependencies with `npm ci`, then run the complete validation suite:

```sh
npm run check
```

Individual commands are available for linting (`npm run lint`), testing
(`npm test`), and building unpacked Chrome and Firefox extensions
(`npm run build:chrome` and `npm run build:firefox`). Unpacked browser builds are
written to `dist/chrome` and `dist/firefox`; each generated directory contains
its own root `manifest.json`.
