# DxpModal

**Job:** every AccxUI modal renders `DxpModal`. It owns the frame and how the modal ends. The modal owns its content and what Save does.

## It always

- **Draws the frame.** The close X at the start of the header, the title, an optional `toolbar` slot under the title for a searchbar or segments, your content, and a Save button at the bottom end. Save appears only if the modal has something to confirm.
- **Exit path.** This covers the X, a backdrop tap, Escape, a swipe and Android back. If the modal is dirty, it asks first, either with the default ("Discard changes", "What you entered will be lost.", Keep editing, Discard) or with the modal's own `exitAlert`. It closes with the role `cancel` and no data.
- **Confirm path.** Save runs the modal's `confirm()`. While that runs, Save shows a spinner, the X is disabled, and every other way out is refused.
  - If `confirm()` throws, the modal stays open with a toast. A thrown `Error` or string is shown as written; anything else shows "Something went wrong. Please try again.". `persistError` keeps the toast up with a Dismiss button.
  - Otherwise it closes with the role `confirm` and whatever `confirm()` returned, or `true` if it returned nothing.

## API

```vue
<DxpModal :title="…" :state="taskModal" confirm-label="…" :confirm-icon="…">
  <template #toolbar>…</template>
  …content…
</DxpModal>
```

```ts
import { DxpModal, openModal, useDxpModal } from "@common";

const taskModal = useDxpModal({ dirty, canConfirm, confirm, exitAlert, confirmAlert, persistError }); // all optional
const result = await openModal(Component, props); // confirm's value, or undefined for any other way out
```

- **One modal, one object.** Each modal gets one `useDxpModal()`, passed as `:state`. A read-only modal omits both.
- **The modal says when it's dirty.** `DxpModal` never guesses.
- **What `confirm()` does is the modal's choice.** It can return a value for the caller to act on, or do the save itself.

## Rules

- A caller passes a modal data props, never functions.
- A modal inside `DxpModal` has no `ion-header`, close button or Save button of its own.
- Every app that uses it carries these locale keys: `Discard changes`, `What you entered will be lost.`, `Keep editing`, `Discard`, `Something went wrong. Please try again.`, plus `Close`, `Save`, `Cancel` and `Dismiss`.

## What it won't do, until at least three modals need the same thing

- multi-step Back and Next;
- a second action beside Save;
- a footer of named decisions;
- telling the caller something changed when the modal closes without Save.

Modals that need these keep their current code until then.
