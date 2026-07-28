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
active but not ready until X makes an eligible GraphQL request with usable authentication metadata. Invalid
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

Request query IDs, permitted headers, and authorization material stay
in memory. The extension does not read `document.cookie`, use runtime messaging, or
persist accounts, payloads, parsed locations, queries, headers, or authorization
material. It bundles one centralized, replaceable About Account persisted-query ID as
a fallback because X's web client may change it; the capture prefers a valid ID observed
from a live `AboutAccountQuery`. It contains no hardcoded authentication token, bearer
token, CSRF token, guest token, transaction ID, feature snapshot, or field-toggle snapshot. It does not poll and does
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

Known countries are presented with the bundled local Flagpedia PNG files already committed in
this repository; no country flag is downloaded while browsing X. The source images are 20 pixels
wide and retain their original aspect ratios, including unusually shaped flags, while CSS contains
each image in an approximately 16×12 CSS-pixel presentation box. Regions continue to use the
Unicode globe (`🌐`) followed by region text.

Settings are stored through the extension's established local-storage adapters. No
other production data uses extension storage. Chrome and Firefox manifests request only
the `storage` permission, request no host permissions, and expose only the page runtime
(`page/page-script.js`) and local flag pattern (`assets/flags/*.png`) to the existing X and
Twitter match patterns.

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
payload or parsed-location cache. One runtime-wide FIFO scheduler permits at most four
requests in flight and spaces starts by at least 200 milliseconds. A 429 applies one
global, bounded cooldown (60 seconds when numeric timing headers are unusable) and one
retry; network and 5xx failures retry after one and two seconds. Authentication or query
rejections receive one retry with fresh metadata. Cancellation remains effective while
queued, delayed, or in flight.

The page capture passively observes eligible same-origin GraphQL GETs made with fetch or
XMLHttpRequest without modifying them or reading bodies or responses. Generic traffic
provides authentication headers; a live `AboutAccountQuery` also refreshes the query ID.
The isolated world sends only a protocol version, opaque request ID, and canonical handle
as bounded JSON strings over exact same-document event schemas; cancellation and response
details are strings as well, so neither side depends on cross-realm object prototypes. The
MAIN-world executor constructs the canonical
same-origin URL and closed header set from its private metadata snapshot and calls the
original page fetch. Responses are bounded and revalidated by the isolated bridge. The
scheduler receives only the validated bridge's generation, query ID, and opaque authentication
fingerprint. Authentication or query rejection globally invalidates the corresponding private
page snapshot and pauses work until the first genuinely changed validated state. A 30-second
bridge-response timeout cancels the page attempt and releases its scheduler slot.
Normal empty discovery at `document_start` is informational: mutation discovery remains
active. Diagnostics distinguish discovery, bridge, metadata, queue/HTTP, parsing,
presentation, route, and cleanup categories without recording identities or request data.
Automated tests do not prove behavior against live X; Chrome and Firefox must be retested.

## Download and install

The standard GitHub **Code → Download ZIP** archive contains ready-built Chrome and
Firefox layouts. Users and testers need no Node.js, npm commands, Actions artifacts,
or release downloads.

### Chrome

1. Choose **Code → Download ZIP** on GitHub.
2. Extract the ZIP.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked**.
6. Select the extracted top-level repository folder containing `manifest.json`.

### Firefox testing

1. Choose **Code → Download ZIP** on GitHub.
2. Extract the ZIP.
3. Open `about:debugging#/runtime/this-firefox`.
4. Choose **Load Temporary Add-on**.
5. Select `firefox/manifest.json` from the extracted repository.
6. Remember that this temporary installation ends when Firefox closes. Normal
   permanent distribution will require a signed Firefox package.

## Development

Install exact dependencies and run the full validation suite:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Individual commands are available as `npm run lint`, `npm test`, `npm run build`, and
`npm run validate:build`. Generated intermediate builds are written beneath ignored
`dist/`. After validating them, maintainers use `npm run sync:code-download` to update
the committed root Chrome layout and `firefox/` layout, and
`npm run verify:code-download` to freshly build and compare every byte.

Maintainers can reproduce the downloadable archives and checksums with
`npm run package:release`, then inspect them with `npm run verify:packages`. Generated
packages are written beneath ignored `artifacts/` and are not committed.
These smaller browser-only Release packages remain an optional distribution method;
the standard Code ZIP is directly installable without them.

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
Automated tests do not verify visual appearance on the live X website.

## Current limitations

- Live X selectors remain unverified until a completed real-browser report exists.
- Live GraphQL request shapes remain unverified until a completed report exists.
- Live header and authorization availability remain unverified until a completed report exists.
- The extension may remain inactive until X makes an eligible request.
- X interface changes may break discovery or capture.
- Live Chrome and Firefox behavior remains unverified until a real report is completed.
- Release assets remain unsigned testing packages rather than browser-store releases.
- Passing automated checks alone does not make the extension release-ready.
