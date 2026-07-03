<template>
  <!--
    Fast Travel command palette. Mounted once near the app root; opens on Cmd/Ctrl+K (or via
    useFastTravel().open()). Arrow keys move the highlight, Enter jumps (Cmd/Ctrl+Enter opens in a
    new tab), Esc closes. Apps without a configured URL for this deployment render dimmed.
  -->
  <Teleport to="body">
    <div v-if="state.isOpen" class="ft-overlay" @click.self="close()">
      <div class="ft-panel" role="dialog" aria-modal="true" aria-label="Fast Travel">
          <div class="ft-search">
            <ion-icon :icon="searchOutline" aria-hidden="true" />
            <input
              ref="inputEl"
              class="ft-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              :value="state.query"
              :placeholder="translate('Jump to app…')"
              @input="setQuery(($event.target as HTMLInputElement).value)"
            />
            <span class="ft-kbd">esc</span>
          </div>

          <ul class="ft-list" ref="listEl">
            <li
              v-for="(app, i) in filteredApps"
              :key="app.id"
              class="ft-item"
              :class="{ selected: i === state.selectedIndex, disabled: !isNavigable(app) }"
              :data-index="i"
              @mousemove="state.selectedIndex = i"
              @click="onRowClick(i)"
            >
              <ion-icon class="ft-app-icon" :icon="app.icon" :color="app.color" aria-hidden="true" />
              <div class="ft-app-text">
                <span class="ft-app-name">{{ translate(app.name) }}</span>
                <span class="ft-app-desc">{{ translate(app.description) }}</span>
              </div>
              <span v-if="app.id === state.currentAppId" class="ft-tag">{{ translate("Current") }}</span>
              <span v-else-if="!app.baseUrl" class="ft-tag muted">{{ translate("Not configured") }}</span>
              <ion-icon v-else class="ft-go" :icon="arrowForwardOutline" aria-hidden="true" />
            </li>
            <li v-if="!filteredApps.length" class="ft-empty">{{ translate("No apps found") }}</li>
          </ul>

          <div class="ft-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> {{ translate("navigate") }}</span>
            <span><kbd>↵</kbd> {{ translate("open") }}</span>
            <span><kbd>esc</kbd> {{ translate("close") }}</span>
          </div>
        </div>
      </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, nextTick, ref, watch } from "vue";
import { IonIcon } from "@ionic/vue";
import { searchOutline, arrowForwardOutline } from "ionicons/icons";
import { translate } from "../core/i18n";
import { useFastTravel } from "../composables/useFastTravel";

const props = defineProps<{
  // Id (from the registry) of the app currently running — shown as "Current" and never a target.
  currentApp?: string;
}>();

const { state, filteredApps, setCurrentApp, isNavigable, open, close, toggle, setQuery, moveSelection, selectCurrent } = useFastTravel();

const inputEl = ref<HTMLInputElement | null>(null);
const listEl = ref<HTMLElement | null>(null);

function onKeydown(e: KeyboardEvent) {
  // Global toggle — Cmd/Ctrl+K from anywhere.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    toggle();
    return;
  }
  if (!state.isOpen) return;
  // Keys we own while the palette is open. stopPropagation keeps Ionic from also acting on them
  // (notably Escape, which Ionic otherwise consumes for overlay/back handling on a lower listener —
  // the reason this handler runs in the capture phase).
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      e.stopPropagation();
      moveSelection(1);
      break;
    case "ArrowUp":
      e.preventDefault();
      e.stopPropagation();
      moveSelection(-1);
      break;
    case "Enter":
      e.preventDefault();
      e.stopPropagation();
      selectCurrent({ newTab: e.metaKey || e.ctrlKey });
      break;
    case "Escape":
      e.preventDefault();
      e.stopPropagation();
      close();
      break;
  }
}

function onRowClick(i: number) {
  state.selectedIndex = i;
  selectCurrent();
}

onMounted(() => {
  if (props.currentApp) setCurrentApp(props.currentApp);
  // Capture phase so the palette sees Cmd/Ctrl+K and Escape before Ionic's own handlers.
  window.addEventListener("keydown", onKeydown, true);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown, true);
});

// Focus the search box when the palette opens.
watch(
  () => state.isOpen,
  async (isOpen) => {
    if (isOpen) {
      await nextTick();
      inputEl.value?.focus();
    }
  }
);

// Keep the highlighted row in view as selection moves.
watch(
  () => state.selectedIndex,
  async () => {
    await nextTick();
    listEl.value?.querySelector(".ft-item.selected")?.scrollIntoView({ block: "nearest" });
  }
);

// Expose for parents that want to trigger the palette without the keyboard.
defineExpose({ open, close, toggle });
</script>

<style scoped>
.ft-overlay {
  position: fixed;
  inset: 0;
  z-index: 20001;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 12vh 16px 16px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}

.ft-panel {
  width: 100%;
  max-width: 560px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
  /* Elevated surface: a step above the page background so the palette clearly floats in both
     light and dark themes (where page + panel would otherwise share --ion-background-color). */
  background: var(--ion-color-step-100, #fff);
  color: var(--ion-text-color, #000);
  border: 1px solid var(--ion-color-step-250, #aeb0b5);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  animation: ft-pop 0.12s ease;
}

.ft-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ion-color-step-200, #c8c9cc);
}

.ft-search ion-icon {
  font-size: 20px;
  color: var(--ion-color-medium, #92949c);
  flex: 0 0 auto;
}

.ft-input {
  flex: 1 1 auto;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: 16px;
  min-width: 0;
}

.ft-kbd {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--ion-color-medium, #92949c);
  border: 1px solid var(--ion-color-step-200, #c8c9cc);
  border-radius: 4px;
  padding: 2px 6px;
}

.ft-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
}

.ft-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
}

.ft-item.selected {
  background: rgba(var(--ion-color-primary-rgb, 56, 128, 255), 0.16);
}

.ft-item.disabled {
  cursor: default;
  opacity: 0.5;
}

.ft-app-icon {
  font-size: 22px;
  flex: 0 0 auto;
}

.ft-app-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}

.ft-app-name {
  font-weight: 600;
  font-size: 15px;
}

.ft-app-desc {
  font-size: 12px;
  color: var(--ion-color-medium, #92949c);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ft-go {
  color: var(--ion-color-medium, #92949c);
  font-size: 16px;
  flex: 0 0 auto;
}

.ft-tag {
  flex: 0 0 auto;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ion-color-primary, #3880ff);
}

.ft-tag.muted {
  color: var(--ion-color-medium, #92949c);
}

.ft-empty {
  list-style: none;
  text-align: center;
  color: var(--ion-color-medium, #92949c);
  padding: 24px;
}

.ft-footer {
  display: flex;
  gap: 16px;
  padding: 10px 16px;
  border-top: 1px solid var(--ion-color-step-200, #c8c9cc);
  font-size: 12px;
  color: var(--ion-color-medium, #92949c);
}

.ft-footer kbd {
  display: inline-block;
  border: 1px solid var(--ion-color-step-200, #c8c9cc);
  border-radius: 4px;
  padding: 0 5px;
  margin-right: 2px;
  font-family: inherit;
}

/* CSS-only entry polish runs once on insert, so it never blocks v-if removal
   like the Vue transition leave lifecycle did when teleported. */
@keyframes ft-pop {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
