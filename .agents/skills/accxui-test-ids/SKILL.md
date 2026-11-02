---
name: accxui-test-ids
description: Use when adding, auditing or standardising data-testid attributes in any AccxUI app under apps/* (Receiving, Transfers, BOPIS, Fulfillment, Company, Order Manager, Inventory Count or a new one) or in a shared component in common/components, or when picking a selector for a Playwright / unit test. Triggers include data-testid, :data-testid, test id, testid, testidguideline.md, getByTestId, find('[data-testid=…]'), "add test ids to this page / app", "make this testable", a selector that broke after a copy or layout change, an id with an index in a v-for, an id showing a literal ${...}, alertController / modalController / popoverController buttons without ids, htmlAttributes, and a reusable component whose inner elements a parent test can't reach.
---

# Test ids: `data-testid` in AccxUI apps

`data-testid` is the one selector end-to-end and unit tests use, so a test survives copy, style and
layout changes. Receiving, Transfers, BOPIS and Inventory Count each carry the same
`testidguideline.md` and Receiving is the most complete example (about 185 ids across every view
and modal); this skill is that guideline plus what the code shows. It applies the same way in every
app, with or without an app db.

## Rules

1. **Name:** kebab-case `<scope>-<feature>-<element>-<type>`. `scope` is the page or component
   (`purchase-orders-page`, `transfer-order-detail-page`, `select-facility`,
   `receiving-history-modal`). End with a type suffix:
   - actions / inputs: `-btn` `-input` `-search` `-toggle` `-checkbox` `-radio` `-select`
   - structure: `-tab` `-segment` `-chip` `-card` `-row` `-list` `-section` `-content` `-footer`
   - overlays: `-modal` `-popover`
   - states: `-loading` `-empty-state` (or `-empty`) `-error`
   Same intent, same suffix across the app: every save is `*-save-btn`, every close `*-close-btn`.
   Follow the app's existing spelling where it already has one (BOPIS uses `-button` in places and its
   Playwright tests depend on it).
2. **On the element the user acts on**, not a wrapper: `ion-button`, `ion-item[button]`,
   `ion-input`, `ion-searchbar`, `ion-select`, `ion-select-option`, `ion-toggle`, `ion-checkbox`,
   `ion-radio`, `ion-segment-button`, `ion-fab-button`, `ion-chip`, `ion-infinite-scroll`,
   `ion-refresher`. For inputs keep it on the Ionic wrapper; the test reaches the native `<input>`
   inside it.
3. **In a `v-for`, bind with `:` and use the entity's business key, never the index.**
   `:data-testid="\`purchase-orders-row-${order.orderId}\`"`. Without the `:` the id is the literal
   text `…-${order.orderId}` on every row. No stable id: fall back to another stable key, as Receiving does with
   `item.orderItemSeqId || item.productId`, never `index`.
4. **Ids are unique within what is visible at once.** The same item shown in two segments gets the
   segment in its id (`transfer-order-detail-page-open-item-card-…` vs
   `…-received-item-card-…`); the same modal reused for two flows gets the flow in its scope
   (`purchase-order-add-product-…` vs `transfer-order-add-product-…`).
5. **Never rename or remove an existing id** unless asked: a Playwright test or a QA script may use
   it. Before touching one, `grep -rn "<id>" apps/<app>/playwright apps/<app>/tests` (and ask if QA
   keeps tests elsewhere). Fixing a broken one (rule 3) is allowed; say so in the summary.
6. **Ids change nothing else.** Never style by `[data-testid]`, never read one in script, never
   change markup, logic or classes while adding them.

## What gets an id

In this order when going through a template:

1. Navigation: menu, back, close, open buttons in the header.
2. Primary and destructive actions: save, submit, receive, complete, delete, cancel, the FAB.
3. Form controls: inputs, searchbars, selects (and their options when a test picks one), toggles,
   checkboxes, radios, date buttons.
4. Filters, sorts, `ion-segment` and each `ion-segment-button`.
5. Entity rows / cards and each row-level action (`…-qty-input-${id}`, `…-receive-all-btn-${id}`).
6. State blocks: loading, empty, error. Each `v-if` / `v-else-if` / `v-else` branch that is a
   distinct state gets its own id.
7. Pagination: `ion-infinite-scroll`, "load more" button, `ion-refresher`.
8. Overlays: the trigger, the overlay's content, its inputs, confirm and cancel (below).

Status text a test asserts (a badge, a chip with the order id) gets one too. Decorative icons,
images, layout wrappers and plain labels don't.

## Recipes

A list page (from Receiving's `PurchaseOrders.vue` / `TransferOrders.vue`):

```vue
<ion-menu-button slot="start" data-testid="purchase-orders-page-menu-btn" />
<ion-searchbar v-model="queryString" data-testid="purchase-orders-page-search-input" />
<ion-segment v-model="selectedSegment" data-testid="purchase-orders-page-segment">
  <ion-segment-button value="open" data-testid="purchase-orders-page-open-tab">…</ion-segment-button>
  <ion-segment-button value="completed" data-testid="purchase-orders-page-completed-tab">…</ion-segment-button>
</ion-segment>
<ion-content data-testid="purchase-orders-page-content">
  <ion-item v-for="order in orders" :key="order.orderId" button
    :data-testid="`purchase-orders-page-row-${order.orderId}`">…</ion-item>
  <div v-if="isScrollable" data-testid="purchase-orders-page-load-more-section">
    <ion-button fill="outline" @click="loadMore()" data-testid="purchase-orders-page-load-more-btn">…</ion-button>
  </div>
  <div v-else-if="!orders.length" class="empty-state" data-testid="purchase-orders-page-empty-state">…</div>
  <ion-refresher slot="fixed" @ionRefresh="refresh($event)" data-testid="purchase-orders-page-refresher">…</ion-refresher>
</ion-content>
```

A modal component (from `SelectFacilityModal.vue`): scope is the modal's name.

```vue
<ion-button @click="closeModal()" data-testid="select-facility-close-btn">…</ion-button>
<ion-searchbar data-testid="select-facility-searchbar" … />
<ion-radio-group v-model="selectedFacilityId" data-testid="select-facility-radio-group">
  <ion-item v-for="facility in facilities" :key="facility.facilityId"
    :data-testid="`select-facility-row-${facility.facilityId}`">…</ion-item>
</ion-radio-group>
<ion-fab-button @click="save()" data-testid="select-facility-save-btn">…</ion-fab-button>
```

**Alerts, and overlays created in script**, have no template: set the ids in the options. Ionic
takes `htmlAttributes` on each alert button and on the overlay itself (Fulfillment's
`ShipTransferOrder.vue` does this for its buttons; Receiving's alerts don't have ids yet):

```ts
const alert = await alertController.create({
  header: translate("Close purchase order items"),
  htmlAttributes: { "data-testid": "purchase-order-close-items-alert" },
  inputs: [{ name: "reason", type: "text", attributes: { "data-testid": "purchase-order-close-items-reason-input" } }],
  buttons: [
    { text: translate("Cancel"), role: "cancel", htmlAttributes: { "data-testid": "purchase-order-close-items-cancel-btn" } },
    { text: translate("Close"), handler: closeItems, htmlAttributes: { "data-testid": "purchase-order-close-items-confirm-btn" } },
  ],
});
```

`modalController.create` / `popoverController.create` accept the same top-level `htmlAttributes`
for an id on the overlay element; ids inside it go in the modal component's own template.

**Reusable components.** A single-root component already passes a parent's `data-testid` to its
root through Vue's attribute fallthrough: `<DxpShopifyImg data-testid="…" />` just works. Add a
`testId` prop only when the id must land on an inner element, or the component has several roots or
`inheritAttrs: false`; then build the inner ids from it (`${testId}-close-btn`). Receiving's
`Image.vue` is the existing example (`defineProps(['src', 'testId'])`, `:data-testid="testId"`).
In `common/components`, adding one is a framework change (**accxui-framework-change**).

## Using the ids in tests

- Playwright (BOPIS's `playwright/` is the existing setup; **accxui-app-testing**):
  `page.getByTestId("purchase-orders-page-search-input")`. To type into an Ionic field, target the
  native input inside the wrapper: `page.getByTestId("…-qty-input-10001").locator("input").fill("3")`.
- Unit specs: `wrapper.find('[data-testid="select-facility-save-btn"]')`.
- Dynamic ids in a test are built from the same key the template uses, so a test never depends on
  row order.

## Doing an app or a page

1. Read the template and script; list targets in the order under "What gets an id".
2. Keep every existing valid id. Fix only broken ones: static attribute with `${…}`, an index, a
   duplicate in the same view.
3. Add the missing ones with the app's existing scope names (grep the app for the page's scope
   first, so a new id in `PurchaseOrderDetail.vue` starts `purchase-order-detail-page-`).
4. Scan for mistakes before finishing (from the app's folder):

   ```bash
   grep -rnE '(^|[^:])data-testid="[^"]*\$\{' src
   ```
   ```bash
   grep -rnE 'data-testid="[^"]*\$\{(index|idx|i)\}' src
   ```
   ```bash
   for f in $(grep -rl 'data-testid="' src); do grep -oE '(^|[^:])data-testid="[^"$]*"' "$f" | sed 's/^[^d]*//' | sort | uniq -d | sed "s#^#$f: #"; done
   ```
   The first two must print nothing. The third lists static ids used twice in one file: fine only
   when they sit in `v-if` / `v-else` branches that never show together.
5. Run the app's checks (`pnpm build` / `npx eslint <files>` per AGENTS.md "Checks"): the change is
   template-only, so they should pass unchanged.
6. Report: files changed, ids added / kept / fixed (with counts), naming decisions, and that no
   logic, markup or style changed.

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| `data-testid="row-${item.id}"` (no `:`) | every row has the literal id `row-${item.id}` | `:data-testid="\`row-${item.id}\`"` |
| `` `row-${index}` `` | ids move when the list sorts or filters; tests hit the wrong row | the entity id or another stable key |
| Id on the `ion-label` or a `div` around a button | the test clicks something that has no handler | on the `ion-button` / `ion-item[button]` |
| Same id on an item in two segments | `getByTestId` matches two elements, Playwright strict mode fails | put the segment in the id |
| Alert buttons without `htmlAttributes` | the confirm path can't be tested by id | `htmlAttributes: { "data-testid": … }` per button |
| Renaming `ready-pickup-button` to `…-btn` for consistency | BOPIS's Playwright suite breaks | keep it; new ids follow the convention |
| Generic ids like `save-btn` or `search` | duplicates once a modal opens over the page | scope prefix: `select-facility-save-btn` |
| Styling or logic on `[data-testid]` | tests and UI become coupled | classes for style, refs for logic |
