---
name: accxui-page-sync
description: Use when an AccxUI page, component or composable (apps/company, apps/order-manager or a new app) shows data a class A sync domain polls, or polls "while the screen is open" / "live" / "every N seconds". Triggers include activateSyncDomains, deactivateSyncDomains, createSyncDomainOwner, SYNC_OWNER, syncDomainsReady, syncDomainsError, syncNow, serviceState.syncedAt, onIonViewWillEnter / onIonViewDidLeave around sync, a Refresh button on a polled list, a skeleton or empty state that shows "No data" before the first poll, polling that never stops or stops on another page, a child component that needs its own polled domain, or the lint errors "activateSyncDomains without a matching deactivateSyncDomains", "This page activates sync domains but has no onIonViewDidLeave" and "Pass the owner: deactivateSyncDomains(SYNC_OWNER)".
---

# Polling sync domains from a page

Class A domains are polled by the sync worker **only while a screen has activated them**. Class B
domains (seed and reference data) run once per login on their own and are never activated from a
page. Writing the domain itself is **accxui-app-db-setup**; reading its rows is
**accxui-app-db-access**.

## How it works

- **One worker, one screen set.** `activateSyncDomains(list, owner)` **replaces** the whole set the
  previous screen activated (the login set of class B domains keeps running beside it). Two callers
  can't each hold their own domains: the second call wipes the first.
- **The owner guards the teardown.** Ionic fires `onIonViewWillEnter` on the incoming page *before*
  `onIonViewDidLeave` on the outgoing one. `deactivateSyncDomains(owner)` does nothing unless
  `owner` still holds the worker, so a page leaving late can't stop the page that replaced it.
  `createSyncDomainOwner(label)` returns a new id per call (`label:7`), so two instances of one page
  on the Ionic stack never share an owner.
- **Each activation has its own clock**, keyed on name + args. The same domain may appear twice with
  different args (two facilities, two intervals). An activation's `intervalMs` overrides the domain's
  default; with neither, it runs once per activation.
- **A new or changed activation runs at once**; one already active with the same args keeps its
  clock and does **not** re-run when activated again. An activation that is dropped (left, or
  re-scoped to new args) forgets its last pass.

## Rules

1. **Activate in `onIonViewWillEnter`, deactivate in `onIonViewDidLeave`, with one owner** created by
   `createSyncDomainOwner("<pageName>")` during setup. Never `onMounted` / `onUnmounted`: Ionic keeps
   pages mounted on its stack, so those don't fire on navigation.
2. **One list per page.** The page activates every domain its screen needs, including the ones its
   child components display, in one call. A component never activates on its own.
3. **Only class A domains** go in the list.
4. **When args change, activate again with the full list and the same owner** (a `watch` on the
   args). While an arg isn't known yet, activate `[]` rather than an unscoped domain.
5. **Show "loading" until this visit's first pass lands**, not until `useLiveEntity` is `hydrated`:
   the table may hold nothing (or an earlier visit's rows) until the worker's first pass ends.
6. **After a write, reconcile through the worker**: `refreshAfterMutation(domain, pk)` for one record,
   `syncNow()` to re-poll everything on screen. Activating the same list again does not re-run it.

## The API (`@/db/appDbSync`, plus `serviceState` from `@common/db`)

| Call | What it does |
|---|---|
| `createSyncDomainOwner(label)` | a new owner id per call; call it once in setup |
| `activateSyncDomains([{ name, intervalMs?, args? }], owner)` | replaces the screen set; new activations run now. `args` reach the domain's `sync(ctx, args)` and `refetchOne(ctx, pk, args)` |
| `deactivateSyncDomains(owner)` | clears the set if `owner` still holds it, else does nothing. Never call it without the owner |
| `syncDomainsReady` | `Ref<boolean>`: the worker **accepted** the set (or there is no worker). Not "data has arrived"; `false` after a deactivate |
| `syncDomainsError` | `ComputedRef<string>`: the last error among the active domains, `""` when none. Errors of domains other screens use don't show here |
| `syncNow()` | runs a pass of every active screen domain now; resolves when it ends, rejects if a domain failed. The "Refresh" button |
| `serviceState.syncedAt[name]` | when the current activation of `name` last finished a full pass; absent until this visit's first pass ends |
| `serviceState.errors[name]` | that domain's last error, if any |
| `refreshAfterMutation(name, pk)` | one record through the domain's `refetchOne`, with the active args (see **accxui-app-db-access**). A `defineCursorDomain` domain refetches by its **first** pk field only (`{ returnId }`); a domain without `refetchOne` rejects, so use `syncNow()` there |
| `resyncDomain(name)` | a forced pass of that one domain (with its active args); for class B data that can't refetch one record. The screen's Refresh is `syncNow()` |

## Recipe: a page

```vue
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onIonViewDidLeave, onIonViewWillEnter } from "@ionic/vue";
import { serviceState, useLiveEntity } from "@common";
import { activateSyncDomains, createSyncDomainOwner, deactivateSyncDomains, syncDomainsError, syncNow } from "@/db/appDbSync";
import { appDb } from "@/db/appDb";
import { useReturnActions } from "@/composables/useReturnActions";   // owns the PUT (no api() in .vue)

const props = defineProps<{ facilityId: string }>();
const SYNC_OWNER = createSyncDomainOwner("returnsMonitor");           // one per page instance
const selectedReturnId = ref<string>();

// Every domain this screen shows, children's included. Unknown args → leave the domain out.
const screenDomains = () => props.facilityId ? [
  { name: "return", intervalMs: 10_000, args: { facilityId: props.facilityId } },
  ...(selectedReturnId.value ? [
    { name: "returnItem", intervalMs: 5_000, args: { returnId: selectedReturnId.value } },
    { name: "returnNote", intervalMs: 5_000, args: { returnId: selectedReturnId.value } },   // shown by <ReturnNotes>
  ] : []),
] : [];

const isActive = ref(false);
const activate = () => activateSyncDomains(screenDomains(), SYNC_OWNER);
onIonViewWillEnter(() => { isActive.value = true; void activate(); });
onIonViewDidLeave(() => { isActive.value = false; void deactivateSyncDomains(SYNC_OWNER); });
// Re-scope while on screen only: a watch firing on a page in the back stack would take the worker.
watch(() => [props.facilityId, selectedReturnId.value], () => { if (isActive.value) void activate(); });

const { records: returns, hydrated } = useLiveEntity<any>(
  appDb.tables.returns,
  () => props.facilityId ? { equals: { facilityId: props.facilityId } } : { filter: () => false },
);
// Loading until this visit's first pass lands or fails; only then is "no rows" real. Keyed by the
// DOMAIN name (`return`), not the table (`returns`). Use it for each polled list (`returnItem`, …).
const firstPassPending = (domain: string) => !serviceState.syncedAt[domain] && !serviceState.errors[domain];
const isLoading = computed(() => !hydrated.value || (!returns.value.length && firstPassPending("return")));
const isEmpty = computed(() => !isLoading.value && !returns.value.length);
const errorBanner = syncDomainsError;                                  // "" when every active domain is fine

const refreshing = ref(false);
async function refresh() {
  refreshing.value = true;
  try { await syncNow(); } catch { /* the failure shows in syncDomainsError */ } finally { refreshing.value = false; }
}

const { markReceived } = useReturnActions();                           // PUT, then refreshAfterMutation("return", { returnId })
</script>
```

`<ReturnNotes :return-id="selectedReturnId">` only reads: `useLiveEntity(appDb.tables.returnNotes, …)`.

## Recipe: activation in a composable

A composable may own the list and the owner when several pages share it. Its file contains both
calls (lint checks that), and the page still wires both Ionic hooks:

```ts
// src/composables/useReturnsPolling.ts
export function useReturnsPolling(facilityId: MaybeRefOrGetter<string | undefined>) {
  const owner = createSyncDomainOwner("returnsPolling");   // inside the function: one per caller instance
  const domains = () => {
    const id = toValue(facilityId);
    return id ? [{ name: "return", intervalMs: 10_000, args: { facilityId: id } }] : [];
  };
  return {
    activate: () => activateSyncDomains(domains(), owner),
    deactivate: () => deactivateSyncDomains(owner),
  };
}

// the page
const polling = useReturnsPolling(() => props.facilityId);
onIonViewWillEnter(() => void polling.activate());
onIonViewDidLeave(() => void polling.deactivate());
```

Lint only sees `activateSyncDomains` in the composable file, so it can't check that the page calls
`deactivate()` on leave: always pair the two hooks. A pure util may build the `[{ name, args }]` list
from parameters (Company's `utils/shopifyFulfillment.ts`); the calls stay in the composable or page.

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| A child component calls `activateSyncDomains` | it replaces the page's set: the page's lists stop polling | the page includes the child's domain in its one list |
| Two composables on one page each activate | the second wipes the first | one list, one call |
| `onMounted` / `onUnmounted` instead of the Ionic hooks | polling continues on the back stack, or never restarts on return | `onIonViewWillEnter` / `onIonViewDidLeave` |
| A fixed owner string (`const OWNER = "returns"`) or one owner at module scope shared by pages | one page's leave stops another's polling | `createSyncDomainOwner` in setup or inside the composable function |
| `deactivateSyncDomains()` with no owner | clears the page being entered | pass the owner (lint rejects the bare call) |
| Skeleton until `hydrated` only | "No returns" flashes before the first poll lands | also wait on `serviceState.syncedAt[name]` / `errors[name]` |
| Skeleton until `syncDomainsReady` | it is true before any data arrives | the same `syncedAt` check |
| Refresh button calls `activateSyncDomains` with the same list | nothing re-runs: those activations keep their clocks | `syncNow()` (all screen domains) |
| Activating a domain while its scope arg is still `undefined` | an unscoped pass caches another scope's rows | activate `[]`, then again from the `watch` once known |
| A `watch` that activates while the page is in the back stack | a hidden page takes the worker from the visible one | guard with an `isActive` flag set by the two hooks |
| Class B domains (`facility`, `status`, …) in the list | nothing gained, worker churn | they run at login; read them with `useSeedData()` / `useLiveEntity` |

## Lint (the app build enforces these)

| Message starts | Fix |
|---|---|
| "activateSyncDomains without a matching deactivateSyncDomains(owner) in this file" | deactivate with the same owner in the same file |
| "This page activates sync domains but has no onIonViewDidLeave" | add `onIonViewDidLeave(() => deactivateSyncDomains(SYNC_OWNER))` |
| "Pass the owner: deactivateSyncDomains(SYNC_OWNER)" | pass the owner |

## Before you finish

- [ ] Every class A domain the screen and its children show is in the page's one list; no class B domain is.
- [ ] Owner from `createSyncDomainOwner`, activate in `onIonViewWillEnter`, deactivate with it in `onIonViewDidLeave`.
- [ ] Arg changes re-activate the full list with the same owner, only while the page is active.
- [ ] Loading waits on `serviceState.syncedAt[name]` (or an error); empty shows only after it.
- [ ] Refresh calls `syncNow()`; writes reconcile with `refreshAfterMutation` / `syncNow()`.
- [ ] `pnpm build` passes in the app.
