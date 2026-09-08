# SingleTake architecture

## Document and geometry

`src/core/document.js` owns a versioned native document: immutable meshes, parent-relative placed nodes, materials, tags/folders, guides, static measurements, scenes and clipping state. Transactions copy metadata and replace edited meshes. Undo retains before/after states; precise amendments rebuild from the immediately preceding operation's before-state.

The modeling frame is right-handed and Z-up. `coordinates.js` converts it to the renderer's Y-up frame. CPU editing uses double-precision numbers; GPU data uses camera-relative float coordinates.

`geometry/topology.js` caches adjacency per immutable mesh. Faces refer to ordered vertex loops and holes. Soft edges join surfaces, and graph traversal separates connected islands from unrelated geometry sharing one resource. Raw merges weld positions, split supported planar chords and form interior loops. They do not imply a general exact intersection kernel.

Groups isolate edits and duplicate with independent raw resources. Components share resources. `core/components.js` mirrors structural edits in an active definition to other placements while retaining external placement transforms. Tags are visibility attributes, not containers; parent tags and folder visibility both affect effective scene state.

## Interaction

`ui/shortcuts.js` is the shortcut source of truth. `ui/tools.js` manages pending operations, pointer gestures, temporary navigation, numeric inputs and previews. `ui/model-interactions.js` integrates context selection, topology edits, container semantics, tags and DOM panels into the application shell.

`ui/inference.js` caches visible scene features in screen-space buckets. Edge interpolation is perspective-correct; CPU ray hits reject obscured candidates. Document/camera changes invalidate the cache. This is bounded geometric inference, not a symbolic constraint solver.

Push/Pull projects a transformed viewer-facing face normal into screen space. Drag displacement along that projection is converted back to a local displacement vector. Valid complete caps move existing shared vertices; other faces gain side walls and a cap. Invalid collapse or nonplanar edits reject. Arbitrary solid-intersection healing is not silently inferred.

## WebGPU

`render/renderer.js` owns the adapter/device, indexed mesh buffers, object/instance storage, materials, uniforms and pipelines. Mesh resources are baked and accelerated once. Render plans batch visible placements by geometry/material; CPU frustum tests reject off-screen bounds. Frames are requested on demand.

Opaque meshes precede sorted transparent batches. Four-sample MSAA and depth testing support the main pass. A directional depth pass supplies shadows. Separate native pipelines draw edges, dashed obscured edges and XYZ world-origin axes. Preview meshes are temporary resources, not mutations of committed document data. Surrounding objects can fade while editing a context.

`render/shaders.js` contains WGSL. Integer GPU picking identifies objects; CPU BVHs return precise source faces. Capture maps a copied GPU texture and encodes PNG. Errors/device loss are surfaced explicitly. Optional device timestamp queries report actual GPU durations only when available.

## Files and persistence

Imports run in a module worker. The VFF reader checks supported ZIP records/CRC, walks bounded binary records, reconstructs face loops, resolves nested placements and converts units. It does not substitute thumbnails for geometry. No native SDK or conversion service is bundled.

GLB retains shared meshes; formats without hierarchy flatten visible placements. Native files preserve the application document and encoded assets. IndexedDB provides recovery, not archival backup. The application does not upload selected files.

## Validation boundaries

CPU tests check geometry, document transactions, transforms, selection, snapping, tags, components and exchange round-trips. DOM tests run actual controllers without initializing WebGPU. The separate real-browser test reports NOT_RUN when a GPU is unavailable or navigation is policy-blocked. CPU/DOM passes do not establish rendered correctness or performance.


## Shared web/native application shell

`src/app.js` is the single controller; `src/main.js` is only the browser bootstrap.
`src/platform/browser.js` and `desktop/shared/native-platform.js` provide renderer,
I/O and recovery services. Desktop generation consumes the root HTML/CSS unchanged
except for substituting the bootstrap script with component lifecycle mounting.
The C# window composes a noninteractive GPU control beneath the full-window WebScene
host; the original DOM canvas and SVG overlays own all interaction coordinates.
No separate native UI or input-command implementation is maintained.
