# SingleTake desktop dependency notices

SingleTake's own source remains under the root LICENSE. Package references do not
relicense dependencies. This distribution contains integration source, not a copy
of the WebScene repository or a native runtime binary.

## WebScene

The integration pins WebScene 1.0.33, the version declared in the upstream source
at reviewed commit `96088f6c75cfdd30a66f56e2bf88ea75f1dfca92`.
Publication of all required packages at this version has not been verified.

Upstream: https://github.com/wieslawsoltes/WebScene
License: https://github.com/wieslawsoltes/WebScene/blob/main/LICENSE

This is a custom source-available license with a Restricted Party Clause, not
unqualified MIT or an OSI-approved open-source license. Review its applicability
before distributing a product that uses the dependency. The exact upstream
notice follows:

---

MIT License with Restricted Party Clause

Copyright (c) Wiesław Šoltés

This software is provided under the MIT License terms below, subject to the
Restricted Party Clause at the end of this file.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Restricted Party Clause

Notwithstanding any permission above, no license or rights are granted to:

- AvaloniaUI OÜ, and
- any entity controlling, controlled by, or under common control with
  AvaloniaUI OÜ, and
- their employees, contractors, or agents acting on their behalf.

The restricted parties listed above may not use, copy, modify, merge,
publish, distribute, sublicense, sell, or otherwise exploit the Software in
any form.

This clause is a material condition of this license.

---

## Other direct dependencies

The desktop host also references Avalonia 11.3.4 and Silk.NET.OpenGL 2.23.0 through
NuGet. Texture decoding and UI presentation use the SkiaSharp dependency supplied
by the pinned presenter packages. Their transitive dependencies retain their
respective licenses. The native V8 runtime also carries ICU and other notices.

Keep all licenses, copyright notices, and runtime metadata delivered by NuGet in
the published application. Do not remove mandatory attribution to satisfy a
branding scan. `tools/desktop-package.mjs` inventories files and adds copies of
license files from resolved NuGet packages; it is not a legal license audit or an
SBOM completeness guarantee. Review `project.assets.json`, package license
expressions/files, and runtime notices before a signed public release.
