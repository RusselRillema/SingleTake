# Compatibility and scope — SingleTake 0.1.0

## Read this first


The recorded validation consists of 35 Node geometry/document/format tests and 10 DOM/controller checks. **All native WebGPU execution remains unverified in this environment:** browser navigation is blocked by managed policy. Shader compilation, pipeline validation, visual correctness, picking readback, texture appearance, and actual GPU performance need the separate real-browser acceptance run.

## Renderer

| Area | Implemented | Boundaries / validation |
|---|---|---|
| Native WebGPU | WGSL, explicit pipelines and bind groups, indexed vertex/index buffers, storage-buffer instance transforms | No third-party rendering library; no WebGL fallback; requires a usable adapter |
| Performance architecture | Shared mesh buffers, material/geometry batching, CPU frustum culling, camera-relative origins, mesh caching, on-demand frames | Not GPU-driven indirect rendering; no compute culling, occlusion culling, LOD, meshlets, progressive streaming, or recorded FPS benchmark |
| Shading | Double-sided lit polygons, scalar roughness/metallic response, hemisphere ambient lighting, exposure/tone mapping | Not a full glTF PBR material implementation; no environment-map IBL, normal/AO/emissive maps, or path tracing |
| Textures | Embedded or selected local base-color images, sRGB upload, mipmaps, anisotropic sampling | Image dimensions capped at 4096 for upload; no KTX2/Basis compression or texture-residency manager |
| Antialiasing | 4× MSAA | No TAA, accumulation, or configurable sample count |
| Shadows | One 2048×2048 directional shadow map, 3×3 PCF, clipping-aware shadow fragments | No cascades, point/spot shadows, ray-traced shadows, or transparent-shadow transmission |
| Transparency | Separate blended pass with object-distance sorting | Not order-independent; intersecting or concave transparent geometry can sort incorrectly |
| Sectioning | One axis-aligned movable/flippable clipping plane, applied to faces, edges, picking, and shadows | No section caps, hatch fill, multiple simultaneous planes, or oblique interactive section controls |
| Selection | Integer GPU object-picking pass, CPU per-mesh BVH face intersections, line-only screen picking | Marquee selects projected object centers, not exact intersecting silhouettes; loose lines inside mixed meshes are best selected via Outliner |
| Precision | Float64 model math and local float32 GPU buffers with rebased world origins | Huge coordinates inside a single mesh still lose GPU precision; not an exact-arithmetic geometry kernel |
| Diagnostics | Draw/triangle counts, CPU encode duration, optional actual GPU timestamps, errors and device loss reporting | On-demand frame intervals are not a stable benchmark; no unsupported “60 FPS” claim |
| Capture | GPU texture readback to PNG | Captures the 3D viewport; SVG selection guides and dimension labels are not composited into the PNG |

## Modeling and workspace

| Area | Implemented | Boundaries |
|---|---|---|
| Polygon geometry | Vertices, ordered face loops and holes, edges, material references, source IDs, triangulation | Mesh/polygon representation, not full persistent half-edge or analytic boundary-representation topology |
| Drawing | Rectangle, circle, polyline/closed polygon, three-point arc, box, sphere | Circles/arcs are segmented; new drawings do not automatically intersect, weld, split, or heal other geometry |
| Push/pull | Face extrusion, side-wall generation including holes, connected-cap extension, restricted negative cap shortening | No collision stopping, automatic through-hole cutting, overlapping-solid healing, or arbitrary pocket-solving |
| Offset | Positive inset of one boundary, producing an inner face and surrounding ring | No outward offset, multiple input boundaries, or general robust offset of all concave polygons; invalid/collapsed cases reject |
| Sweep | Rectangular profile swept through an explicitly entered 3D path | Not a general Follow Me tool for arbitrary profiles, self-intersections, or all corner joins |
| Solid tools | Worker-based BSP union, difference, intersection | Closed manifold inputs; 16,000 input-triangle cap; bounded BSP depth; floating-point tolerances, not exact predicates; challenging coincident/sliver geometry can fail |
| Topology tools | Weld, triangulate, reverse/delete face, vertex-coordinate edits, basic edge/manifold statistics | No general edge-split/dissolve, intersect-with-model, automatic face creation across old geometry, retopology, chamfer, fillet, subdivision, NURBS, or terrain/Sandbox toolset |
| Transforms | Numeric and pointer move/rotate/scale, axis locks, parent-aware transforms, duplicate/copy/paste | No constraint solver, drag handles on every topology element, or broad parametric editing history |
| Groups/components | Hierarchy, shared mesh instances, group/ungroup, component marking, Make unique | Shared mesh edits propagate; group-level “component” marking is not a full reusable component-definition system with dynamic behavior |
| Materials | Color, opacity, roughness, metalness, embedded base-color image, paint/sample, per-face material | No interactive UV pins, projection editor, multi-channel physically based material stack, or distinct front/back material rendering |
| Tags/views | Object/tag visibility, tags, saved cameras with section/tag state, perspective/orthographic modes | Imported SKP scene-page semantics are not recovered; no scene animation or per-scene full style/shadow-state fidelity |
| Editing safety | 100-entry undo/redo history, copy-on-write geometry, operation cancellation, explicit errors | History is memory-based and not persisted across restarts; no collaborative transactions or branch history |
| Persistence | `.take` downloads, browser-local IndexedDB recovery, reopen/import into scene | Browser recovery can be lost; no cloud sync, account system, or file-system autosave to the original input |
| Input/access | Keyboard shortcuts, searchable commands, native controls, responsive panels | Primarily mouse/keyboard desktop UI; full keyboard-only 3D navigation, touch gestures and accessibility audit are not complete |

## Import and export formats

| Format | Import | Export | Limits |
|---|---|---|---|
| GLB / glTF 2.0 | Uncompressed mesh geometry, hierarchy, shared meshes, base color, UVs/normals, local or embedded images, sparse/strided accessors, selected primitive modes | Self-contained binary GLB, with shared geometry, node hierarchy, materials, textures and loose lines | Required extensions are rejected; no Draco/Meshopt/KTX2, skinning, morph evaluation, or animation; optional material features may be approximated with warnings |
| OBJ / MTL | Meshes, negative indices, UVs/normals, polygons, lines, basic MTL colors/opacity/base-color textures | ZIP with OBJ, MTL, and textures | Select all companion files together; hierarchy/material semantics are simplified; not every MTL option is implemented |
| STL | Binary and ASCII triangles | Binary triangles | No native units, colors, instances or materials; import unit setting matters; output uses meters |
| PLY | ASCII and both binary endian forms; polygon/vertex geometry and basic color handling | ASCII triangles with RGB | Vertex colors approximated by a bounded face-color palette; not a general point-cloud renderer or complete arbitrary-property preservation |
| DXF | ASCII 3DFACE, LINE, and straight polyline-oriented subset | 3DFACE/LINE geometry, meters, Z-up | **Not full AutoCAD compatibility**; no DWG, ACIS solids, blocks/INSERT expansion, bulges/splines, annotations, or general CAD curves |
| SingleTake `.take` | Native project including embedded bytes | Native project | JSON-based, readable but larger than compressed formats; preserves this application's data, not unparsed source-SKP metadata |
| PNG | Material image use where decodable | Viewport snapshot | Not a model/interchange format; no SVG UI overlay capture |
| IFC / DWG / STEP / IGES / 3DM / USD | **No** | **No** | No parsers/writers or licensed conversion bridge are included |


## SKP details

The parser checks the VFF header, reads the embedded ZIP, validates supported ZIP records/CRC, walks bounded TLV records, resolves definition/instance references, reconstructs face loops from source edges, and triangulates those loops. It retains source geometry rather than treating the embedded thumbnail as the model.

Implemented recovery includes local vertices, face boundaries/holes, edge visibility and soft/smooth flags, nested transforms, instance-level material inheritance, tags, embedded material textures, default UVs, and a positioned-texture mapping path. Inches/Z-up are converted to meters/Y-up. Definitions remain shared rather than being flattened for every placement.

**Not recovered faithfully:** pre-2021 MFC containers; per-tag visibility in the modern format; SKP saved scenes and original dimensions; dynamic-component scripts or formulas; extensions and opaque attribute semantics; all projected/colorized/photo-matched texture behavior; distinct back-face materials; full style/section/geolocation metadata. Source hidden entities and edges are distinguished where their records are understood, but this is not an exact source-application visibility reconstruction.


## Performance and production readiness

The renderer has performance-oriented mechanisms, but **“very fast” is a goal, not a measured result of this build**. Import parsing, CPU triangulation/BVH construction, large transparent scenes, shadow redraws, material count, and driver behavior can dominate. Rendering is demand-driven; idle FPS is intentionally not a meaningful metric. A production release would require real-device acceptance, representative large-file benchmarks, fuzzing, visual regression against reference models, GPU memory/resource stress tests, and a broader geometry corpus.
