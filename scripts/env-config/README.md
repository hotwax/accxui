# env-config — local deploy overrides

Local, per-environment env values that `scripts/deploy.sh` (`pnpm deploy`) injects into an app's `.env`
at build time — the local stand-in for the GitHub secrets used in CI (e.g. Firebase config).

## Files

Create one file per environment (all are git-ignored — they hold secrets, never commit them):

- `.env.dev`
- `.env.uat`
- `.env.prod`

Each is a plain `KEY=VALUE` env file. When you deploy to an environment, the script copies a fresh
`.env` from the app's own `.env.example`, then **replaces the value of every key that already exists in
that `.env`** with the value from the matching `scripts/env-config/.env.<env>` file. Keys not present in the
app's `.env.example` are ignored; keys you don't list here keep their `.env.example` default.

## Example

`scripts/env-config/.env.dev` (and `.env.uat`, `.env.prod` with their own values):

```
VITE_FIREBASE_CONFIG={"apiKey": "","authDomain": "","databaseURL": "","projectId": "","storageBucket": "","messagingSenderId": "","appId": ""}
VITE_FIREBASE_VAPID_KEY=""
```

Values are applied literally, so JSON, quotes, and `=` inside a value are safe.
