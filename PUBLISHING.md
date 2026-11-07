# Publishing jaxtypinglint

The source is public at <https://github.com/yubinhu/jaxtypinglint>.
Installable VSIX files are attached to [GitHub releases](https://github.com/yubinhu/jaxtypinglint/releases).
The registered publisher is **harveyh** and the extension ID is
**harveyh.jaxtypinglint**. The package manifest already contains this identity.

## Prepare a package

From the repository:

```sh
npm ci
npm run typecheck
npm test
npm run test:integration
npm run package
```

For version 0.2.1, this produces `jaxtypinglint-0.2.1.vsix`. Check that the archive
includes `THIRD_PARTY_NOTICES.txt` and excludes tests, logs, and development
dependencies.

## Upload to Marketplace

1. Sign in to the [harveyh publisher page](https://marketplace.visualstudio.com/manage/publishers/harveyh).
2. For the first upload, choose **New extension → Visual Studio Code** and select
   the generated VSIX. For later versions, use the existing extension's update
   action and upload the new VSIX.
3. Wait for Marketplace validation, then verify the version on the
   [extension page](https://marketplace.visualstudio.com/items?itemName=harveyh.jaxtypinglint).

Manual upload uses the signed-in browser and does not require sharing a token.
An uploaded package is not publicly available until validation finishes.

The publisher ID is part of the extension's identity. Users of the earlier local
build should uninstall `jaxtypinglint-local.jaxtypinglint` and install
`harveyh.jaxtypinglint` to avoid duplicate hover sections.

## GitHub releases

1. Update the version in `package.json` and `package-lock.json`, and update
   `CHANGELOG.md` with the resulting behavior.
2. Run the checks and package command above.
3. Commit and push the changes. Tag the commit `vVERSION`, push the tag, and
   create a GitHub release containing the same VSIX and its SHA-256 checksum.

The GitHub Actions workflow runs on pushes and pull requests. It builds the VSIX,
runs unit and real extension-host tests, and retains the tested VSIX as an artifact.
It does **not** publish to Marketplace. Trusted Publishing is not configured.
For future automation, follow Microsoft's current
[publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension),
which describes the required publisher policy and compatible `vsce` tooling.
