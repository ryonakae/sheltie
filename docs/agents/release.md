# macOS Release

Sheltie is distributed outside the Mac App Store as one universal macOS DMG through GitHub Releases. A release is built from a pushed `v*` tag and remains a draft until the downloaded artifact passes manual installation checks.

## Artifact contract

Each release contains exactly these macOS assets:

- `Sheltie_<version>_universal.dmg`: Apple Silicon and Intel application, signed with Developer ID, notarized, and stapled.
- `Sheltie_<version>_universal.dmg.sha256`: SHA-256 generated after the notarization ticket is stapled.

`.github/workflows/release.yml` requires the tag without its leading `v` to equal all three project versions:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

The workflow creates a draft GitHub Release with generated release notes. Publishing is always manual.

## GitHub environment

Create an environment named `release` in the repository settings.

Configure **Deployment branches and tags** as follows:

1. Select **Selected branches and tags**.
2. Add a tag rule with pattern `v*`.
3. Do not add a required reviewer. The draft release is the manual publication gate.

The workflow job uses `environment: release`, so Apple credentials are unavailable outside this environment.

## Environment secrets

Configure these secrets under the `release` environment:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Export password for the `.p12` |
| `APPLE_API_KEY_BASE64` | Base64-encoded App Store Connect `AuthKey_<KEY_ID>.p8` |

Use GitHub CLI from an authenticated shell to avoid printing base64 credentials:

```bash
openssl base64 -A -in /secure/path/Sheltie-Developer-ID.p12 \
  | gh secret set APPLE_CERTIFICATE --env release

gh secret set APPLE_CERTIFICATE_PASSWORD --env release

KEY_ID='replace-with-key-id'
openssl base64 -A -in "/secure/path/AuthKey_${KEY_ID}.p8" \
  | gh secret set APPLE_API_KEY_BASE64 --env release
```

`gh secret set APPLE_CERTIFICATE_PASSWORD` prompts for the value. Do not pass the password on the command line or store the base64 output in the repository.

## Environment variables

Configure these variables under the `release` environment:

| Variable | Value |
|---|---|
| `APPLE_API_KEY` | App Store Connect API Key ID |
| `APPLE_API_ISSUER` | App Store Connect Issuer ID |

```bash
KEY_ID='replace-with-key-id'
ISSUER_ID='replace-with-issuer-id'
gh variable set APPLE_API_KEY --env release --body "$KEY_ID"
gh variable set APPLE_API_ISSUER --env release --body "$ISSUER_ID"
```

The signing identity `Developer ID Application: Ryo Nakae (ELFWBE4NMA)` and team ID `ELFWBE4NMA` are public certificate metadata and remain in the workflow source.

`GITHUB_TOKEN` is supplied automatically by GitHub Actions. Do not create a separate token secret for this workflow.

## Release procedure

1. Update the same version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
2. Run the required checks:

```bash
npm run lint
npm run format
npm run typecheck
npm run test
(cd src-tauri && cargo test --lib)
```

3. Commit and push the release changes to `develop`.
4. Open a pull request from `develop` into `main` titled `release: v<version>` and wait for the `CI` workflow to pass.
5. Merge the pull request with a **merge commit**. Never squash or rebase this pull request; both rewrite the commits and make `main` diverge from `develop`.
6. Tag the merge commit on `main` and push the tag:

```bash
VERSION='1.0.0'
git fetch origin main
git tag "v$VERSION" origin/main
git push origin "v$VERSION"
```

For version `1.0.0`, the tag is `v1.0.0`.

> Rule: release tags must point at commits on `main`. The release workflow does not enforce this; treat it as a hard operational rule.

7. Wait for the **Release macOS** workflow to finish.
8. Open the generated draft GitHub Release and edit the generated notes as needed. Release notes are written in English. The generated "What's Changed" list may contain Japanese pull request titles; rewrite the entries that matter to release readers.
9. Complete the acceptance checks below before publishing.

## Draft release acceptance

Download both assets from the draft release through a browser. The browser download is required to exercise macOS quarantine and Gatekeeper behavior.

Verify the checksum:

```bash
cd ~/Downloads
VERSION='1.0.0'
shasum -a 256 -c "Sheltie_${VERSION}_universal.dmg.sha256"
```

The command must report `OK`.

Then:

1. Open the downloaded DMG.
2. Drag Sheltie to Applications.
3. Launch Sheltie from Applications.
4. Confirm macOS shows the normal first-download confirmation, not an unidentified-developer or malicious-software rejection.
5. Exercise the primary create, save, reopen, and Webview flows.
6. Publish the draft release only after these checks pass.

## Homebrew tap

Sheltie is also installable with `brew install --cask ryonakae/tap/sheltie`. The cask lives in a separate repository, [ryonakae/homebrew-tap](https://github.com/ryonakae/homebrew-tap), as `Casks/sheltie.rb`.

The cask is not submitted to the official `homebrew-cask` repository. Homebrew's [Package Acceptance Policy](https://docs.brew.sh/Package-Acceptance-Policy) requires 90 forks, 90 watchers or 225 stars for a self-submitted package, which Sheltie does not meet.

Keeping the cask outside this repository is deliberate. A cask update happens after a release is published, so committing it here would push version bumps onto `main` after the release tag and make `main` diverge from `develop`.

`.github/workflows/update-homebrew-cask.yml` performs the update:

1. Triggers on `release: published`, and skips releases marked as a prerelease.
2. Checks out the tap using `HOMEBREW_TAP_TOKEN`.
3. Reads the checksum from the published `Sheltie_<version>_universal.dmg.sha256` asset.
4. Rewrites only the `version` and `sha256` stanzas, so hand-written stanzas such as `zap` survive.
5. Commits and pushes, or exits quietly when the tap already points at that version.

The workflow runs from the released tag, so it takes effect only once it has reached `main` through the usual release pull request. Editing it on `develop` alone changes nothing until the next release.

The cask builds its download URL from `version`, so it depends on the artifact contract above. Renaming the DMG requires editing the `url` stanza in the tap.

### Tap token

`HOMEBREW_TAP_TOKEN` is a repository secret, not an environment secret. It is deliberately kept out of the `release` environment so that this workflow cannot reach the Apple credentials.

Create a fine-grained personal access token with:

| Field | Value |
|---|---|
| Resource owner | `ryonakae` |
| Repository access | Only select repositories → `ryonakae/homebrew-tap` |
| Repository permissions | Contents: Read and write |

```bash
gh secret set HOMEBREW_TAP_TOKEN
```

The command prompts for the value. Do not pass the token on the command line.

Fine-grained tokens expire. When the workflow fails to check out the tap, issue a new token and set the secret again.

## Workflow behavior

The release job performs these stages in order:

1. Validate the tag and all project versions.
2. Run frontend and Rust quality gates.
3. Import the Developer ID certificate into an ephemeral keychain.
4. Decode the App Store Connect API key into the runner temporary directory.
5. Build the universal DMG. Tauri signs the app, notarizes it, and staples its ticket.
6. Submit the generated DMG separately to Apple's notary service.
7. Staple and validate the DMG ticket, then require Gatekeeper acceptance.
8. Generate the SHA-256 file from the final stapled DMG.
9. Create a draft GitHub Release and upload both assets.
10. Delete the temporary keychain and decoded credentials even when an earlier step fails.

A rerun may replace assets only while the matching release remains a draft. The workflow refuses to replace assets after publication.

## Tauri DMG notarization workaround

Tauri currently notarizes and staples the `.app` before creating the DMG, then signs the DMG without notarizing it. The workflow therefore runs `notarytool submit`, `stapler staple`, `stapler validate`, and `spctl` on the final DMG.

Track these upstream items:

- [tauri-apps/tauri#7533](https://github.com/tauri-apps/tauri/issues/7533)
- [tauri-apps/tauri#15118](https://github.com/tauri-apps/tauri/pull/15118)

Do not remove the explicit DMG notarization step merely because Tauri was upgraded. Remove it only after an end-to-end release build proves that the generated DMG already passes both:

```bash
VERSION='1.0.0'
DMG="/path/to/Sheltie_${VERSION}_universal.dmg"
xcrun stapler validate "$DMG"
spctl --assess \
  --type open \
  --context context:primary-signature \
  --verbose=4 \
  "$DMG"
```

## Credential handling

- Never commit `.p8`, `.p12`, passwords, or their base64 encodings.
- Keep an encrypted offline backup of the Developer ID certificate and its private key.
- Keep the `.p12` password in a password manager.
- App Store Connect private keys can be downloaded only once. Preserve the original securely.
- Rotate the GitHub environment secrets when the certificate or API key is replaced.
