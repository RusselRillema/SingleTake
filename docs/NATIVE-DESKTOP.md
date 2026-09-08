# SingleTake desktop: one shared UI

The desktop target uses the same `index.html`, `style.css`, `src/app.js`, icons,
menus, dialogs, panels, tools, shortcuts and interaction controller as the web
application. There is no desktop-specific modeling interface or command controller.
The previous separate panel and manual C# input forwarding have been removed.

**This is source integration, not a verified native release.** The packaged
JavaScript/UI tests run in a Chromium DOM with OS and GPU services mocked. They do
not establish WebScene CSS compatibility, .NET compilation, native input behavior
or GPU rendering. Run the native acceptance gate on your target machine before
shipping. No compiled executable is included in the source distribution.

## Shared source contract

`tools/desktop-bundle.mjs` reads the root HTML and stylesheet at build time. It
copies both files byte-for-byte into `Components/Modeler/ui/`, hashes the shared
sources in `ui-source.json`, and embeds the unchanged body markup and stylesheet
in the generated component entry. It removes only the web bootstrap script tag:
`src/main.js` starts the web platform, while the component lifecycle starts the
**same `App` class** with the native platform services. No UI markup is maintained
in the desktop source. Do not edit generated files.

```text
index.html + style.css + src/app.js + src/ui/*
                         |
                shared App and Tools
                 /
        browser platform         native platform
        WebGPU renderer          native GPU presenter
        browser workers          native task adapter
        IndexedDB                app-owned recovery file
        file downloads           OS save/open dialogs
```

The native application remains C#/Avalonia plus WebScene NuGet packages. It does
not embed a WebView or launch a browser, Node.js, or localhost server at runtime.
V8 runs the JavaScript and .NET runs the C# host; this is not runtime-free AOT
compilation of web languages.

## Rendering and input

One full-window WebScene host renders the original application UI. A native GPU
control is composited **under** the real DOM canvas, using its measured
`getBoundingClientRect()` in logical pixels. Display scaling is applied by the
native presenter, not by multiplying pointer coordinates. Window resizing updates
that rectangle. The shared stylesheet makes only the viewport aperture transparent.

WebScene owns pointer hit testing, focus, text entry, key transitions, dialogs,
SVG tool overlays and pointer capture. C# does not synthesize another mouse/keyboard
stream. `Tools` receives events on the original `#canvas`; controls and modal
surfaces therefore block world input naturally. On deactivation, held inference
modifiers are released. Unmount disposes listeners, tasks, observers and renderer
resources before another App is created.

The shared form helpers provide explicit submit handling and a same-markup dialog
fallback when the host lacks the HTML top layer. Both platforms use these helpers.
These are not replacements for the application's UI.

The native renderer is still OpenGL/GLES via Silk.NET, **not native WebGPU**.
Source includes indexed/instanced geometry, textures, material shading, culling,
section clipping, native axes/grid, exposure and GPU-only viewport PNG capture.
Clay and Wireframe now use the same numeric style convention as the web renderer.
The original DOM SVG overlays render above the native pixels. PNG capture reads
the GPU viewport, not the UI overlays.

Native shadow maps, 4x MSAA and reduced-resolution rendering are not implemented.
The corresponding unsupported controls are disabled or disclosed, not silently
reported as working. Transparency remains approximate; section caps and the shared
core's advanced CAD/topology limitations remain. Exact WebScene CSS/SVG/IME and
native compositor results require native verification.

## Platform services

`src/platform/browser.js` and `desktop/shared/native-platform.js` implement only
renderer creation, background-task adaptation, file pickers/downloads, image URLs,
recovery and reload. Native saves are awaited; cancellation does not clear the
modified flag. Edits made while the save picker is open remain unsaved.

The native task adapter uses the **same** import and solid-operation functions.
It is not a real Worker: long synchronous geometry operations can block the V8
engine thread. Cancellation suppresses queued results; it cannot preempt an already
running synchronous operation. The UI is not claimed to be nonblocking under all
large-model workloads.

Native file selection remains bounded to 128 MiB aggregate. The existing native
raw-DEFLATE service retains shared ZIP bounds and checksum validation. Recovery
writes a fixed application-owned file atomically; JavaScript cannot choose its
filesystem path. Image picks feed the original material and photo-reference UI.
Only packaged trusted UI code is executed; model files are data, not plug-ins.

## Rider / local build

Open `SingleTake.sln`. Use .NET SDK 10 and Node.js 22+ for building. The project
references WebScene packages; it does not clone or build WebScene. Versions remain
pinned in `desktop/Directory.Build.props`. The WebScene source version is **not**
proof that corresponding native component-host packages are published.

From the repository root on Windows x64:

```powershell
npm run desktop:doctor -- --online --rid=win-x64
npm run desktop:bundle
dotnet restore desktop/SingleTake.Desktop/SingleTake.Desktop.csproj -r win-x64
dotnet build desktop/SingleTake.Desktop/SingleTake.Desktop.csproj -c Debug -r win-x64 --no-restore
dotnet run --project desktop/SingleTake.Desktop -r win-x64
```

Stop if preflight cannot establish package availability. Do not silently downgrade
to an incompatible API. The MSBuild target regenerates the shared UI automatically
on a normal build; an old generated panel is not a supported fallback.

Use `linux-x64` on Linux x64 or `osx-arm64` on Apple-silicon macOS. These are the
configured package targets, not platforms verified by this delivery. Keep runtime
libraries, ICU data, snapshots, metadata and component assets next to the app.

## Tests and acceptance gates

```powershell
npm run verify
npm run desktop:bundle
python tools/shared-ui-smoke.py
python tools/ui-smoke.py
node tools/desktop-test-scene.mjs
dotnet run --project desktop/SingleTake.Protocol.Tests -- artifacts/protocol-scene.json
dotnet run --project desktop/SingleTake.Desktop -r win-x64 -- --native-smoke
```

The optional Python tests require Playwright and Chromium. The shared-UI test loads
the **actual generated component bundle**, not a second controller or mock App.
It checks source hashes, canvas bounds at 2x display scale, real pointer/keyboard
interactions, native-service adaptation, modal fallback and remount lifecycle.
Its screenshot is DOM-only, not native-rendering evidence.

The C# tests validate geometry and DOM viewport messages. The separate native smoke
gate mounts WebScene, submits the original primitive dialog and checks real native
framebuffer pixels. A passing source build or mock host test does not replace this
gate. Also manually verify modal layering, text entry, all supported tools, resize,
DPI changes, camera motion, import/export, device loss and closing with dirty data
on each advertised platform.

## Automation and distribution

The desktop workflow now watches **root HTML and CSS changes** as well as shared
source and native projects. It runs CPU tests, the actual packaged UI in a DOM test
harness, package preflight, .NET build/publish and optional native smoke. Published
UI assets must match their source hashes. Desktop artifacts remain unsigned
previews. `pages.yml` is separate and still publishes the web target.

Review `desktop/THIRD_PARTY_NOTICES.md` before distribution. WebScene retains its
custom source-available license and Restricted Party Clause; SingleTake's source
license does not override dependency terms. Native runtime licenses and data files
must not be stripped from a distribution.
