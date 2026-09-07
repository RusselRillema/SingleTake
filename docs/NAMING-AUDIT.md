# Public naming and asset audit

`npm run audit` scans the working source and reachable Git history against a fixed naming policy. Policy entries are irreversible SHA-256 fingerprints with rolling-hash prefilters, so prohibited names are not themselves published in the scanner or its configuration.

The scan checks normalized source text, filenames, UTF-8/UTF-16 interpretations, commit messages and every reachable blob. Case-specific entries distinguish protected capitalization from generic programming vocabulary. Diagnostic output identifies the policy rule and object, not the prohibited text. Separators are removed during matching, including inside identifiers and URLs.

The public build has an explicit file allowlist. Private model fixtures, extracted textures/thumbnails, test screenshots, external manuals, archives, font files, credentials, repository internals and dependency folders are excluded. Tests use synthetic geometry; the optional user-provided model stays outside the repository.

Independent research attribution and its MIT license remain in `THIRD_PARTY_NOTICES.md`. No license notice was removed merely to change branding. Model-file compatibility is identified only by extension and container characteristics.

A zero-match result establishes absence of the configured terms in the scanned scope, not a worldwide trademark clearance or a guarantee about all third-party brands. Expand the policy when introducing dependencies or other published content. The audit does not permit removing required license attribution.
