# SingleTake

A local-first 3D modeling workspace built with plain HTML, CSS and JavaScript modules, using a custom native WebGPU renderer. No UI framework, external rendering engine, runtime CDN, required npm dependency or server-side model converter is bundled.

## Run

Use Node.js 22 or newer:

```sh
npm start
```

Open `http://127.0.0.1:5173/`. Serve the app over localhost or HTTPS; opening `index.html` directly is unsupported. The viewport requires an available WebGPU adapter. An unavailable adapter produces an explicit error, not a simulated viewport.

The first workspace is empty, with red X, green Y and blue Z axes. Later launches recover the browser-local workspace. Open a local model with Ctrl+O, or drag the model and companion files into the viewport. No private example model or extracted asset is bundled.

## Model and navigate

Press **R**, click a corner, and enter `4m, 3m`. Press **P**, click the face, and enter `2.7m`. Space selects; M/Q/S move, rotate and scale. Shift+S opens Search; F1 opens the controls reference.

Middle-drag orbits, Shift+middle-drag pans, and scrolling zooms at the cursor. Right/Left/Up arrows lock X/Y/Z. Hold Shift to retain the current inference, and release it to unlock. Raw faces and edges connect within their editing context. Double-click a container to edit it; triple-click raw geometry to select its connected island. Tags control visibility rather than isolating geometry.

## Files

Read modern VFF-based `.skp`, uncompressed GLB/glTF, OBJ/MTL, STL, PLY, supported ASCII DXF, and native `.take` projects. Export `.take`, GLB, an OBJ/MTL/texture ZIP, binary STL, ASCII PLY, mesh/line DXF and viewport PNG. Native files preserve this application's editable document; exchange files preserve only their supported features.

**Native SKP writing, legacy SKP containers, IFC/DWG/STEP, complete dynamic components and an exact CAD topology kernel are not implemented.** Read the compatibility matrix before relying on an interchange workflow.

## Deploy

The repository includes a test-and-audit-gated GitHub Pages workflow. Run `npm run verify` before publishing; only the runtime files in `dist/` are deployed. See `docs/DEPLOYMENT.md` for bundle import, authenticated publication and the required initial Pages setting. The supplied commits are local while integration writes remain blocked; the presence of a workflow does not mean a site is live.

## Development

```sh
npm test
npm run check
npm run audit
npm run build
```

CPU tests do not require a GPU. Four optional private-model regressions require `SINGLETAKE_MODEL_FIXTURE` to point outside the repository. Optional browser tests separately distinguish DOM/controller behavior from real WebGPU execution. No private model fixture, external manual, extracted texture or font is distributed.

This is a development build, not a claim of complete commercial CAD parity or a measured performance guarantee. Actual GPU acceptance remains necessary on target devices.

[Deployment](docs/DEPLOYMENT.md) · [Controls](docs/CONTROLS.md) · [Architecture](docs/ARCHITECTURE.md) · [Compatibility](docs/COMPATIBILITY.md) · [Testing](docs/TESTING.md) · [Naming audit](docs/NAMING-AUDIT.md)

MIT licensed. Independent research attribution is retained in `THIRD_PARTY_NOTICES.md`. Review model and texture redistribution rights before publishing assets.
