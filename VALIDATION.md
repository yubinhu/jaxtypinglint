# Validation — 0.2.1

The Marketplace package uses publisher `harveyh` and version `0.2.1`.
Both package.json and the VSIX XML identity were checked before upload.

Verified locally on 2026-11-07 with macOS arm64, Node.js 20.19.0 (unit tests and
packaging), Node.js 20.11.1 (integration launcher), and VS Code 1.145.2.

- `npm run typecheck`: passed.
- `npm test`: all 41 tests passed (26 analyzer tests and 15 presentation tests).
- `npm run test:integration`: all 14 checks passed in an isolated real VS Code
  extension host. Covers merged hovers, incomplete calls, unsaved edits,
  definition links/ranges, method hovers, compact signature help, configuration, and diagnostics.
- Read-only smoke check of the motivating Python source: the function call's
  declared `batch_size ...` and `batch_size seq_len` shapes were preserved.
  The assignment repository was not modified.
- `npm run package`: produced an installable VSIX with bundled JavaScript.
  The archive includes the bundled dependencies’ MIT notices and excludes development
  dependencies, source tests, logs, workflows, and test profiles.

The UI was revised in three passes: remove the duplicate signature, reduce repeated
dtypes and active-argument detail, then validate scalar/nested/escaped annotation
presentation. Rendered Markdown tests check table cells, literal content, and safe
escaping. Native screen access was unavailable, so this version has not had a
pixel-level visual inspection in VS Code.

The integration tests simulate an external definition provider and another hover
provider. They verify coexistence through VS Code's real APIs, but do not run
Pylance itself. Runtime tensors and Python functions are never executed.

The unchanged runtime dependencies reported zero vulnerabilities in the 0.1.0
`npm audit --omit=dev` check earlier on the same day. A full dependency audit
reported five advisories in development-only VSIX packaging dependencies
(`@vscode/vsce` / Azure identity / glob / minimatch); a compatible `npm audit fix`
did not eliminate them. These packages are excluded from the installed extension.
