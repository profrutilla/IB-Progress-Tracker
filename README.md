# IB-Progress-Tracker

IB Program Tracker

The whole app is `index.html`: markup, styles and one inline `<script>` holding
all of the logic. Open the file in a browser (or the deployed GitHub Pages site)
to use it.

## Tests

The suite loads `index.html` into jsdom with stubs for the CDN dependencies
(Tailwind, Lucide) and fakes for Firebase Auth/Firestore, then exercises the
inline script's functions directly.

```bash
npm install
npm test        # run the unit tests
npm run coverage # run the tests and print index.html function coverage
```

`npm run coverage` reports which top-level functions of the inline script were
executed — file-based coverage tools cannot instrument an inline `<script>`, so
the harness records the functions invoked instead.

Tests live in `tests/`; `tests/harness.mjs` owns the jsdom bootstrap, the
Firebase fakes and the helpers used to sign a fake user in.
