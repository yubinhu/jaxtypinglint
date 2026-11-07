# Publishing jaxtypinglint

The source is public at <https://github.com/yubinhu/jaxtypinglint>.
Installable VSIX files are attached to [GitHub releases](https://github.com/yubinhu/jaxtypinglint/releases).
Marketplace publication still needs a publisher account. `jaxtypinglint-local`
is a packaging placeholder, not a registered publisher belonging to this project.

## First Marketplace release

1. Sign in with your Microsoft account at the
   [Visual Studio Marketplace publisher page](https://marketplace.visualstudio.com/manage).
   Choose **Create publisher**, select an available publisher ID (for example,
   `yubinhu`), and complete the account setup and any required agreements yourself.
2. From the repository, set `publisher` to that exact ID and build the package:

   ```sh
   npm ci
   npm pkg set publisher=YOUR_PUBLISHER_ID
   npm run typecheck
   npm test
   npm run package
   ```

3. In the publisher page, choose **New extension → Visual Studio Code** and
   upload the generated `jaxtypinglint-0.2.0.vsix`. The Marketplace validates the
   package before listing it. Manual upload does not require sharing a token here.
4. Commit the real publisher ID, update the README installation instructions to
   the resulting Marketplace URL, and upload the correctly identified VSIX to
   the corresponding GitHub release.

The publisher ID is part of the extension's identity. When switching from the
local package to the Marketplace extension, uninstall
`jaxtypinglint-local.jaxtypinglint` so two copies do not provide duplicate hovers.

For ongoing automated publishing, follow Microsoft's current
[publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
It recommends GitHub Actions Trusted Publishing with OIDC. That requires a
publisher policy and a compatible `vsce` version; it is not configured in this
repository. CI currently tests and packages the extension without publishing it.

## Subsequent GitHub releases

1. Update the version in `package.json` and `package-lock.json`, and update
   `CHANGELOG.md` with the resulting behavior.
2. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run test:integration`.
3. Run `npm run package`. Check that the archive includes
   `THIRD_PARTY_NOTICES.txt` and excludes tests, logs, and development dependencies.
4. Commit and push the changes. Tag the commit `vVERSION`, push the tag, and
   create a GitHub release containing the corresponding VSIX and SHA-256 checksum.

The GitHub Actions workflow runs on pushes and pull requests. It builds the VSIX,
runs unit and real extension-host tests, and retains the tested VSIX as an artifact.
