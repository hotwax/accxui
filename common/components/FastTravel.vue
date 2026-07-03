<template>
  <!--
    Fast Travel command palette using native Ionic components (<ion-searchbar>, <ion-list>, <ion-item>).
    Mounted once near the app root; opens on Cmd/Ctrl+K.
  -->
  <Teleport to="body">
    <div v-if="state.isOpen" class="ft-overlay" @click.self="close()">
      <div class="ft-panel" role="dialog" aria-modal="true" aria-label="Fast Travel">
        <!-- Native Ionic Searchbar -->
        <ion-searchbar
          ref="searchbarEl"
          :value="state.query"
          :placeholder="translate('Jump to app…')"
          autocomplete="off"
          spellcheck="false"
          @ionInput="setQuery($event.detail.value || '')"
          class="ion-no-padding"
        />

        <!-- Native Ionic List and Items -->
        <ion-list ref="listEl" class="ft-list">
          <ion-item
            v-for="(app, i) in filteredApps"
            :key="app.id"
            lines="none"
            :button="true"
            :detail="true"
            :disabled="!isNavigable(app)"
            :class="{ selected: i === state.selectedIndex }"
            @mousemove="onRowMousemove($event, i)"
            @click="onRowClick(i)"
          >
            <!-- Native Ionic Icon slot -->
            <ion-icon
              slot="start"
              :icon="app.icon"
              :color="app.color"
              aria-hidden="true"
            />
            
            <!-- Native Ionic Label/Text hierarchy -->
            <ion-label>
              {{ translate(app.name) }}
              <p>{{ translate(app.description) }}</p>
            </ion-label>

            <!-- Native Ionic Notes/Tags slot -->
            <ion-note slot="end" v-if="app.id === state.currentAppId">
              {{ translate("Current") }}
            </ion-note>
            <ion-note slot="end" v-else-if="!app.baseUrl" class="muted">
              {{ translate("Not configured") }}
            </ion-note>
          </ion-item>

          <ion-item v-if="!filteredApps.length" lines="none">
            <ion-label class="ion-text-center">
              <p>{{ translate("No apps found") }}</p>
            </ion-label>
          </ion-item>
        </ion-list>

        <!-- Keep custom keyboard layout helper info -->
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
import {
  IonIcon,
  IonSearchbar,
  IonList,
  IonItem,
  IonLabel,
  IonNote
} from "@ionic/vue";
import { translate } from "../core/i18n";
import { useFastTravel } from "../composables/useFastTravel";

const props = defineProps<{
  currentApp?: string;
}>();

const {
  state,
  filteredApps,
  setCurrentApp,
  isNavigable,
  open,
  close,
  toggle,
  setQuery,
  moveSelection,
  selectCurrent
} = useFastTravel();

const searchbarEl = ref<any>(null);
const listEl = ref<any>(null);

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    toggle();
    return;
  }
  if (!state.isOpen) return;

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

const lastMouseX = ref(-1);
const lastMouseY = ref(-1);

function onRowMousemove(e: MouseEvent, i: number) {
  if (e.clientX === lastMouseX.value && e.clientY === lastMouseY.value) return;
  lastMouseX.value = e.clientX;
  lastMouseY.value = e.clientY;
  state.selectedIndex = i;
}

function onRowClick(i: number) {
  state.selectedIndex = i;
  selectCurrent();
}

onMounted(() => {
  if (props.currentApp) setCurrentApp(props.currentApp);
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
      // For ion-searchbar, we must access the native input element inside its shadow DOM.
      const nativeInput = await (searchbarEl.value?.$el?.getInputElement?.() || searchbarEl.value?.getInputElement?.());
      nativeInput?.focus();
    }
  }
);

// Keep the highlighted row in view as selection moves.
watch(
  () => state.selectedIndex,
  async () => {
    await nextTick();
    // Locate the element with .selected class within the ion-list to scroll it into view.
    const container = listEl.value?.$el || listEl.value;
    container?.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }
);

defineExpose({ open, close, toggle });
</script>

<style scoped>
/*
  Only the overlay, panel container, and footer styles are retained to preserve the modal positioning.
  The internal item backgrounds, margins, dividers, and alignments are entirely handled by native Ionic styles.
*/
.ft-overlay {
  position: fixed;
  inset: 0;
  z-index: 20001;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 12vh var(--spacer-sm) var(--spacer-sm);
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
  background: var(--ion-background-color, #fff);
  box-shadow: 0 var(--spacer-sm) 48px rgba(0, 0, 0, 0.4);
  animation: ft-pop 0.12s ease;
}

.ft-list {
  overflow-y: auto;
  margin: 0;
  padding: 0;
}

ion-item.selected {
  --background: linear-gradient(rgba(var(--ion-color-primary-rgb, 56, 128, 255), 0.12), rgba(var(--ion-color-primary-rgb, 56, 128, 255), 0.12)), var(--ion-item-background, var(--ion-background-color, #fff));
}

.ft-footer {
  display: flex;
  gap: var(--spacer-sm);
  padding: var(--spacer-xs) var(--spacer-sm);
  border-top: 1px solid var(--ion-color-step-150, #d7d8da);
  font-size: 12px;
  color: var(--ion-color-medium, #92949c);
  background: var(--ion-background-color, #fff);
}

.ft-footer kbd {
  display: inline-block;
  border: 1px solid var(--ion-color-step-200, #c8c9cc);
  border-radius: 4px;
  padding: 0 var(--spacer-2xs);
  margin-right: var(--spacer-2xs);
  font-family: inherit;
}

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
