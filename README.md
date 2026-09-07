# SingleTake

A local-first architectural modeler using plain HTML, CSS, JavaScript modules and a native WebGPU renderer. No required npm dependency, UI framework, external rendering engine or runtime CDN is used.

## Local run

Use Node.js 22 or newer, run `npm start`, and open `http://127.0.0.1:5173/`. A working WebGPU adapter is required for the viewport. Files stay on the device. The workspace starts empty and later restores browser-local recovery data.

## Development

Run `npm test` and `npm run check`. Private model tests require `SINGLETAKE_MODEL_FIXTURE` pointing to a model outside the repository; otherwise they are skipped. No model fixture is published.

This development build is not a claim of complete CAD parity or a measured performance guarantee. Native foreign-format writing, full lossless model round-trips, and exact geometry healing are not implemented. See the compatibility document and third-party notices.
