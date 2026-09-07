# Architecture

## Overview

```
    → import-worker.js → format parser → native project
    → Document (undoable state and hierarchy)
    → mesh triangulation + per-mesh BVH
    → Renderer (GPU buffers, instances, materials, frame planning)
    → WebGPU passes → viewport

Pointer / keyboard / inspector / command palette
    → Tools / App → Document transaction → changed meshes + transforms
    → renderer update + panels + browser-local recovery

Native project → format writers → downloaded Blob
```

The application is plain HTML, CSS and JavaScript ES modules. `server.mjs` is a small local-only static server, not a modeling or conversion backend. All asset processing is performed in the browser. There is no runtime dependency installer or network service.

## Code map

| Module | Responsibility |
|---|---|
| `src/app.js` | Application lifecycle, inspector/outliner/materials/scenes, commands, selection, dialogs and exports |
| `src/ui/tools.js` | Pointer gestures, drawing state machines, inference, numeric input, operation previews and SVG overlays |
| `src/core/document.js` | Native project structure, hierarchy resolution, validation, copy-on-write transactions and undo/redo |
| `src/core/math.js` | Float64 vector/matrix math, coordinate conversions, camera/frustum helpers, bounds and units |
| `src/geometry/triangulate.js` | Planar loop projection, hole handling and polygon triangulation |
| `src/geometry/mesh.js` | Mesh creation, manipulation, extrusion/inset/sweep, topology metrics, smoothing and render baking |
| `src/geometry/bvh.js` | Per-mesh CPU acceleration structure for face intersection |
| `src/geometry/csg.js` | Tolerance-based BSP Boolean solids and result stitching |
| `src/render/camera.js` | Camera state, perspective/parallel projection, orbit/pan/zoom and projection/ray conversion |
| `src/render/renderer.js` | WebGPU lifecycle, resource caches, batching, culling, passes, picking, PNG and diagnostics |
| `src/render/shaders.js` | WGSL lighting, shadows, edges, clipping, picking and grid logic |
| `src/importers/skp.js` | Modern VFF/ZIP SKP parsing and native-project reconstruction |
| `src/importers/formats.js` | GLB/glTF, OBJ/MTL, STL, PLY, DXF and native-project readers |
| `src/exporters/formats.js` | GLB, OBJ ZIP, STL, PLY, DXF and native-project writers |
| `src/io/zip.js` | ZIP entry handling, compression/decompression plumbing and CRC |
| `src/io/import-worker.js` | Isolated import job, progress and transfer of input ArrayBuffers |
| `src/io/operation-worker.js` | Isolated Boolean operation job |
| `src/io/persistence.js` | IndexedDB workspace storage |

## Native model

Coordinates are JavaScript numbers in **meters, Y-up**. Matrices are 16-number, column-major affine transforms. A project stores meshes by ID and a separate hierarchy of nodes. Each node has an optional mesh reference, parent ID, local matrix, name, tag, material override, visibility and lock state. Multiple nodes can refer to one mesh; editing the shared mesh changes its placements.

A mesh contains vertex triplets, ordered face loops and optional hole loops, explicit source edges, and a revision. Faces can contain material references, normals, per-loop UVs, optional corner normals, hidden flags and source tags. Triangles are a derived rendering/export representation, not the only editable representation.

Materials contain normalized sRGB color/opacity, scalar roughness/metalness, and an optional texture with embedded typed bytes. Source import reports are retained as metadata. Tags, camera views, static measurements and section settings are first-class project data. `.take` serialization represents byte arrays explicitly in JSON; there is no compact proprietary binary native format.

## State and transactions

`Document.transaction(label, fn)` creates a new state snapshot. Nodes and mutable metadata are copied; mesh data is shared until a geometry operation replaces that mesh with a clone. This avoids cloning every vertex in a large imported model for a simple transform. The undo stack is capped at 100 snapshots. Older snapshots retain referenced mesh/material payloads until released, so extensive edits can still consume significant memory.

Preview transforms are renderer state, not committed project edits. A tool accepts its final value and commits one transaction. Boolean operations run in a worker and have a revision guard so a stale worker result does not silently overwrite intervening changes. Canceling a load terminates its worker. New drawings form separate mesh objects; a future full topology-editing kernel would need to add cross-object intersections, split/heal invariants and robust adjacency operations.

## Rendering path

Mesh baking produces 32-byte vertices: position `float32x3`, normal `float32x3`, UV `float32x2`, plus uint32 indices grouped by material/tag. Per-mesh CPU BVHs use the baked triangle-to-source-face mapping. Edge buffers distinguish visible source/topological edges from a full wire representation. Existing GPU buffers are reused while their source mesh object is unchanged, and obsolete buffers/textures are explicitly destroyed.

Each frame resolves visible scene instances and transformed bounds, derives a camera-relative origin, and culls on the CPU. Instanced draw commands share geometry and material buffers. Instance matrices and draw-to-instance lookup data live in storage buffers. Opaque groups are batched; transparent groups sort by object distance. Device storage-buffer and texture-size limits are checked, but this is not an out-of-core scene streamer.

Passes include a directional depth shadow map, opaque and blended MSAA shading, and overlaid depth-tested edges. A separate integer ID target supports object picking; a CPU BVH refines face selection in local mesh space. Texture mips are generated with a small GPU render pipeline. Section tests are applied in the appropriate shaders and CPU hit tests. Section surfaces are not capped.

The renderer schedules frames on demand. Diagnostics distinguish CPU command-encoding duration from optional GPU timestamp-query duration. PNG capture copies the presentation texture into an aligned readback buffer before mapping it; it does not capture the separate DOM/SVG annotation layers. Device loss is surfaced to the interface and can be retried by saving recovery data and reloading.

## Import flow and limits

Input bytes transfer to an import worker so parsing does not run on the UI thread. The returned project is structured-cloned; mesh baking/BVH construction and GPU upload currently occur on the main thread and can cause a startup pause. A future performance pass should move more triangulation/BVH work to workers, build a bounded upload queue, and profile actual hardware before setting budgets.

SKP is read as a modern VFF container with an embedded ZIP and TLV geometry records. Component definitions remain shared, and nested transforms are converted by an inches/Z-up to meters/Y-up basis change. The reader recovers understood entities and reports known fidelity gaps. It is not the official SDK and does not retain opaque source data for a lossless native SKP save.

GLB/glTF external references resolve only against selected companion files or data URIs; the importer does not fetch arbitrary texture URLs. Unitless mesh formats use the workspace import-scale setting. Geometry exporters work from the native model; editor-only metadata survives only in the native format.

## Trust boundary

The static server listens on `127.0.0.1`, and uploaded filenames are not executable scripts. UI content is escaped, and output files are constructed as Blobs. Importers validate important lengths, references and numeric values, while complex algorithms have some explicit limits. Those checks are not a security audit. Huge or adversarial input may exhaust CPU/memory; ZIP decompression, XML-related metadata, triangulation and recursive scene/CSG processing deserve dedicated fuzzing before untrusted public deployment.
