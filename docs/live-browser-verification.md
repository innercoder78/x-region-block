# Live-browser verification runbook

This runbook produces sanitized evidence for an unpacked Chrome and Firefox build. It
does not turn automated success into a claim about live X behavior.

## Evidence classifications

- **Automated verification:** deterministic local commands and their results.
- **Manual browser verification:** an action performed in a named browser/build.
- **Live X observation:** behavior directly observed on X or Twitter; record only a
  sanitized structural description.
- **Inference:** a conclusion not directly observed, explicitly labelled as such.
- **Not tested / not observed:** work not performed or an outcome for which no suitable
  account appeared. Neither is a pass.

Copy [the verification report template](verification-report-template.md) before testing.
Never paste authorization headers, CSRF tokens, cookies, complete request URLs, full
query parameters, or private account information into issues or pull requests. Record
only sanitized structural observations. Do not test destructive actions or modify real
X account settings or content.

## Automated verification

1. Record the commit SHA with `git rev-parse HEAD`.
2. Install exact dependencies with `npm ci --ignore-scripts --no-audit --no-fund`.
3. Run `npm run verify:release`. This lints, tests, builds both browsers, validates the
   builds, and performs the release audit without contacting X.
4. Copy command outcomes to the report. Automated checks cover repository contracts,
   synthetic integration behavior, manifests, generated assets, and static privacy and
   release invariants only.

## Installation and startup

Perform every step separately in exact-version Chrome and Firefox and record evidence.

- [ ] Confirm `dist/chrome` and `dist/firefox` were freshly built from the recorded SHA.
- [ ] Chrome: open `chrome://extensions`, enable Developer mode, choose **Load
  unpacked**, and select `dist/chrome` (not `dist` or a source directory).
- [ ] Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
  Add-on**, and select `dist/firefox/manifest.json`.
- [ ] On a supported `https://x.com/` or `https://twitter.com/` document, use browser
  developer tools to confirm the isolated content bundle and injected page bundle
  start. Do not expose request details in screenshots or logs.
- [ ] When no valid snapshot has appeared, confirm the extension is active but not
  ready and has not processed account surfaces.
- [ ] Confirm readiness begins only after an eligible `UserByScreenName` request is
  observed and validated. Record only that the structural event occurred.

## X surfaces and dynamic behavior

For each row in the report, visit a representative, non-destructive example. Record
`Observed`, `Not observed`, `Failed`, or `Not tested`, whether current selectors matched,
and sanitized notes. Check Home timeline, Explore, profile posts, profile replies,
profile media, status/reply pages, search results, and notifications. Then verify
dynamically loaded timeline items; `pushState` and `replaceState` navigation; browser
back and forward; and removal and replacement of account surfaces.

Conservative selector and ambiguity rules are intentional. Do not weaken them merely
to increase match counts. A missed or ambiguous target must be recorded as evidence.

## Location outcomes

Record direct behavior for a known country, known region enrichment, hidden location,
missing location, unavailable location, and unknown/unrecognized location. Use `Not
observed` if no suitable live account appears; this is not a pass and must remain an
unresolved limitation.

## Filtering and precedence

Using reversible extension settings only, verify and record country hide, country
highlight, region hide, region highlight, the always-show country exception, account
allowlist, and existing show/highlight/hide precedence. Confirm badges remain visible
where required, setting changes clean up prior presentation, and country, region,
unknown-location, and exception behavior is unchanged. Restore the original settings.

## Settings and migration

- [ ] Existing stored settings load; current defaults remain correct for a clean profile.
- [ ] Settings persist after a browser restart and changes propagate to active X pages.
- [ ] Existing schema migration produces the expected current settings.
- [ ] Storage inspection shows no request metadata, account data, payload, parsed
  location, token, or authorization material. Do not record values.

## Privacy and lifecycle

Verify structurally, without recording secrets:

- [ ] No hardcoded query ID or authorization material is present.
- [ ] Page capture does not intercept request or response bodies.
- [ ] Metadata transfer adds no runtime messaging and no external service receives it.
- [ ] Stop clears metadata and account-location work; no cache remains.
- [ ] Normal unload stops owned components; persisted back-forward-cache `pagehide`
  follows the documented preservation policy.
- [ ] Fetch and History wrappers are restored when ownership can be proven.
- [ ] Reload or reinjection produces no duplicate wrappers.

## Completion rules

Separate observations, inferences, and items not tested in the report. A browser or
surface not exercised is `Not run` or `Incomplete`; missing outcome accounts are `Not
observed`. Use `Passed with limitations` only when the performed checks passed and all
limitations and unresolved risks are explicit. Automated success alone never means the
extension is release-ready.
