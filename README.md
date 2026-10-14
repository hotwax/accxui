# Accxui

## Prerequisite

- Node 22 (at least `v22.12.0`), matching CI
- pnpm `9.15.9`, matching the CI pnpm 9 toolchain

From the workspace root, select the toolchain before installing:

```bash
nvm install
nvm use
npm install --global pnpm@9.15.9
node --version
pnpm --version
```

## Workspace Setup

`accxui` is a pnpm workspace. Apps are developed from the workspace root, not by running `npm serve` or `pnpm dev` inside an app folder directly.

1. Open a terminal window.
2. Clone the workspace:
   `git clone https://github.com/hotwax/accxui.git`
3. Go to the workspace root:
   `cd accxui`
4. Add the app you want to work on under `apps/`.
   Example:
   `git clone https://github.com/hotwax/fulfillment.git apps/fulfillment`
5. Create a `.env` file in that app by taking reference from its `.env.example`.
6. Install dependencies once from the `accxui` root:
   `pnpm install --frozen-lockfile`

## Start A Single App

Run app commands from the `accxui` root and target the app with `--filter`.

Examples:

```bash
pnpm --filter fulfillment dev
pnpm --filter receiving dev
pnpm --filter bopis dev
pnpm --filter available-to-promise dev
pnpm --filter job-manager dev
```

This starts only the selected app in development mode.

## Build A Single App

```bash
pnpm --filter <app-name> build
```

Example:

```bash
pnpm --filter fulfillment build
```

## Useful Notes

- Run `pnpm install --frozen-lockfile` from the root for apps already recorded in `pnpm-lock.yaml`.
- After adding an app or changing its dependency manifest, regenerate the workspace lockfile with `pnpm install --lockfile-only`, review the diff, and commit it to AccxUI. Then verify `pnpm install --frozen-lockfile` without changing workspace membership.
- Keep each app inside `apps/<app-name>` so the workspace can discover it.
- If you want to start multiple apps, run separate `pnpm --filter <app-name> dev` commands.

## Report a bug or request a feature

Always define the type of issue:
* Bug report
* Feature request

While writing issues, please be as specific as possible. All requests regarding support with implementation or application setup should be sent to.
# UI / UX Resources
You may find some useful resources for improving the UI / UX of the app <a href="https://www.figma.com/community/file/885791511781717756" target="_blank">here</a>.

# Join the community on Discord
If you have any questions or ideas feel free to join our <a href="https://discord.gg/SwpJnpdyg3" target="_blank">Discord channel</a>.
