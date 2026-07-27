# X Region Reveal & Block

X Region Reveal & Block is a Manifest V3 browser extension that reveals the country or
region returned by X's About Account request and applies the user's configured show,
highlight, or hide action to discovered account surfaces. The extension remains at
version `0.0.1` and is not release-ready.

## Production composition

The Chrome and Firefox content scripts run at `document_start` on `https://x.com/*`
and `https://twitter.com/*`. The isolated content runtime starts the memory-only
metadata bridge before injecting the web-accessible classic page bundle. The page
runtime transactionally installs the existing navigation signal and About Account
request-metadata capture. A no-detail same-document request/ready/error/stop event
protocol detects an existing page runtime, reports startup, and cleans up both page
wrappers without page-global markers or runtime messaging.

Page injection and settings initialization proceed after the bridge starts. Account
processing deliberately waits until injection and settings startup have completed and
the bridge holds its first valid metadata snapshot. The extension may therefore be
active but not ready until X makes an eligible `UserByScreenName` request. Invalid
metadata events are only wake-up signals and cannot start processing.

Once metadata is available, production startup composes the real request transport and
dynamic route-session controller with the current `document` as its explicit target
root. The controller continues to own its payload broker, route planning, sessions,
parser, settings evaluation, badge renderer, account-action renderer, mutation
observers, and independent broker and consumer abort controllers. It reconciles the
current route after successful `pushState` and `replaceState` calls and native
`popstate`, and mutation-driven discovery processes targets added to supported account
surfaces.

The transport creates every request from the bridge's latest valid snapshot, uses the
shared cancellation signal, included credentials, `no-store`, and rejected redirects,
and returns the response payload to the existing parser. The page capture observes the
outgoing request only; it does not intercept or capture response bodies.

## Privacy and lifecycle

Request query templates, query IDs, permitted headers, and authorization material stay
in memory. The extension does not read `document.cookie`, use runtime messaging, or
persist accounts, payloads, parsed locations, queries, headers, or authorization
material. It contains no hardcoded query ID, bearer token, CSRF token, guest token,
transaction ID, feature snapshot, or field-toggle snapshot. It does not poll and does
not add a resolved payload or location cache.

Normal content-runtime stop removes its metadata-readiness and page-lifecycle listeners,
stops route sessions and broker work, clears bridge metadata, stops settings, and asks
the injected page runtime to remove request-capture and navigation wrappers. A
back-forward-cache `pagehide` preserves the lifecycle when `persisted` is true; other
`pagehide` events stop it.

## Existing policies and components

The production controller reuses the versioned account identity, country and region,
location parsing, route classification and planning, selector, discovery, processor,
session, payload-broker, presentation, filter-precedence, settings-schema, migration,
and storage-repository contracts. Known, hidden, missing, unavailable, and unknown
locations retain their established behavior. Allowlist and always-show exceptions,
badge rendering, and reversible show, highlight, and hide actions are unchanged.

Settings are stored through the extension's established local-storage adapters. No
other production data uses extension storage. Chrome and Firefox manifests request only
the `storage` permission, request no host permissions, and expose only
`page/page-script.js` to the existing X and Twitter match patterns.

### Component architecture

Account identity normalization safely canonicalizes supported X and Twitter account
references. The account-link reader consumes an explicitly supplied anchor, while the
selector and discovery layers identify conservative profile, timeline, reply, search,
notification, and related account targets. The mutation-driven target observer emits
stable added, updated, removed, and reordered records and clears its transient tracking
on stop.

Each account-target session composes discovery with the processor, settings snapshots,
About Account location parsing, badge presentation, and reversible show, highlight, and
hide actions. The processor groups active canonical accounts, rejects stale lifecycle
results, reevaluates resolved targets after settings changes without another lookup,
and cleans targets which disappear. The dynamic route-session controller classifies
navigation URLs, creates the existing route plans, reuses compatible sessions, and
keeps one active-only payload broker across route changes.

The payload broker deduplicates only current work, gives each consumer an independent
cancellation path, and aborts shared work after its final consumer leaves. Entries are
removed on resolution, rejection, cancellation, or stop, so it introduces no resolved
payload or parsed-location cache. The transport obtains a fresh request descriptor from
the bridge for every request, validates the endpoint and closed header allowlist, and
passes successful JSON unchanged to the established parser.

The page capture observes an eligible same-origin `UserByScreenName` GET without
modifying it or reading its response. It removes the observed handle before publishing
the reusable template. The isolated-world bridge treats the same-document event as
untrusted input, validates and deeply copies it, and substitutes each canonical target
handle only when creating a fresh transport descriptor.

## Download and install

Download the browser-specific testing asset from the repository's **Releases** page.
Do **not** use GitHub's automatic “Source code” ZIP as an installable extension: it is
the project source, not a ready-built browser package. Users and testers need no
Node.js, npm commands, or repository build commands.

### Chrome

1. Download `x-region-block-chrome-0.0.1.zip`.
2. Extract the ZIP.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked**.
6. Select the extracted folder containing `manifest.json`.

### Firefox testing

1. Download `x-region-block-firefox-0.0.1.zip`.
2. Extract the ZIP.
3. Open `about:debugging#/runtime/this-firefox`.
4. Choose **Load Temporary Add-on**.
5. Select the extracted `manifest.json`.
6. Remember that this temporary installation ends when Firefox closes. Normal
   permanent distribution will require a signed Firefox package.

## Development

Install exact dependencies and run the full validation suite:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Individual commands are available as `npm run lint`, `npm test`, `npm run build`, and
`npm run validate:build`. Generated unpacked builds are written beneath `dist/` and are
not committed.

Maintainers can reproduce the downloadable archives and checksums with
`npm run package:release`, then inspect them with `npm run verify:packages`. Generated
packages are written beneath ignored `artifacts/` and are not committed.

For the reproducible automated release gate, run:

```sh
npm run verify:release
```

That command runs lint and synthetic tests, freshly builds Chrome and Firefox, applies
the existing build validation, and runs the static `npm run audit:release` checks for
manifest, asset, endpoint, source-map, sensitive-material, and prohibited-API
invariants. These checks cover deterministic repository and generated-output contracts;
they do not exercise a browser or contact X.

Real-browser work must follow the [live-browser verification runbook](docs/live-browser-verification.md)
and be recorded in a copy of the [verification report template](docs/verification-report-template.md).
The committed report defaults to **Not run**. Automated success is not evidence that
the extension is release-ready.

Tests use injected fake page/browser facades and do not contact X, Twitter, or any other
external service. Production composition is not live-X certification and performs no
real user-facing or external action during tests.

## Current limitations

- Live X selectors remain unverified until a completed real-browser report exists.
- Live GraphQL request shapes remain unverified until a completed report exists.
- Live header and authorization availability remain unverified until a completed report exists.
- The extension may remain inactive until X makes an eligible request.
- X interface changes may break discovery or capture.
- Live Chrome and Firefox behavior remains unverified until a real report is completed.
- Release assets remain unsigned testing packages rather than browser-store releases.
- Passing automated checks alone does not make the extension release-ready.
