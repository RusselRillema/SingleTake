# SingleTake compatibility

This matrix records implemented mechanisms and their limits. A control does not imply every commercial CAD workflow is supported. CPU/controller tests and real GPU execution are separate validation scopes.

## Rendering and interaction

| Area | Implemented | Boundary |
|---|---|---|
| Renderer | Native WebGPU; indexed buffers; shared instancing; material batching; camera-relative origins; CPU frustum culling; demand-driven frames | No WebGL fallback, GPU occlusion culling, automatic LOD, model streaming or measured FPS guarantee |
| Appearance | Four-sample MSAA, roughness/metallic shading, base textures/mipmaps, shadow map, transparency, clay/wire/X-ray modes | Not path tracing; transparency is sorted rather than order independent; no full environment-lighting stack |
| Edges/axes | Topological lines, dashed back edges, independent native XYZ world axes and orientation widget | Mixed-tag edge buffers do not have complete per-face visibility fidelity |
| Picking | CPU triangle BVHs with source-face identity and native integer GPU object-picking path | CPU scene traversal still visits instances; GPU execution needs device testing |
| Selection | Face/edge selection, soft surfaces, single/double/triple click, connected islands, group edit contexts, windows/lasso and modifiers | Large-scene behavior needs broader performance and visual testing |
| Snapping | Visible scene endpoints, midpoints, edges, circular/face centers, guides, occlusion checks, axis and held locks | No exhaustive tangent/intersection constraint solver; near-plane edge clipping and concave-face centers are limited |
| Navigation | Orbit, pan, cursor zoom, temporary middle-button controls, free orbit, recenter, presets and camera history | No full walk/collision controller; touch and keyboard-only accessibility are incomplete |
| Section/capture | Shader clipping and GPU PNG readback | No cut caps or exported cut solid; PNG omits SVG selection/measurement overlays |

## Geometry and workspace

| Area | Implemented | Boundary |
|---|---|---|
| Raw topology | Shared vertices, face loops/holes, adjacency, connected selection, coincident welding, planar boundary chords and interior host loops | Not an exact-predicate B-rep; arbitrary contour intersection/healing remains incomplete |
| Drawing | Line/closed polygon, rectangle, circle, two-point/bulge arc, boxes and spheres | Segmented curves; no full analytic-curve or arc-mode catalog |
| Push/Pull | Normal-based cursor motion, transformed instances, signed distance, cap extension/shortening, retained face, repetition and preview | No general collision stopping, automatic wall-through cuts, pocket solving or overlapping-solid healing |
| Offset | Signed inward/outward single-boundary planar offset | Multiple boundaries and difficult concave/collapsed cases are restricted |
| Transform | Pointer/numeric Move/Rotate/Scale, grips, copies/arrays, parent-aware transforms and selected-vertex deformation | Restricted auto-fold; no full constraint solver or parametric edit history |
| Erase | Face/edge removal, retained unselected edges, coplanar divider dissolve, hide/soften/unsoften | Not every nested-loop or nonmanifold dissolve is supported |
| Solid tools | Worker BSP union, difference and intersection | Closed manifold inputs, 16,000 input-triangle cap, bounded recursion and floating-point degeneracies |
| Sweep | Rectangular profiles along explicit 3D paths | Not arbitrary-profile sweep with all joins/self-intersection handling |
| Containers | Nested groups, shared components, independent group copies, active contexts, Make unique and structural synchronization | No complete dynamic formula engine or external component library |
| Tags | Permanent Untagged, multiple assignment, folders, inherited visibility, filtering, colors, reassignment and purge | Keep raw geometry Untagged; full line patterns and all imported metadata are not retained |
| Materials | Color, opacity, roughness, metallic, embedded images, face paint/sample | No texture-pin editor or independently rendered front/back materials |
| Measurements/views | Guides, static dimensions, area/volume, saved cameras and local photo-reference overlays | Not associative dimensions, automatic photo calibration, scene animation or drawing-sheet authoring |
| History/storage | Copy-on-write resources, 100-entry undo/redo, numeric amendment, native files, local IndexedDB recovery | Session-local history; browser recovery can be evicted; no cloud sync/collaboration/original-file overwrite |

## Exchange formats

| Format | Read | Write | Boundary |
|---|---|---|---|
| Native .take | Yes | Yes | JSON plus embedded bytes; not opaque foreign metadata preservation |
| Modern VFF SKP | Supported geometry, topology, definitions, instances, materials/UVs, edges and tags | No | Legacy containers, full scenes/dimensions/styles, dynamic formulas, geolocation and some texture projections are not recovered |
| GLB/glTF 2.0 | Uncompressed meshes, hierarchy, instancing, supported materials/images and sparse/strided accessors | Self-contained GLB | Unsupported required extensions reject; no Draco/Meshopt/KTX2, skinning, morph evaluation or animation |
| OBJ/MTL | Polygons, lines, negative indices, UVs and basic companion textures | OBJ/MTL/texture ZIP | Choose companions together; material/hierarchy semantics are simplified |
| STL | ASCII and binary triangles | Binary triangles, meters | No native unit metadata, material or hierarchy |
| PLY | ASCII and binary endian forms, basic face/vertex colors | ASCII triangles and RGB | Not a point-cloud renderer or arbitrary-property preservation |
| DXF | ASCII 3DFACE/LINE and straight-polyline subset | Mesh/line DXF, meters, Z-up | No DWG, ACIS solids, general blocks, splines, bulges or complete annotations |
| IFC/DWG/STEP/IGES/3DM/USD | No | No | No conversion bridge or proprietary SDK included |
| PNG | Textures/reference images | Viewport snapshot | Not model interchange |

## Production safety

No private model, extracted texture, thumbnail, manual or font is bundled. Imports process locally. File compatibility does not grant redistribution rights. Keep native-file backups; browser recovery is not archival storage.

This is a development build. Real-device GPU acceptance, broad malformed-file fuzzing, visual regressions and large-scene benchmarks remain necessary. Unsupported features are not reported as preserved.
