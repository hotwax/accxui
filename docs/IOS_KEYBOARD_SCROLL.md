# iOS keyboard scrolling

Opt in once per app. This capability uses VisualViewport to reveal the complete
focused Ionic input above the iOS keyboard, including keyboard dismissal without
blur and a hardware keyboard accessory bar. It measures the stable layout height
and clears Safari document panning so Ionic headers remain visible. It is inactive on other platforms
or without VisualViewport; pinch zoom does not trigger scrolling.

In `main.ts`:

```ts
import { supportsIosKeyboardScroll } from '@common';
app.use(IonicVue, { mode: 'md', scrollAssist: !supportsIosKeyboardScroll() });
```

In `App.vue` setup:

```ts
import { useIosKeyboardScroll } from '@common';
useIosKeyboardScroll();
```

These two changes must travel together: the shared helper replaces Ionic scroll
assist only where supported. Other apps retain their existing behavior.

## Layout integration

Prefer one scrolling container. This helper cannot repair conflicting fixed
heights or arbitrary clipping. Receiving removes its nested main scroller and
passes `{ pinnedElementSelector: '.scanner' }` to keep focused fields clear of
its sticky scanner.

For intentional split panes or virtual lists, pass a `scrollContainerSelector`
matching their scrollable elements. Cycle Count uses `.count-dashboard,
.virtual-list`. Only matching ancestors of the focused input are scrolled,
from innermost to outermost, followed by Ionic's own scroll element. The helper
does not recreate virtual rows or change item keys, measurements, or data.

The helper temporarily owns `--keyboard-offset` on the focused ion-content,
restores the previous inline value on blur/content changes/unmount, cancels
obsolete asynchronous work, and removes listeners on unmount. Do not mount
multiple instances in one app. There is no shared module-level session state.

## Verification

Run `pnpm exec vitest run common/tests/useIosKeyboardScroll.spec.ts --exclude
'apps/**'` at the framework root. The exclusion prevents app worktree symlinks
from recursively collecting duplicate framework specs.

On a physical iPad connected to a real test OMS, verify Receiving quantity entry
on short and long TOs, its sticky scanner, Cycle Count hand-counted quantity
entry and session search, full keyboard and accessory bar, dismissal without
blur, refocus, and portrait/landscape. Clear unsaved test quantities and leave
without saving progress or submitting counts. Framework tests alone do not
prove native keyboard behavior.

Apps adopting this export depend on the framework change being available in
their build checkout. Merge the framework PR before the app PRs; release and tag
AccxUI before pinning an app release to that tag.
