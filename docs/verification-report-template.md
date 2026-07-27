# Live-browser verification report

> Copy this file for a real verification run. Do not replace placeholders with
> fabricated observations. Follow the [runbook](live-browser-verification.md) and keep
> all evidence sanitized.

## Test identity

- Commit SHA tested: `NOT RECORDED`
- Browser name and exact version: `NOT RECORDED`
- Operating system: `NOT RECORDED`
- Extension build directory: `NOT RECORDED`
- Date tested: `NOT RECORDED`

## Automated command results

| Command | Result | Sanitized notes |
| --- | --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Not run | |
| `npm run verify:release` | Not run | |

## Installation and startup results

| Check | Chrome | Firefox | Evidence classification / sanitized notes |
| --- | --- | --- | --- |
| Correct unpacked directory loaded | Not run | Not run | |
| Content and page scripts start | Not run | Not run | |
| Active but not ready before snapshot | Not run | Not run | |
| Ready only after eligible request | Not run | Not run | |

## Per-surface results

| Surface or dynamic behavior | Result | Selectors match? | Sanitized observation |
| --- | --- | --- | --- |
| Home timeline | Not run | Not observed | |
| Explore | Not run | Not observed | |
| Profile posts / replies / media | Not run | Not observed | |
| Status and reply pages | Not run | Not observed | |
| Search results | Not run | Not observed | |
| Notifications | Not run | Not observed | |
| Dynamically loaded timeline content | Not run | Not observed | |
| `pushState`, `replaceState`, back, forward | Not run | Not observed | |
| Removed and replaced account surfaces | Not run | Not observed | |

## Location-outcome results

| Outcome | Result (`Not observed` is not a pass) | Sanitized observation |
| --- | --- | --- |
| Known country | Not observed | |
| Known region enrichment | Not observed | |
| Hidden location | Not observed | |
| Missing location | Not observed | |
| Unavailable location | Not observed | |
| Unknown/unrecognized location | Not observed | |

## Filter-precedence results

| Country hide/highlight; region hide/highlight; always-show; allowlist; precedence; badge visibility; reversible cleanup; unchanged outcome behavior | Result | Sanitized notes |
| --- | --- | --- |
| Complete matrix | Not run | |

## Settings/migration results

| Existing settings; defaults; restart persistence; active-page propagation; migration; storage privacy | Result | Sanitized notes |
| --- | --- | --- |
| Complete matrix | Not run | |

## Privacy/lifecycle results

| Hardcoded material; body interception; messaging/external transfer; stop cleanup; unload/BFCache; wrapper restoration; duplicate wrappers | Result | Sanitized notes |
| --- | --- | --- |
| Complete matrix | Not run | |

## Sanitized defects found

- None recorded; testing has not run.

## Explicit unresolved risks

- Live Chrome, Firefox, selectors, GraphQL shapes, and header availability are unverified.
- Add every not-tested or not-observed item from this run.

## Inferences and items not tested

- Inferences: None recorded.
- Items not tested: All manual verification items.

## Final status

**Not run**

Allowed values: **Not run**, **Incomplete**, **Passed with limitations**, or **Failed**.
