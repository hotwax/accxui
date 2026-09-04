# Configuring Dev Auto-Login in AccxUI Apps

This guide explains how to configure automatic development login for AccxUI applications, how the login page interacts with dev servers, and important limitations when switching between test instances.

---

## 1. Overview

During local development, retyping credentials or repeatedly choosing an OMS instance slows down rapid iteration. AccxUI provides dev-only conveniences:

1. **Dev Servers Picker**: In the OMS selection step, development servers (local processes running on ports like `8080`, as well as servers configured in your `.env`) are listed under **Dev servers**. Servers that have credentials configured are badged with **Auto login** and log you in with a single click.
2. **One-Click Dev Login**: When navigating directly to the login page (or after logging out), if your configured dev credentials match the active OMS, you will see a dedicated quick-login item with your dev username. Clicking it signs you in immediately without retyping your password, while still allowing you to stay logged out or sign in as a different user.

---

## 2. Configuration (`.env`)

To enable dev auto-login for an AccxUI app (such as `company`, `order-manager`, `transfers`, etc.), add the following variables to your local `.env` file in that app:

```bash
# OMS Instance Configuration
VITE_DEFAULT_ALIAS="http://localhost:8080"
VITE_ALIAS='{"local":"http://localhost:8080"}'

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
| `VITE_ALIAS` | Optional JSON string mapping short alias names to OMS URLs. |
| `VITE_DEV_USERNAME` | The dev username to use for auto-login (or `VITE_USERNAME`). |
| `VITE_DEV_PASSWORD` | The dev password to use for auto-login (or `VITE_PASSWORD`). |

---

## 3. Important Limitation: Single-Server Credentials

> [!WARNING]
> **AccxUI currently supports saving dev credentials for only one server at a time in your `.env`.**

If you frequently switch between multiple test environments (for example, a local Moqui backend at `http://localhost:8080` and a remote shared test instance like `https://dev-oms.hotwax.io`):

1. **Credentials do not carry across different servers**: The credentials in `VITE_DEV_USERNAME` / `VITE_DEV_PASSWORD` are associated with your primary configured server (`VITE_DEFAULT_ALIAS` or localhost).
2. **Why auto-login is disabled on other servers**: When you switch the active OMS to a different server, the login page will **not** display the Auto login item or automatically submit credentials. This fails closed to prevent sending local credentials to remote servers or vice versa.
3. **Switching active dev servers**: If you want auto-login to work on another test instance, update `VITE_DEFAULT_ALIAS`, `VITE_DEV_USERNAME`, and `VITE_DEV_PASSWORD` in your `.env` to match that server and restart the Vite dev server.
