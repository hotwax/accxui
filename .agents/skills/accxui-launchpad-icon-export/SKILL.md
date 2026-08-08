---
name: accxui-launchpad-icon-export
description: Export or replace an AccxUI Launchpad app tile from the HC Ionic design system Figma Launchpad Icon Builder and prepare the corresponding hotwax/launchpad pull request. Use for launchpad icons, app tiles, Figma icon exports, or files such as OrderManager.svg.
---

# AccxUI Launchpad icon export

Use the prepared export frames in the HC Ionic design system. The master
components are editable sources, not the files to commit.

## Canonical sources

- Figma file: [HC Ionic design system](https://www.figma.com/design/bVPRRw282CqGKMdbz7dciH/HC-Ionic-design-system?node-id=55009-1223)
- Page: `Launchpad Icon Builder` (`55009:1223`)
- No-badge Launchpad master: `MASTER / Launchpad tile - no badge`
  (`55020:4751`)
- Badge Launchpad master: `MASTER / Launchpad tile - with badge`
  (`55020:4833`)
- App/PWA/native source master: `MASTER / App icon source`
  (`55020:4919`)

The page instructions are authoritative:

- Replace the source artwork in the masters.
- Do not resize children in any export frame.
- Export the named output frames below the masters. They are linked clones
  scaled with `rescale()` to preserve the shield, outline, shadow, and artwork.

## Choose the requested output

For a normal Launchpad app tile:

1. Update or verify the no-badge master.
2. Select the prepared no-badge output frame in `Launchpad outputs`. Its sample
   frame is `src/assets/images/Facilities` (`55020:4924`).
3. Export that output frame with its saved settings: 186 by 204 SVG.
4. Rename the downloaded file to the exact Launchpad asset name, for example
   `OrderManager.svg`.

For a tile with a badge, export
`src/assets/images/AppName-with-badge` (`55020:5005`) as 186 by 204 SVG.

The 512 by 512 `MASTER / App icon source` is not a Launchpad tile export. Use
it only when the scope includes the app's own favicon, PWA, Capacitor, Android,
or iOS icons. In that case, export the named frames in the web/native output
panels at their saved PNG sizes; do not export the master itself or manually
scale one PNG into every destination.

When using a Figma connector, download the prepared output node without
passing a format or scale override. This preserves the export settings stored
on the node.

## Repository workflow

1. Run `accxui-target-preflight` for `launchpad`.
2. Remember that `apps/launchpad` is the separate `hotwax/launchpad`
   repository, even though it is an active AccxUI workspace entry.
3. Refresh the Launchpad remote and base the change on current `origin/main`.
   Use an isolated worktree when the active checkout is on another branch or
   has unrelated work.
4. Put the exported tile at:

   ```text
   src/assets/images/<ExactAppAssetName>.svg
   ```

5. Inspect current `src/util/index.ts`:
   - If the app entry and asset reference already exist, replace only the SVG.
   - If the app is new, add the asset reference and `appInfo` entry using the
     file's current import style, handle, display name, category, and permission
     conventions. Do not infer these values.
6. Keep the PR based on `main` and limited to the requested asset/entry.

For Order Manager, current Launchpad `main` already contains the
`order-manager` entry and `OrderManager.svg`; a new design therefore requires
an asset-only replacement unless live code proves otherwise.

## Validation

Before committing:

1. Confirm the committed SVG is byte-for-byte the prepared Figma output when
   no post-processing was requested. Do not run an optimizer by default.
2. Confirm the SVG is valid XML and its root is exactly:

   ```xml
   width="186" height="204" viewBox="0 0 186 204"
   ```

3. Reject rasterized or remotely dependent SVGs: there should be no `<image>`
   element or external `href`.
4. Render the committed SVG and compare it with the prepared Figma output at
   the same node. Verify the complete red hexagonal outline and shadow, the
   intended artwork and badge state, and the absence of clipping.
5. Run `git diff --check` and confirm the diff contains only the intended
   Launchpad files.
6. Run the narrowest available Launchpad build/static check only from a
   checkout whose AccxUI wrapper/common dependency path is verified. Do not
   claim a build from the active app as validation for a different worktree.

In the handoff, link the Figma output node and PR, name the exported frame and
repository path, list validation performed, and state whether app/PWA/native
icons were intentionally out of scope.
