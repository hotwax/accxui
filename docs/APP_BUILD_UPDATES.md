# Opt-in frontend build updates

Apps without an active service worker can use `buildUpdatePlugin()` from
`common/vite/buildUpdatePlugin` and `useBuildUpdate` from `@common`.
The plugin emits `app-build.json` and embeds `import.meta.env.VITE_APP_BUILD_ID`.
The marker is distinct from UAT release metadata (`version.json` / `hosted-versions.json`).
Each build has a unique ID, including rebuilds of the same commit with different configuration.

Mount the composable once in the app shell with `{ currentBuildId, base: import.meta.env.BASE_URL,
enabled: import.meta.env.PROD }`. It checks on mount, every visible minute, and when returning to
the tab or network (return events are throttled to 30 seconds). Requests omit credentials, bypass
HTTP caching, time out after 10 seconds, and stay within the current same-origin version base.
Missing, malformed, offline, and wrong-base responses are ignored. Unmount aborts requests and
removes listeners. Nothing is stored across users or tabs, and nothing reloads automatically.

The app must display the notice and own its update action. Never reload automatically from this
signal. Recheck active requests, unsaved edits, proposal reviews, and other app-specific blockers
at the moment the user confirms updating. Use a normal page reload to preserve the URL, tenant
version base, and browser session. Explain that unfinished work must be saved or discarded first.

Hosting must revalidate HTML on every navigation (including deep-link rewrites), serve the marker
with `Cache-Control: no-store`, and may keep hashed assets immutable. Keep legacy-worker retirement
endpoints. Consumers must opt in explicitly; adding the helper changes no existing app behavior.

A previously loaded frontend without this detector still needs one ordinary reload to adopt it.
Validate rollout with two actual production builds, including a dirty editor, not only a dev server.
