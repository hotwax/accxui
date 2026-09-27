# Configuring Dev Auto-Login in AccxUI Apps

This guide explains how to configure automatic development login for AccxUI applications, how the login page interacts with dev servers, and important limitations when switching between test instances.

---

## 1. Overview

During local development, retyping credentials or repeatedly choosing an OMS instance slows down rapid iteration. AccxUI provides dev-only conveniences:

1. **Dev Servers Picker**: In the OMS selection step, development servers (local processes running on ports like `8080`, your default server, and every server in `VITE_ALIAS`) are listed under **Dev servers**. A server that has credentials is badged **Auto login** and logs you in with a single click, so you can switch between servers without editing `.env` or restarting.
2. **One-Click Dev Login**: When navigating directly to the login page (or after logging out), if the active OMS has credentials, you will see a dedicated quick-login item with the dev username for that server. Clicking it signs you in immediately without retyping your password, while still allowing you to stay logged out or sign in as a different user.
3. **Auto-Login at Startup**: In dev, an app signs in during boot so a reload lands straight on the app instead of the login page. This is on whenever the target server has credentials, and is opted out of per app with `VITE_DEV_AUTO_LOGIN="false"`.

---

## 2. Configuration: one shared list for the whole workspace

Credentials are **not** configured per app. The AccxUI workspace root holds one file that every app reads, so adding a new app needs no credential setup at all.

Copy the workspace root `.env.example` to the workspace root `.env.local` and fill it in:

```bash
# <workspace root>/.env.local   — gitignored, never committed
VITE_DEV_CREDENTIALS='{"local":{"username":"…","password":"…"},"rails-oms":{"username":"…","password":"…"}}'
```

Each app keeps its own `.env` for everything else, including which servers it offers:

```bash
# apps/<app>/.env
VITE_DEFAULT_ALIAS="http://localhost:8080"
VITE_ALIAS='{"local":"http://localhost:8080","rails-oms":"https://rails-oms.hotwax.io"}'
```

### How an entry is matched to a server

A `VITE_DEV_CREDENTIALS` key may be either a `VITE_ALIAS` label or a full URL. Resolution tries the label first, then the normalized URL, so an app may point `VITE_DEFAULT_ALIAS` at either form and still match. `"rails-oms"` and `"https://rails-oms.hotwax.io"` therefore select the same entry.

Matching a **URL** to a **label-keyed** entry resolves the label through the app's own `VITE_ALIAS`. An app whose `VITE_ALIAS` does not list that label cannot match the entry by URL, and so cannot auto-login to that server — which is the intended direction: an app only auto-logs in to servers it actually offers. Key the entry by URL if you want it to match regardless of an app's alias.

### Supported Variables
| Variable | Where | Description |
| --- | --- | --- |
| `VITE_DEV_CREDENTIALS` | workspace root (or an app, to override) | JSON object mapping each dev server to its own `{username, password}`. |
| `VITE_DEFAULT_ALIAS` | app | The default OMS alias or URL prefilled on boot, and the server startup auto-login targets. |
| `VITE_ALIAS` | app | JSON string mapping short alias names to OMS URLs. Each one is offered on the dev login. |
| `VITE_DEV_AUTO_LOGIN` | app | Set to `"false"` to stop that app signing in at startup. Startup auto-login is otherwise on. |
| `VITE_DEV_OMS` | app | Optional. Overrides which server startup auto-login targets. Defaults to `VITE_DEFAULT_ALIAS`. |
| `VITE_DEV_USERNAME` / `VITE_DEV_PASSWORD` | app | Legacy single pair. See precedence below. |
| `VITE_USERNAME` / `VITE_PASSWORD` | app | Older legacy single pair. See precedence below. |

### Override precedence

Highest first. The first source that yields both a username and a password wins:

1. **`VITE_DEV_CREDENTIALS` entry for the selected server.** An app's own `.env` value shadows the workspace list entirely, so an app overrides a server by defining its own `VITE_DEV_CREDENTIALS`; that is the supported per-app override, and it is optional.
2. **`VITE_DEV_USERNAME` / `VITE_DEV_PASSWORD`** in the app's env.
3. **`VITE_USERNAME` / `VITE_PASSWORD`** in the app's env.

Levels 2 and 3 are a single flat pair with no server of its own, so they are offered to **whichever** server is selected. They exist only so an app configured before the shared list keeps working. Prefer a `VITE_DEV_CREDENTIALS` entry, which is what makes per-server credentials possible.

---

## 3. Multiple Servers and Your Credentials

> [!WARNING]
> **A flat `VITE_DEV_USERNAME` / `VITE_DEV_PASSWORD` pair is sent to every server in `VITE_ALIAS`, not only to your default server.** Only list servers you would type those credentials into yourself, and never add a production instance. `VITE_DEV_CREDENTIALS` is the way to avoid this: an entry is only ever sent to the server it is keyed to.

1. **Each server uses its own credentials**: Every `VITE_ALIAS` entry appears under **Dev servers**, badged **Auto login** only when that specific server has credentials. Picking one signs you in with that server's own entry, so a local Moqui backend at `http://localhost:8080` and a shared test instance like `https://rails-oms.hotwax.io` can have different passwords and both work with one click.
2. **A server with no entry offers nothing**: It appears in the list without the **Auto login** badge and receives no credentials, rather than being sent another server's password. The one exception is a flat legacy pair (precedence levels 2 and 3), which has no server of its own and so is still offered everywhere. Removing the flat pair from an app's env is what makes that app strictly per-server.
3. **Other servers still fail closed**: A server that is neither your default, a local host, nor in `VITE_ALIAS` (for example one you type into the OMS field) never shows the Auto login item and never receives credentials.
4. **Dev only, and out of release builds**: The Dev servers list and auto-login run only in dev (`import.meta.env.DEV`). The shared list is supplied by a Vite plugin declared `apply: "serve"`, so no build of any mode can inline it. That protection does not extend to an app's own env: Vite writes every `VITE_` value the code references into a production bundle, so never run a release build from an app `.env` / `.env.local` that holds credentials.

---

## 4. Adding a new app

Nothing credential-related is required. In the app's `vite.config`:

```ts
import { sharedDevEnvPlugin } from '../../common/vite/sharedDevEnv'

plugins: [sharedDevEnvPlugin(), /* … */]
```

and, for startup auto-login, in the app's `main.ts` inside `router.isReady()`, before `app.mount`:

```ts
if (import.meta.env.DEV) {
  const { tryDevAutoLogin } = await import('@common/dev/autoLogin');
  await tryDevAutoLogin();
}
```

The app then picks up whichever servers the workspace list already covers.

---

## 5. Where the code lives

| Path | Responsibility |
| --- | --- |
| `common/utils/devCredentials.ts` | Resolves credentials for one server, and the precedence above. |
| `common/vite/sharedDevEnv.ts` | Vite plugin that merges the workspace list into the app, dev server only. |
| `common/dev/autoLogin.ts` | Startup auto-login, shared by every app. |
| `common/components/Login.vue` | Dev servers picker and the one-click dev user item. |
