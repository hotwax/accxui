# `workerRemoteApi`: HTTP inside a sync domain

`@common/core/workerRemoteApi` is the only way a sync domain (`src/workers/**`, `common/db/seed/*`)
talks to the server. It uses `fetch`, not axios: no interceptors, no cookies, no `commonUtil`, so it
runs in the worker. Main-thread code uses `api()` instead (**accxui-app-layers**), never this.

```ts
import { pageAll, pageNewestFirst, unwrapCollection, workerGet, workerPost } from "@common/core/workerRemoteApi";
```

## The context

Every call takes the domain's `SyncContext` first (`sync(ctx, args)`, `refetchOne(ctx, pk, args)`):

- `ctx.maargUrl`: the Maarg REST base (`commonUtil.getMaargURL()` on the main thread, so it already
  ends in `/rest/s1/`). URLs are relative to it: `"admin/facilities"`, `"oms/returns"`.
- `ctx.token`: sent as `Authorization: Bearer …`. The main thread publishes each new token to the
  worker; never read a cookie or `useAuth` here.
- `ctx.omsInstance`, `ctx.now`.

## Single requests

| Call | Does |
|---|---|
| `workerGet(ctx, url, params?)` | `GET`; resolves the parsed JSON |
| `workerPost(ctx, url, data?)` | `POST` with a JSON body; for search-style reads (a Solr query, a data document) |

There is **no PUT or DELETE** on purpose: domains read. A write to the server happens on the main
thread (`api()` in a composable or store), then reconciles through the domain
(**accxui-app-db-access**).

Both behave the same way:

- **Params:** `undefined` / `null` values are dropped; an **array is sent as repeated keys**
  (`{ statusId: ["A", "B"], statusId_op: "in" }` → `statusId=A&statusId=B&statusId_op=in`), which is
  what Moqui needs. Never build a query string yourself with `new URLSearchParams(obj)`: it
  comma-joins (`statusId=A%2CB`), Moqui reads one literal value, and the request returns an empty list
  with status 200.
- **An empty body resolves `null`** (Moqui answers some empty lists with no body). Treat `null` as no
  rows, not as an error.
- **A failed response (non-2xx) rejects with the parsed error body as is** (not an `Error`), or an
  `Error("Request failed with status N")` when there is no body. Let it propagate: the harness
  records it on the domain (`serviceState.errors[name]`), and a `refetchOne` that throws makes
  `refreshAfterMutation` reject.
- No `commonUtil.hasError` here: check the shape you need, and throw when the answer is not usable.

The default export `workerRemoteApi({ url, method, data, params, baseURL, headers })` is the raw
form `workerGet` / `workerPost` wrap. Use those two instead; the raw form doesn't add the token.

## `unwrapCollection(resp, collectionKey)`

How every helper below finds the rows in an answer:

| `collectionKey` | Rows |
|---|---|
| `"facilityList"` | `resp.facilityList` if it is an array, otherwise **`[]`** |
| `null` or omitted | `resp` itself if it is an array; otherwise the **first array-valued property** of `resp`; otherwise `[]` |

So `null` is "a bare array, or whatever array the envelope holds". That guess is wrong for an
envelope with several arrays, and an error body unwraps to `[]`. A snapshot domain treats `[]` as "the
server has nothing" and prunes, which is why `strictCollection: true` exists (below).

## `pageAll(options)`: a complete set

For class B data: every page, then the caller replaces what it holds (`snapshotReplace`).
`defineSnapshotDomain` calls it for you; call it yourself in a hand-written domain.

| Option | Default | Meaning |
|---|---|---|
| `ctx`, `url` | required | as above |
| `collectionKey` | `undefined` | see `unwrapCollection` |
| `params` | `{}` | sent on every page |
| `batchSize` | `250` | page size. Each page sends **both** `pageIndex` / `pageSize` and `viewIndex` / `viewSize`, so it works on Moqui and OFBiz-style endpoints |
| `unpaged` | `false` | one request. It still sends `pageSize` / `viewSize` = `batchSize` (or 250), because Moqui returns **20 rows** when no size is given |
| `keyOf(row)` | the row's JSON | identity used to drop duplicates across pages, and to spot an endpoint that ignores `pageIndex` |
| `maxPages` | `40` | backstop (`40 × 250` = 10,000 rows) |
| `strictCollection` | `false` | throw unless the answer is exactly the declared shape (`resp[collectionKey]` is an array, or `resp` is an array when the key is `null`). **It also throws on an empty body (`null`)**, so don't set it on an endpoint that answers an empty list with no body; most seed domains leave it off |
| `requireComplete` | `false` | throw instead of returning a **truncated** set (backstop reached, or a page brought nothing new) |
| `label` | `url` | names the domain in warnings and errors |
| `signal` | none | an `AbortSignal`; checked before each page |

It stops at the first empty page, at a short page (fewer than `batchSize`), or when a page brings no
new keys (the server ignored `pageIndex`). By default the last two cases and the backstop only
`console.warn` and return what they have.

**A hand-written domain that replaces a table or scope with the result must pass
`requireComplete: true`** (and `strictCollection: true` when the shape is known and an empty list
comes back as `[]`, not as no body): a short read
otherwise prunes live rows. Nothing in the framework sets `requireComplete` for you, including
`defineSnapshotDomain`. Give `keyOf` the record's primary key, as Company's `organizationDomain.ts`
does (`keyOf: (row) => row?.partyId ? String(row.partyId) : undefined`); a row `keyOf` can't key is
kept.

```ts
const rows = await pageAll({
  ctx,
  url: "admin/organizations",
  collectionKey: null,
  strictCollection: true,
  requireComplete: true,
  params: { roleTypeId: "INTERNAL_ORGANIZATIO" },
  keyOf: (row) => (row?.partyId ? String(row.partyId) : undefined),
  label: "organization",
});
await organizations.snapshotReplace(rows);
```

## `pageNewestFirst(options)`: the newest slice

For class A data: pages a newest-first list until it has `total` rows, then the caller upserts
(`upsertMany`); it never replaces.

| Option | Meaning |
|---|---|
| `ctx`, `url`, `collectionKey` | as above |
| `params` | **required**; include the sort (`orderByField: "-lastUpdatedStamp"`) and any cursor (`lastUpdatedStamp_from`) |
| `total` | rows to collect (the result is cut to this many) |
| `batchSize` | page size; sends `pageIndex` / `pageSize` only |
| `keep(page)` | returns the rows worth keeping from a page; when it returns fewer than it was given, paging stops (the walk has reached rows already held) |
| `maxPages` (40), `label` | backstop and diagnostics |

`keepNewerThan(page, "lastUpdatedStamp", cursor)` from `@common/db/storage/projection` is the usual
`keep`: an endpoint's `_from` filter is often inclusive, and some ignore it. The cursor recipe is in
the main skill ("Class A, polled with a cursor").

## Mistakes

| Mistake | Result | Fix |
|---|---|---|
| `api()`, `fetch` or axios in a domain | fails in the worker, or no token | `workerGet` / `workerPost` |
| A query string built with `URLSearchParams` | arrays comma-joined; an empty list with 200 | pass `params` |
| `collectionKey: null` for an envelope `{ meta: [...], items: [...] }` | the first array (`meta`) is stored | the real key, and `strictCollection: true` |
| `pageAll` result passed to `snapshotReplace` without `requireComplete` | a truncated read prunes live rows | `requireComplete: true` |
| No `keyOf` on rows with volatile fields | duplicates not detected across pages | `keyOf` on the primary key |
| `unpaged` assumed to fetch everything | capped at `batchSize` (250) rows | page it, or raise `batchSize` |
| Treating a `null` answer as a failure | the domain errors on an empty list | `null` = no rows |
| Catching and swallowing a request error in `refetchOne` | `refreshAfterMutation` resolves `0`, the screen shows stale data | let it throw; return `0` only when there is honestly nothing to write |
| Writing to the server from a domain | a second writer outside the screen's flow | `api()` on the main thread, then reconcile |
