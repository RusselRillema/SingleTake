# SingleTake native desktop preview

## Delivery status

This adds a Rider-compatible `SingleTake.sln` and a package-based Avalonia desktop
implementation. It is **source integration work, not a verified native release**.

The shared JavaScript tests and static web build have been executed. The delivery
environment has no .NET SDK and cannot resolve the NuGet service from its container.
Consequently, NuGet restore, C# compilation, C# protocol tests, native UI execution,
GPU rendering, and self-contained native publishing have **not** been completed here.
Do not interpret a source ZIP, successful Node test, or configured workflow as a
working native executable.

The WebScene version is pinned to **1.0.33**, declared by the inspected upstream source.
Its publication, including the component host and all three runtime packages, has
not been established. Upstream explicitly warns that its current component-host
APIs may be newer than published packages. Run the online preflight before restoring.
If it cannot confirm the version, stop: obtain matching published NuGet packages
from the maintainer or a trusted package feed. Do not clone the upstream repository,
silently use an older API, or replace the host with a browser control.

## What runs where

```text
SingleTake.sln
  SingleTake.Desktop             C# / Avalonia native window
    WebSceneComponentHost       native V8 + DOM/CSS; packaged application UI
      native-entry.js           mount/unmount and ordered input delivery
      native-app.js             HTML/CSS panel and desktop services adapter
      existing src/*            shared JS geometry, tools, import/export, history
    NativeViewport              native OpenGL / GLES via Silk.NET
    OverlayCanvas               native inference, selection and dimension visuals
    NativeFiles                 platform file dialogs, bounded file I/O, DEFLATE
  SingleTake.Protocol           validated scene-delta contracts; no UI dependency
  SingleTake.Protocol.Tests     executable protocol/queue regression tests
```

The browser target still uses its existing WebGPU renderer. The desktop target does
**not** try to run `navigator.gpu` inside WebScene. It presents triangles, edges,
textures and instances through a native graphics control beside the WebScene UI.
The model, topology, tools, camera, picking, inference and file-format code remain
JavaScript. There is no duplicate C# geometry kernel.

This is browser-free native hosting, **not** static ahead-of-time compilation of
HTML, CSS and JavaScript. V8 executes JavaScript and .NET runs the C# host. `PublishAot`
and trimming are disabled; self-contained distribution includes its runtime. Node
is a build-time tool only: no Node process, HTTP server, WebView, Electron, CEF or
Chromium renderer is started by the application.

## Files added

| Path | Role |
| --- | --- |
| `SingleTake.sln` | Rider / Visual Studio entry point |
| `desktop/Directory.Build.props` | Central framework and dependency versions |
| `desktop/SingleTake.Desktop` | Native window, component host, rendering and file services |
| `desktop/SingleTake.Protocol` | Atomic scene validation and bounded input queue |
| `desktop/SingleTake.Protocol.Tests` | Dependency-light C# test executable |
| `desktop/shared` | Native JS facade and scene adapter importing the existing JS source |
| `tools/desktop-bundle.mjs` | Deterministic build-time packer for this repository's static JS modules |
| `tools/desktop-doctor.mjs` | Toolchain and exact NuGet-publication preflight |
| `tools/desktop-test-scene.mjs` | Synthetic shared-JS fixture for the C# protocol tests |
| `tools/desktop-package.mjs` | Real-publish inventory and available dependency notices |
| `.github/workflows/desktop.yml` | Separate three-platform native build workflow |
| `.run/SingleTake.Desktop.run.xml` | Rider run configuration |

The packer is deliberately limited to the static module syntax used here. It rejects
cycles, imports outside the repository, unsupported exports and dynamic imports.
It is not a general TypeScript transpiler. The native component's generated `main.js`
is ignored by Git and rebuilt from the shared sources; no vendored WebScene source
or generated copy of the modeling kernel is maintained in Git.

Two browser-source seams changed: BVH scene picking was extracted without changing
its behavior, and ZIP decoding gained an optional host-provided raw-DEFLATE hook.
The default browser decoder and browser GPU renderer remain in use on the web target.

## Supported package targets

| Operating system / CPU | Runtime identifier |
| --- | --- |
| Windows x64 | `win-x64` |
| Linux x64 | `linux-x64` |
| macOS Apple silicon | `osx-arm64` |

These are configured targets, not platforms proven by this delivery. Intel macOS,
Windows ARM64, Linux ARM64, mobile, and browser-WASM native hosts are not configured.
The project references exactly one matching runtime package for each explicit RID.
Unsupported RID selection fails rather than restoring several native libraries.

The native viewport requires a usable OpenGL/GLES context with instancing and
texture support. Platform GPU drivers and Avalonia's context sharing must work.
macOS is configured for Avalonia's OpenGL presenter; this preview is not a Metal
renderer. Core GLSL 1.50 and GLES 3.00 shaders are supplied. Actual driver compatibility
and performance must be tested on every advertised platform.

## Open and run in Rider on Windows

1. Put these files in your SingleTake working tree. Open `SingleTake.sln` in Rider.
   The existing web files remain at the repository root.
2. Install a .NET **10** SDK and Node.js **22+**. `global.json` accepts compatible
   .NET 10 feature bands. Node is required by the desktop build target but not by a
   published desktop executable. Restart Rider after changing PATH.
3. In Rider's terminal, from the repository root, run:

   ```powershell
   npm run desktop:doctor -- --online --rid=win-x64
   ```

   Continue only when the toolchain is found and `packagePublication` is
   `LISTED_ON_NUGET`. This checks listing, not successful restoration or API presence.
   If the configured version is unavailable, the source integration remains blocked
   until a compatible package set exists. Keep all WebScene versions aligned in
   `desktop/Directory.Build.props`; no repository checkout is required or used.
4. Restore and build explicitly:

   ```powershell
   dotnet restore desktop/SingleTake.Desktop/SingleTake.Desktop.csproj -r win-x64
   dotnet build desktop/SingleTake.Desktop/SingleTake.Desktop.csproj -c Debug -r win-x64 --no-restore
   ```

5. Select the `SingleTake.Desktop` run configuration in Rider and use Run or Debug.
   Alternatively:

   ```powershell
   dotnet run --project desktop/SingleTake.Desktop -r win-x64
   ```

The default RID follows the SDK host architecture. On a supported Linux or macOS
host, substitute `linux-x64` or `osx-arm64` in the commands. Do not use an ARM64 SDK
on Windows while expecting the default selection to produce the x64 native package.

Missing assets, component API differences, unsupported graphics or mount failures
produce visible errors. There is no browser fallback. A runtime failure should be
fixed against the pinned NuGet version, not hidden by loading the hosted website.

## Modeling and files

The first desktop workspace is empty with native world axes and a ground grid.
The HTML/CSS panel is adapted for the native host instead of loading the entire
browser application's DOM unchanged. It exposes modeling tools, measurements,
objects, material controls, tags, views and solid operations.

With the viewport focused, the existing Windows shortcut map, pointer navigation,
selection modes and inference locks run through the shared `Tools` and interaction
code. Native input is queued in order. Only adjacent motion/resize updates coalesce;
key transitions and button boundaries are retained. Actual OS focus, IME, clipboard,
repeat and capture behavior still need native acceptance testing.

Open uses the OS picker. For companion-file formats, select the model together with
its buffers, materials and textures. The native adapter supports the same available
parsers and data exporters as the browser core, with a bounded 128 MiB aggregate
file selection. ZIP decompression uses .NET's raw DEFLATE service while JS retains
entry-size and checksum validation. Imported content is model data, not executable
HTML or plug-ins. The private test model is not part of this distribution.

Save downloads are replaced by a native save picker. `.take` remains the editable
project format. Local saves use a temporary file and replacement; provider-backed
streams use the provider's write contract. No native auto-recovery or OS clipboard
integration is claimed. In-app copy/paste uses the shared model clipboard.

## Rendering coverage and limits

Implemented source includes indexed triangle/edge buffers, shared geometry and GPU
instanced drawing, cached textures with mipmaps, CPU BVH face picking, frustum
culling, camera-relative transforms, depth testing, approximate material shading,
clay/wire/X-ray views, selected/context tinting, section clipping, grid/axes and
native tool overlays. Opaque groups batch; translucent placements sort back-to-front.
Only changed resource payloads cross the bridge; camera updates retain geometry.
Context recovery resends immutable resources and re-uploads GPU assets.

This is not native feature parity with the web renderer. Native WebGPU/WGSL, shadow
maps, 4x MSAA, viewport PNG export, photo-reference UI and photo matching are not
implemented in this native preview. Transparency sorts placements rather than every
intersecting triangle. Section caps remain unavailable. Precise robust CAD Boolean
and intersect/heal limitations of the shared core remain. UI accessibility, IME,
clipboard integration and full native editing acceptance are not yet demonstrated.

Do not claim this native preview preserves every visible browser rendering feature.
The adapter contract leaves room for a future native WebGPU renderer, but it is not
implemented here. There is no performance benchmark. The status bar reports CPU
submission time, not GPU execution time or measured end-to-end FPS.

## Validation commands

Shared model and adapter tests (no .NET or GPU required):

```powershell
npm test
npm run check
npm run audit
npm run desktop:bundle
npm run build
```

Five private-model tests are skipped when `SINGLETAKE_MODEL_FIXTURE` is absent. The
other tests use synthetic geometry. To run private regressions, set the variable to
an external local model path; do not commit that file or extracted assets.

C# protocol tests are a console executable, not a test-adapter project:

```powershell
node tools/desktop-test-scene.mjs
dotnet run --project desktop/SingleTake.Protocol.Tests -c Release -- artifacts/protocol-scene.json
```

This tests schema and bounds checks, atomic updates, malformed geometry rejection,
immutable delta handling, context-reset retransmission, input coalescing and a
packet generated by the shared JS code. It does not test a graphics driver.

A separate native smoke test opens the real window, mounts the packaged JavaScript,
creates a synthetic box, requires indexed draw submission without an OpenGL error,
and reads non-background pixels from the native framebuffer:

```powershell
dotnet run --project desktop/SingleTake.Desktop -r win-x64 -- --native-smoke
```

This is an acceptance probe, not a performance benchmark or proof of full UI parity.
It fails on missing runtime/assets, invalid mount, GPU errors or a timeout. A passing
protocol test or source scan is not substituted for this native execution test.

## Build and distribute a native preview

From a matching host after restore and tests pass:

```powershell
dotnet publish desktop/SingleTake.Desktop/SingleTake.Desktop.csproj -c Release -r win-x64 --self-contained true -o artifacts/desktop/win-x64
node tools/desktop-package.mjs artifacts/desktop/win-x64 win-x64
```

Distribute the **whole publish directory**, not just the executable. Keep the native
engine library, ICU data, snapshot and metadata, component assets and licenses beside
it. The inventory script rejects missing runtime files and adds SHA-256 hashes plus
available NuGet notice files. It does not invent missing packages or create a native
binary from JavaScript itself.

The outputs are unsigned preview folders. Installers, a macOS `.app` bundle,
code-signing, notarization, auto-update and public release promotion are not included.
No compiled native output was produced in the delivery environment.

## GitHub Actions versus GitHub Pages

`desktop.yml` runs independently on relevant pushes to `main`, pull requests, or
manual dispatch. It tests shared JS, executes the C# protocol tests, verifies package
publication, restores/builds the native host, publishes the three configured RIDs,
and uploads unsigned preview artifacts only after successful steps.

The matrix uses Windows x64, Linux x64 and an Apple-silicon macOS runner and checks
the actual runner architecture. Native graphics smoke testing is optional manual
input `native_smoke`; successful compilation without that input is **not** a native
rendering validation. Native smoke requires a real or virtual display and graphics
support. Linux uses Xvfb for that optional test.

The native workflow intentionally fails when the pinned packages are not available.
It does not clone, build or vendor WebScene. Its success has not been established by
this delivery. Desktop artifacts appear under the completed Actions run; this
workflow does not create GitHub Releases, install the app on a user machine, or
publish executables as a web page.

`pages.yml` is unchanged and continues to build the web target and publish `dist/`
after successful updates on `main`. Desktop package availability does not gate that
separate Pages deployment. Browser files are not replaced by the desktop project.

## Trust and licensing

Only the packaged application component is mounted. Do not expose arbitrary script
execution, filesystem paths, process launch, unrestricted reflection or remote UI
through the host capability. Current commands are frame submission, file picker
open/save, bounded decompression, unsaved-state confirmation, focus and status.
JSON is serialized at the boundary rather than concatenating user data as code.
WebScene is not a browser-grade sandbox for untrusted pages or plug-ins.

See `desktop/THIRD_PARTY_NOTICES.md` for the dependency's Restricted Party Clause.
The SingleTake source audit remains separate from dependency binary/notice review.
Mandatory upstream notices must be retained even when they contain third-party
names. No unqualified all-dependency naming-clearance claim is made.

## Primary implementation references

- WebScene native component host: https://github.com/wieslawsoltes/WebScene/blob/main/docfx/articles/component-host.md
- Package and RID contract: https://github.com/wieslawsoltes/WebScene/blob/main/docfx/articles/packages-and-deployment.md
- Profile and security boundaries: https://github.com/wieslawsoltes/WebScene/blob/main/docfx/articles/compatibility-and-security.md
- Source-declared version: https://github.com/wieslawsoltes/WebScene/blob/96088f6c75cfdd30a66f56e2bf88ea75f1dfca92/Directory.Build.props
- Avalonia GL lifecycle: https://github.com/AvaloniaUI/Avalonia/blob/11.3.4/src/Avalonia.OpenGL/Controls/OpenGlControlBase.cs
- Silk.NET API: https://github.com/dotnet/Silk.NET/blob/v2.23.0/src/OpenGL/Silk.NET.OpenGL/GL.cs

Research used documentation and source inspection; no upstream source checkout is a
build prerequisite or an included project reference.
