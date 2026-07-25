# X Region Reveal & Block

This repository currently contains the development foundation for a browser
extension. Account lookup, location display, blocking, and settings are not yet
implemented.

## Development

Install dependencies with `npm ci`, then run the complete validation suite:

```sh
npm run check
```

Individual commands are available for linting (`npm run lint`), testing
(`npm test`), and building unpacked Chrome and Firefox extensions
(`npm run build:chrome` and `npm run build:firefox`). Generated extensions are
written to `dist/chrome` and `dist/firefox`.
