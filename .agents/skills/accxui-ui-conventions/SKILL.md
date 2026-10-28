---
name: accxui-ui-conventions
description: Use when building or changing a page, component, modal, popover, alert, form, menu or the Settings page in any AccxUI app (apps/company, apps/order-manager, apps/bopis, apps/fulfillment or a new one), or a shared component in common/components. Triggers include ion-page / ion-header / ion-toolbar / ion-content, ion-menu / Menu.vue / ion-split-pane, modalController / popoverController / alertController, closeModal, ion-fab, ion-searchbar, ion-segment, ion-infinite-scroll, ion-skeleton-text, empty-state, list-item, overline, --spacer-*, standalone-hidden, theme.css / settings.css, class="settings", user-profile / section-header, StatCard, Sparkline, RadioFacetGroup, DxpOmsInstanceFooter, DxpShopifyImg, Logo, ImageModal, v-image-preview, v-segment-height, ionicons/icons, data-testid, form validation, error-text, ion-invalid / ion-touched, useFormValidator, useFieldValidator, buildYupSchema, vee-validate, yup.
---

# UI conventions: pages, overlays, states, framework components, forms

All four apps share one look: Ionic in **`md` mode**, the framework's `theme.css` / `settings.css`,
and the same page, modal and Settings structures. Match them; a screen that invents its own layout
reads as a different product. Translation of every string is **accxui-common-helpers**; the
data behind a list (loading vs empty) is **accxui-page-sync** / **accxui-app-db-access**.

## Rules

1. **Ionic components and utilities first.** `ion-*` components, Ionic CSS utilities
   (`ion-padding`, `ion-text-center`, `ion-margin-top`), the theme's spacer variables
   (`var(--spacer-sm)` etc.) and Ionic colors (`color="danger"`, `var(--ion-color-medium)`). No
   other UI library, no hardcoded hex colors or pixel spacing where a variable exists.
2. **Icons only from `ionicons/icons`**, imported by name and bound: `:icon="closeOutline"`.
3. **Overlays are opened from script** with `modalController` / `popoverController` /
   `alertController`, by the view that owns the flow. Inline `<ion-modal>` / `<ion-popover>` only
   for a trigger-bound picker (`trigger="…"`). Never `<ion-alert>`, never `window.alert` / `confirm`
   (lint rejects `alert`).
4. **Every user-facing string goes through `translate`**, including `aria-label`s, alert buttons and
   empty states.
5. **Status badges use `commonUtil.getStatusColor(statusId)`**, product images `<DxpShopifyImg>`,
   loaders the `emitter` (**accxui-common-helpers**).
6. **Add a `data-testid`** to interactive elements and to loading / empty / error states in new
   markup (`apps/bopis/testidguideline.md`, summarised under Test ids).

## A page

```vue
<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-menu-button /></ion-buttons>   <!-- detail pages: <ion-back-button default-href="/audits" /> -->
        <ion-title>{{ translate("Audits") }}</ion-title>
        <ion-buttons slot="end">
          <ion-button :aria-label="translate('Refresh')" @click="refresh()"><ion-icon slot="icon-only" :icon="refreshOutline" /></ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-searchbar v-model="query" :placeholder="translate('Search audits')" data-testid="audits-search" />

      <template v-if="isLoading">
        <ion-item v-for="n in 5" :key="n"><ion-label><ion-skeleton-text animated style="width: 70%" /></ion-label></ion-item>
      </template>
      <div v-else-if="isEmpty" class="empty-state" data-testid="audits-empty">
        <p>{{ translate("No audits found") }}</p>
      </div>
      <ion-list v-else>
        <ion-item v-for="audit in audits" :key="audit.auditId" button :router-link="`/audits/${audit.auditId}`" :data-testid="`audits-row-${audit.auditId}`">
          <ion-label>
            {{ audit.name }}
            <p>{{ seed.facilityName(audit.facilityId) }}</p>
          </ion-label>
          <ion-badge slot="end" :color="commonUtil.getStatusColor(audit.statusId)">{{ seed.statusDescription(audit.statusId) }}</ion-badge>
        </ion-item>
      </ion-list>

      <ion-infinite-scroll v-if="hasMore" @ionInfinite="loadMore($event)"><ion-infinite-scroll-content /></ion-infinite-scroll>

      <ion-fab vertical="bottom" horizontal="end" slot="fixed">
        <ion-fab-button :aria-label="translate('Create audit')" @click="openCreateModal()" data-testid="audits-create-btn"><ion-icon :icon="addOutline" /></ion-fab-button>
      </ion-fab>
    </ion-content>
  </ion-page>
</template>
```

- **Loading vs empty:** skeleton while not loaded, `.empty-state` only once loading is done and there
  are no rows (with an app db: `hydrated`, plus the first-pass check for polled lists). A spinner
  inside `.empty-state` is fine for a modal's short load.
- **Create / primary action:** an `ion-fab` at the bottom end; save in a modal is also an `ion-fab`.
- **Segments:** `ion-segment` + `ion-segment-button`; wrap the switched content in
  `<div :key="id" v-segment-height="selectedSegment">` so switching never makes the page jump
  (register the directive, below).
- **Wide tables:** `.list-item` from `theme.css` is the responsive row grid: two columns on mobile
  (first and last child), children marked `.tablet` from 700 px, all from 991 px. Set `--columns-desktop`
  on the element when the row has a different number of columns.

## The app shell and menu

```vue
<!-- App.vue: the split pane; Menu hidden on /login -->
<ion-split-pane content-id="main-content" when="lg">
  <Menu v-if="route.name !== 'Login'" />
  <ion-router-outlet id="main-content" />
</ion-split-pane>

<!-- components/Menu.vue -->
<ion-menu side="start" content-id="main-content" type="overlay" :disabled="!isAuthenticated">
  <ion-header><ion-toolbar><ion-title>{{ translate("Inventory Audit") }}</ion-title></ion-toolbar></ion-header>
  <ion-content>
    <ion-list>
      <ion-menu-toggle :auto-hide="false">
        <ion-item v-if="hasPermission(Actions.APP_AUDITS_VIEW)" button router-link="/audits" router-direction="root" :class="{ selected: selectedPage.startsWith('/audits') }">
          <ion-icon slot="start" :icon="clipboardOutline" />
          <ion-label>{{ translate("Audits") }}</ion-label>
        </ion-item>
      </ion-menu-toggle>
      <ion-item-divider color="light"><ion-label>{{ translate("Setup") }}</ion-label></ion-item-divider>
      <!-- … -->
    </ion-list>
  </ion-content>
  <DxpOmsInstanceFooter v-if="isAuthenticated" />
</ion-menu>
```

BOPIS uses bottom tabs instead (`views/Tabs.vue`); follow the app you're in.

## The Settings page

`<ion-page class="settings">` picks up `settings.css` (the section grid and the profile card). In a
new page, use the class and add no grid CSS of your own. Existing Settings pages still re-declare the
grid in `<style scoped>` (all four apps; Company's doesn't set the class at all): leave theirs alone
unless asked.

```vue
<ion-page class="settings">
  <ion-header><ion-toolbar>
    <ion-buttons slot="start"><ion-menu-button /></ion-buttons>
    <ion-title>{{ translate("Settings") }}</ion-title>
  </ion-toolbar></ion-header>
  <ion-content>
    <div class="user-profile">
      <ion-card>
        <ion-item lines="full">
          <ion-card-header class="ion-no-padding ion-padding-vertical">
            <ion-card-subtitle>{{ userProfile.username || userProfile.userId }}</ion-card-subtitle>
            <ion-card-title>{{ userProfile.userFullName || userProfile.userId }}</ion-card-title>
          </ion-card-header>
        </ion-item>
        <ion-button v-if="!commonUtil.isAppEmbedded()" color="danger" @click="logout()" data-testid="settings-logout-btn">{{ translate("Logout") }}</ion-button>
        <ion-button fill="outline" :standalone-hidden="!hasPermission(Actions.APP_PWA_STANDALONE_ACCESS)" @click="goToLaunchpad()">
          {{ translate("Go to Launchpad") }}<ion-icon slot="end" :icon="openOutline" />
        </ion-button>
      </ion-card>
    </div>

    <div class="section-header"><h1>{{ translate("OMS") }}</h1></div>
    <section>
      <!-- OMS instance card, product store / facility cards -->
    </section>
    <hr />
    <DxpAppVersionInfo />          <!-- app-local today: copy Order Manager's components/settings/ -->
    <section>
      <!-- time zone, language, product identifier, app preferences, the data status card (useDbStatus) -->
      <ion-card>
        <ion-card-header><ion-card-title>{{ translate("Show shipped orders") }}</ion-card-title></ion-card-header>
        <ion-card-content>{{ translate("Shipped orders stay in the list for seven days.") }}</ion-card-content>
        <ion-item lines="none">
          <ion-toggle label-placement="start" :checked="showShipped" @ionChange="setShowShipped($event.detail.checked)">{{ translate("Show shipped") }}</ion-toggle>
        </ion-item>
      </ion-card>
    </section>
  </ion-content>
</ion-page>
```

- A setting card is `ion-card-header` (title), `ion-card-content` (one sentence on what it does),
  then the control in an `ion-item lines="none"`.
- `[standalone-hidden="true"]` hides an element only when the PWA runs installed (`theme.css`).
- The data status card is **accxui-seed-data** (`useDbStatus`); the time zone, language, app version
  and product identifier cards are app-local components (`components/settings/` in Order Manager), not
  `@common`.

## Modals, popovers, alerts

```ts
// the owning view
const modal = await modalController.create({ component: CreateAuditModal, componentProps: { facilityId } });
modal.onDidDismiss().then(({ data }) => { if(data?.created) { void refresh(); } });
await modal.present();
```

```vue
<!-- CreateAuditModal.vue: a bare header + content, no ion-page -->
<ion-header>
  <ion-toolbar>
    <ion-buttons slot="start">
      <ion-button :aria-label="translate('Close')" @click="closeModal()"><ion-icon slot="icon-only" :icon="closeOutline" /></ion-button>
    </ion-buttons>
    <ion-title>{{ translate("Create audit") }}</ion-title>
  </ion-toolbar>
</ion-header>
<ion-content>
  <!-- form -->
  <ion-fab vertical="bottom" horizontal="end" slot="fixed">
    <ion-fab-button :disabled="!canSave" @click="save()"><ion-icon :icon="saveOutline" /></ion-fab-button>
  </ion-fab>
</ion-content>
<!-- closeModal = () => modalController.dismiss({ dismissed: true });  after a save: modalController.dismiss({ created: true }) -->
```

```ts
const alert = await alertController.create({
  header: translate("Cancel audit"),
  message: translate("{count} counts will be discarded.", { count }),
  buttons: [{ text: translate("Keep"), role: "cancel" }, { text: translate("Cancel audit"), handler: () => { void cancelAudit(); } }],
});
await alert.present();

const popover = await popoverController.create({ component: AuditActionsPopover, componentProps: { audit }, event, showBackdrop: false });
await popover.present();
```

A modal or popover lives with its domain (`components/audits/`), not in a generic folder.

## Framework components and directives (`@common`)

| Use | What | Notes |
|---|---|---|
| `<DxpShopifyImg :src="url" size="small" />` | product image with a fallback | inside `<ion-thumbnail>`; `size` resizes Shopify CDN urls only |
| `<DxpOmsInstanceFooter />` | the menu footer: instance, time zone (red when it differs from the browser's), optional store picker | props `productStores`, `currentProductStoreId`; emits `update:productStore(id, event)` (revert the select through `event` on failure) |
| `<StatCard :title :stat :subtitle button>` | a dashboard number card; default slot below the number | slots `#title`, `#stat`, `#subtitle`; Order Manager `views/Funnel.vue` |
| `<Sparkline :points="[…]" color="danger" :label />` | an inline trend line | give `label` unless it is decorative |
| `<RadioFacetGroup v-model :options>` | horizontally scrolling radio chips, `{ value, primary, secondary?, meta?, disabled? }`, slot `#option` | no app uses it yet |
| `<FastTravel current-app="<id>" />` | the Cmd/Ctrl+K app switcher | **accxui-fast-travel** |
| `Logo` | the light / dark HotWax logo | not in the barrel: `import Logo from "@common/components/Logo.vue"` |
| `v-image-preview="{ mainImageUrl, productName }"` | tap a thumbnail to open the full image | register `app.directive("image-preview", imagePreview)` in `main.ts`; it reads the value once, so put `:key="mainImageUrl"` on the element |
| `v-segment-height="selectedSegment"` | keeps height and scroll steady when a segment switches | register `app.directive("segment-height", segmentHeight)`; change `:key` to reset |

A component two apps both need belongs in `common/components` (**accxui-framework-change**), not
copied between apps (the drifted `Dxp*` Settings copies in BOPIS and Fulfillment are the warning).

## Test ids

From `apps/bopis/testidguideline.md`: kebab-case `<scope>-<feature>-<element>-<type>`, type suffixes
`-btn -input -search -toggle -checkbox -radio -select -tab -segment -chip -card -row -list -section
-modal -popover -loading -empty -error`. Put it on the Ionic element the user interacts with (the
`ion-input` / `ion-searchbar` wrapper); in a `v-for` use the entity id, never the index
(`audits-row-${auditId}`); overlays get ids on their trigger, confirm and cancel. Never rename an
existing id: tests depend on it.

## Forms and validation

Today's apps validate by hand with Ionic's own field states. Follow that:

```vue
<ion-input
  v-model="form.auditName"
  label-placement="floating"
  :label="translate('Name')"
  :class="{ 'ion-invalid': !!errors.auditName, 'ion-touched': touched.auditName }"
  :error-text="errors.auditName"
  :helper-text="translate('Shown on the count sheets')"
  @ionBlur="touched.auditName = true"
  data-testid="audit-create-name-input"
/>
```

```ts
const form = reactive({ auditName: "", facilityId: "" });
const touched = reactive<Record<string, boolean>>({});
const errors = computed(() => ({
  auditName: !form.auditName.trim() ? translate("Name is required") : form.auditName.length > 60 ? translate("Name cannot be more than 60 characters") : "",
}));
const canSave = computed(() => Object.values(errors.value).every((message) => !message) && !!form.facilityId);
```

- `error-text` shows only while the input has both `ion-invalid` and `ion-touched`; bind the classes
  rather than adding them with `classList` (older Company modals do; leave those as they are).
- Required fields: `<div slot="label">{{ translate("Name") }} <ion-text color="danger">*</ion-text></div>`.
- Disable the save button while `!canSave`, and check again in the handler.
- Email / password formats: `commonUtil.isValidEmail`, `isValidPassword`.

**The framework validators** (`vee-validate` + `yup`) exist but no app uses them yet, and they are
not exported from `@common`: `useFormValidator(fields, initialValues?)` from
`@common/composables/useFormValidation` (returns `{ values, errors, validate, isFormValid() }`),
`useFieldValidator(name, rules, initialValue?)` from `@common/composables/useFieldValidation`
(`{ value, errorMessage, validate, isFieldValid() }`). Rules: `"required"`, `"email"`, `"number"`,
`"mobile"`, `{ type: "min" | "max" | "minLength" | "maxLength", value }`, with `min` / `max` after
`"number"`. Their messages are **fixed English** ("This field is required"), not translated, so
don't show them in a localized app without wrapping them; prefer the pattern above until that is fixed
in `common/`.

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| `onMounted` work on a page | doesn't re-run when the user comes back (Ionic keeps pages mounted) | `onIonViewWillEnter` |
| A modal component wrapped in `<ion-page>` | double header, broken scrolling | bare `ion-header` + `ion-content` |
| Empty state shown before data loaded | "No records" flashes | skeleton until loaded |
| Icon-only button without `aria-label` | unreadable for screen readers | `:aria-label="translate('…')"` |
| Hardcoded colors on status chips | drift between apps | `getStatusColor` |
| Settings grid re-declared in `<style scoped>` | duplicated CSS | `class="settings"` on `ion-page` |
| `v-image-preview` without `:key` on a changing image | opens the old image | `:key="mainImageUrl"` |
| A new `data-testid` with an index | flaky tests | the entity id |
| Copying a component from another app | two versions drift | move it into `common/` |
| `useFormValidator` messages shown as is | English text in a translated UI | the manual pattern, or translate in `common/` first |

## iPad keyboard and input visibility

For iOS keyboard viewport handling, use `useIosKeyboardScroll` with its paired
`supportsIosKeyboardScroll` Ionic configuration. See `docs/IOS_KEYBOARD_SCROLL.md`
for opt-in setup, pinned elements, inner scroll containers, and physical-device
validation. Keep app-specific layout selectors in the app.
