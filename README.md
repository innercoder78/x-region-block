# X Region Reveal & Block

This repository contains the development foundation for a browser extension,
including versioned local settings, an options-page settings editor, and
content-script runtime settings synchronization. It also includes an isolated,
safe DOM renderer for plain-text country and region location badges, with
idempotent extension ownership, updates, and cleanup. The renderer is not
connected to live X pages, so users cannot see these badges on X yet.

An isolated account-link reader safely uses the raw `href` attribute of one
explicitly supplied anchor to extract a canonical identity from supported X and
Twitter links. It does not automatically read account links or scan a document
or timeline.

The pure shared models include canonical X account-handle normalization and safe
parsing of X and Twitter account references, a canonical immutable filter-subject
model, and a pure subject-to-filter-action evaluation boundary. They also provide
country flag-emoji generation, a canonical immutable location-display descriptor,
and distinct presentation labels for hidden, missing, unavailable, and unknown
locations. X account-container discovery, document or timeline scanning,
mutation observation, automatic account-link reading, live account lookup,
location lookup or detection, renderer startup on X, badge styling,
highlighting, and hiding or blocking live X content remain unimplemented. The
pure models also include a complete static ISO alpha-2
registry, a versioned deterministic country-to-region policy, and automatic
region enrichment for known country locations.

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
