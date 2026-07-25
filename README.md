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

An isolated account-evaluation pipeline composes one explicitly supplied
account link, a caller-supplied location and optional observed languages and
tags with a settings snapshot. It returns a deeply immutable canonical filter
subject, filter action, and location-display descriptor.

An isolated, versioned one-account presentation coordinator composes that
evaluation pipeline with location-badge rendering for an explicitly supplied
link and badge container. It safely removes stale owned badges for non-account
links and preserves an existing badge when evaluation fails. The coordinator
is not connected to live X pages and does not apply highlight or hide actions.

A versioned, static X account-surface selector policy now supports isolated
discovery of presentation targets within one explicitly supplied DOM root.
Discovery uses conservative ambiguity handling, isolates nested tweets, and
resolves canonical identities through the existing account-link reader. The
conservative initial selectors have not been verified against every live X
layout, and discovery is not connected to live content-script startup.

An isolated, mutation-driven account-target observer wraps that static boundary
with an initial scan and coalesced mutation rescanning. It emits immutable
added, updated, removed, and reordered target changes, preserves stable records
for unchanged targets, and clears its transient in-memory target tracking when
stopped. The observer requires an explicitly supplied observer factory and is
not connected to content-script startup. It performs no location or account
lookup, presentation, highlighting, hiding, or blocking. Its underlying
selector policy has not yet been verified across every live X layout.

The pure shared models include canonical X account-handle normalization and safe
parsing of X and Twitter account references, a canonical immutable filter-subject
model, and a pure subject-to-filter-action evaluation boundary. They also provide
country flag-emoji generation, a canonical immutable location-display descriptor,
and distinct presentation labels for hidden, missing, unavailable, and unknown
locations. Automatic observer startup, route-aware observer selection, location
lookup or detection, automatic account presentation, applying highlight or hide
actions, badge styling, blocking live X content, and end-to-end browser
verification remain unimplemented. The pure models also include a complete static ISO alpha-2
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
