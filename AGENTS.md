# MDEdit delivery workflow

For every completed task that changes the application or its packaged behavior, carry the work through publication without waiting for a separate reminder. Documentation and process-only edits are committed and pushed, but do not consume an application version.

1. Preserve unrelated working-tree changes. Work on a `codex/` branch, and commit only files belonging to the task.
2. Choose an unused `vX.Y.Z` tag. Use the roadmap version when the task completes that milestone; otherwise advance the package version by one patch. If this takes a roadmap-reserved version, move the planned milestone to the next free version in the same change. Update `package.json`, `package-lock.json`, and `docs/releases/vX.Y.Z.md` together.
   Until v0.6.1 is published, interface cleanup is planned for it, including while its roadmap edit is still uncommitted. If another code task ships first, publish that task as v0.6.1 and move interface cleanup to v0.6.2 in the roadmap as part of that release. Keep published version numbers increasing in release order.
3. Run `npm test`, `npm run typecheck`, and `npm run test:worker`. For a macOS release on a Mac, also run `bash scripts/build-mac-adhoc.sh`, verify its signature and DMG, and smoke-test the packaged app locally. Fix failures before publishing.
4. Commit and push the task branch. Integrate it into `main` after the checks pass, using a fast-forward merge when possible or a pull request when repository rules require one. Push `main` and confirm the remote commit.
5. For an application release, create an annotated version tag on the integrated `main` commit and push it. Wait for `.github/workflows/release.yml` to succeed. Confirm the GitHub Release is public and contains the macOS arm64 ad hoc signed DMG, Windows installer, and `SHA256SUMS`. Report the release URL and any failure that remains.

The public GitHub Release is a formal version publication. Its macOS DMG uses temporary ad hoc signing and is not Apple notarized; describe this limitation in release notes. Never reuse or move a published tag.
