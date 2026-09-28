# Configuring Dev Auto-Login in AccxUI Apps

This guide explains how to configure automatic development login for AccxUI applications, how the login page interacts with dev servers, and important limitations when switching between test instances.

---

## 1. Overview

During local development, retyping credentials or repeatedly choosing an OMS instance slows down rapid iteration. AccxUI provides dev-only conveniences:

1. **Dev Servers Picker**: In the OMS selection step, development servers (local processes running on ports like `8080`, your default server, and every server in `VITE_ALIAS`) are listed under **Dev servers**. When dev credentials are configured, they are badged with **Auto login** and log you in with a single click, so you can switch between servers without editing `.env` or restarting.
2. **One-Click Dev Login**: When navigating directly to the login page (or after logging out), if your configured dev credentials match the active OMS, you will see a dedicated quick-login item with your dev username. Clicking it signs you in immediately without retyping your password, while still allowing you to stay logged out or sign in as a different user.

---

## 2. Configuration (`.env`)

Configure dev auto-login once for every app: copy `.env.example` in the accxui root to `.env` (gitignored) and fill it in:

```bash
# OMS Instance Configuration
VITE_DEFAULT_ALIAS="http://localhost:8080"
# Every server listed here is offered on the dev login, with auto-login
VITE_ALIAS='{"local":"http://localhost:8080","dev-oms":"https://dev-oms.hotwax.io"}'

# Dev Credentials
# Supported variable names: VITE_DEV_USERNAME / VITE_DEV_PASSWORD
# (Legacy VITE_USERNAME / VITE_PASSWORD are also supported)
VITE_DEV_USERNAME="admin"
VITE_DEV_PASSWORD="password"
```

### Supported Variables
| Variable | Description |
| --- | --- |
| `VITE_DEFAULT_ALIAS` | The default OMS alias or URL prefilled on boot (e.g. `http://localhost:8080` or `local`). |
| `VITE_ALIAS` | Optional JSON string mapping short alias names to OMS URLs. Each one is offered on the dev login and receives the dev credentials. |
| `VITE_DEV_USERNAME` | The dev username to use for auto-login (or `VITE_USERNAME`). |
| `VITE_DEV_PASSWORD` | The dev password to use for auto-login (or `VITE_PASSWORD`). |

### How the root env reaches each app
Each app's `vite.config` adds `commonEnvPlugin` (`common/vite/commonEnvPlugin.ts`). While `vite` serves an app, it copies every `VITE_` variable from the accxui root `.env` / `.env.local` (and their `.env.[mode]` variants) into the app's env. Restart the app's dev server after editing them.

- **The app's own value wins.** If the app's `.env` / `.env.local`, or your shell, sets one of them to a non-empty value, that value is used. An empty value or `{}` counts as not set, so the placeholders in app `.env.example` files don't hide the root value.
- **Every `VITE_` variable in the root env is shared.** Put only settings common to all apps there, such as the four above; app-specific settings stay in each app's `.env`.
- **Dev server only.** The plugin does nothing on `vite build`, so a release build takes `VITE_ALIAS` / `VITE_DEFAULT_ALIAS` only from the app's own env, and root dev credentials never reach a bundle.
- **Legacy names aren't shared.** `VITE_USERNAME` / `VITE_PASSWORD` still work, but only from an app's own env.

---

## 3. Multiple Servers and Your Credentials

> [!WARNING]
> **Dev auto-login sends `VITE_DEV_USERNAME` / `VITE_DEV_PASSWORD` to every server in `VITE_ALIAS`, not only to your default server.** Only list servers you would type those credentials into yourself, and never add a production instance.

1. **Every aliased server gets auto-login**: Each `VITE_ALIAS` entry appears under **Dev servers**, badged **Auto login** when dev credentials are set. Picking one signs you in to that server with the same credentials. This is what lets you switch between, say, a local Moqui backend at `http://localhost:8080` and a shared test instance like `https://dev-oms.hotwax.io` with one click.
2. **One set of credentials for all of them**: There is a single `VITE_DEV_USERNAME` / `VITE_DEV_PASSWORD` pair, so it is sent to whichever aliased server you pick. If your servers need different credentials, keep only the servers that share them in `VITE_ALIAS`; for the others, sign in by hand, or change the credentials and restart the Vite dev server.
3. **Other servers still fail closed**: A server that is neither your default, a local host, nor in `VITE_ALIAS` (for example one you type into the OMS field) never shows the Auto login item and never receives your dev credentials.
4. **Dev only, but keep credentials out of release builds**: The Dev servers list and auto-login only run in `vite` dev builds (`import.meta.env.DEV`). Vite still writes every `VITE_` value the code references into a production bundle, so never run a release build from an env (`.env`, `.env.local`) that holds dev credentials.
