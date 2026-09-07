# Testing SingleTake

## Local checks

```sh
npm test
npm run check
npm run audit
```

The Node suite covers geometry, documents, exchange, normals, modifiers, connected/window selection, groups/components, tags, inference, camera anchors, planar chords, material-safe clipboard behavior, stale-operation protection, naming policy checks and deterministic static packaging.

Four private-model tests are skipped unless an external fixture is supplied:

```sh
SINGLETAKE_MODEL_FIXTURE=/absolute/private/path/model.skp npm test
```

On PowerShell, set `$env:SINGLETAKE_MODEL_FIXTURE` to the absolute path before running `npm test`. `SINGLETAKE_IMPORT_REPORT` optionally writes a report outside the repository. Never commit a private fixture or its extracted assets.

## DOM/controller acceptance

With optional Python Playwright and a local Chromium executable:

```sh
python tools/ui-smoke.py
```

This injects local modules into a DOM and invokes real application controllers. It checks dialogs, geometry creation, outliner/history, connected selection, edit contexts, precise push/pull amendments, keyboard dispatch, tag reassignment, clipboard remapping and the SVG orientation widget. It does **not** initialize WebGPU. Reports/screenshots go to ignored `test-results/`.

## Real GPU acceptance

Start `npm start`, then run:

```sh
python tools/browser-check.py --chromium /path/to/browser --headed
```

The test navigates normally, initializes an adapter, creates a solid, exercises axes/back edges/styles/clipping, reads a pick and captures PNG. Browser policies, GPU blocklists and security settings are not changed. Blocked navigation or unavailable WebGPU yields NOT_RUN (exit 2), not PASS. Runtime validation failures yield FAIL.

## Recorded development result

The submitted private-model run passed all 77 CPU tests. The normal public run passed 73 and skipped its four private-fixture tests. All 17 DOM/controller checks passed with no page errors. Browser navigation returned `ERR_BLOCKED_BY_ADMINISTRATOR`; actual GPU execution and performance remain unverified. These are development results, not a substitute for target-device acceptance.

See `VALIDATION.json` for machine-readable scope. The naming audit checks a defined fingerprint policy; adding third-party assets or libraries requires a fresh review.
