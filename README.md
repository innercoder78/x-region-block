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

An isolated version 1 account-target processing coordinator consumes those
explicit observer changes and composes canonical About Account parsing with
account presentation. It groups only currently active canonical accounts,
deduplicates their dependency-injected payload lookups, rejects stale results
across target and lifecycle changes, and reevaluates resolved targets when the
canonical settings snapshot changes without repeating a lookup. Targets that
disappear are cancelled and cleaned up, and all transient account, location,
request, and DOM state is cleared when processing stops.

The processor now uses an ownership-safe version 1 account-action renderer to apply and clean up reversible `show`, `highlight`, and `hide` decisions on explicitly supplied account containers. A single `data-x-region-block-account-action` attribute represents highlight or hide, while show is represented by its absence. Minimal manifest-loaded CSS highlights with a non-layout-changing outline and hides only through the exact owned attribute selector; it has no effect until the processor applies a recognized value. Location badges continue to render for every action. Profile actions currently apply only to the profile surface container returned by the existing selector policy.

An isolated version 1 account-target session now composes one explicitly chosen
root and one canonical source with an already-started settings runtime, the
observer, the processor, and dependency-injected location loading. It
coordinates initial scanning, mutation processing, settings reevaluation,
manual rescanning, cleanup, and restart, with lifecycle-generation guards that
ignore stale callbacks. The session never starts or stops the settings runtime
and is not connected to content-script startup. The caller must choose the root
and source; route detection and root selection remain unimplemented. Timeline
and reply intentionally continue to share the fixed tweet selector.

The coordinator and session have no real X transport or hardcoded query ID, read no
authentication data, and are not connected to content-script startup. About Account request transport, query-ID discovery,
memory-only authorization handling, live content-script session startup,
route-aware root and source orchestration, broker-to-session production wiring,
badge styling, blocking
live X content, and end-to-end browser verification remain unimplemented.
There is no cross-session cache. Live X layout compatibility and end-to-end
browser behavior remain unverified.

An isolated version 1 X About Account payload broker now provides active-only
cross-session deduplication by canonical handle and account ID. It gives each
consumer an independent promise and cancellation path, uses a source-neutral
identity for the dependency-injected underlying request, and cancels that shared
request only after its final consumer leaves. Entries are removed immediately on
resolution, rejection, final cancellation, or stop; no resolved payload or parsed
location cache is retained. Future orchestration must start one broker, pass its
loader to sessions, stop all sessions, and stop the broker last.

The broker performs no X request, hardcodes no query ID, and reads no authentication
data. It is not connected to content-script startup, sessions are not automatically
connected to it, and route/root orchestration remains unimplemented. The real About
Account transport, query-ID discovery, memory-only authorization handling, live
content-script startup, route-aware root/source orchestration, broker-to-session
production wiring, badge styling, and end-to-end browser verification remain
unimplemented. Live X behavior remains unverified.

An isolated version 1 account-target session group now composes one shared
broker with several caller-supplied explicit root/source session plans. It
starts the broker before sessions, stops sessions in reverse order before the
broker, shares in-flight lookups across roots and sources, supports manual
rescanning and clean restart, rolls back partial startup, and uses lifecycle
generations to reject stale callbacks. It retains no resolved payload or
location cache. The settings runtime must already be started and the group
never starts or stops it; the underlying transport remains dependency-injected.

An isolated version 1 X route classifier now accepts only an explicitly supplied,
conservatively validated absolute HTTPS X or Twitter URL. It returns a minimal
immutable descriptor for home, explore, profile sections (including replies),
status, search, or notifications, and retains no raw URL, query, or hash data.
Classification uses the conservatively validated supplied path spelling rather
than a URL parser's repaired or dot-segment-normalized pathname.

An isolated version 1 route planner deterministically converts that descriptor
and one explicit caller-supplied root into immutable account-target session
plans. Profile plans are ordered first; status pages receive only one reply plan
to avoid duplicate scanning of the timeline/reply shared tweet selector.

The classifier does not observe navigation, and root acquisition and selection
remain caller responsibilities. The classifier and planner are not connected to
content-script startup, and dynamic route reconciliation is not implemented.
Neither module retains a route, root, account, payload, or location cache. The
conservative route and selector policies have not been verified against every
live X layout, and live browser behavior remains unverified.

Navigation observation, dynamic route reconciliation, automatic root
acquisition, and session startup remain caller concerns and are not implemented. The
group is not connected to content-script startup. No real X request, query ID,
authentication handling, or persistent account data exists, and live X layout
and end-to-end browser behavior remain unverified. Real About Account transport,
query-ID discovery, memory-only authorization handling, live content-script
startup, navigation observation, dynamic route reconciliation, automatic root
acquisition, badge styling, and end-to-end browser verification all remain
unimplemented; this repository is not production-ready.

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

## X About Account location parsing

The repository includes version 1 of a deterministic English country-name policy covering
all 249 supported country codes, with short canonical display names and explicit safe
aliases for common variants. A pure version 1 parser accepts caller-supplied X About
Account payloads and converts the exact observed `account_based_in` path into canonical
known, missing, unavailable, or unknown immutable location results. It deliberately does
not use `location_accurate` for classification and retains only the trimmed raw country
name for known or unknown results; other account, request, authentication, and response
metadata is discarded. The parser never produces a hidden location.

The observed response shape is a versioned observation, not an official stable API. No X
request, query-ID discovery, authentication-data reading, page integration, content-script
integration, live location lookup, or automatic account presentation is implemented.
Memory-only authorization handling, live observer and processor startup, badge styling, blocking live X content, and end-to-end browser verification
also remain unimplemented.

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

Live X layout compatibility and end-to-end browser behavior remain unverified. This repository is not production-ready. No real About Account transport, query-ID discovery, memory-only authorization handling, live content-script session startup, route-aware root and source orchestration, broker-to-session production wiring, badge styling, or end-to-end browser verification is implemented. No authentication handling or persistent account/location storage exists.
