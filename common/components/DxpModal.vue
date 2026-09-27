<template>
  <ion-header ref="header">
    <ion-toolbar>
      <ion-buttons slot="start">
        <ion-button :disabled="flow.saving" :aria-label="translate('Close')" :title="translate('Close')" @click="flow.exit()">
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </ion-buttons>
      <ion-title>{{ title }}</ion-title>
    </ion-toolbar>
    <!-- More toolbars, such as a searchbar or segments, go under the title. -->
    <slot name="toolbar" />
  </ion-header>

  <ion-content>
    <slot />

    <ion-fab v-if="flow.hasConfirm" slot="fixed" vertical="bottom" horizontal="end">
      <ion-fab-button :disabled="!flow.canConfirm || flow.busy" :aria-label="confirmLabel ?? translate('Save')" @click="flow.confirm()">
        <ion-spinner v-if="flow.saving" name="crescent" />
        <ion-icon v-else :icon="confirmIcon ?? saveOutline" />
      </ion-fab-button>
    </ion-fab>
  </ion-content>
</template>

<script setup lang="ts">
/**
 * The frame of every modal: the title, the exit path and the confirm path. The modal puts its
 * content in the default slot and its logic in useModalFlow; how the frame is drawn stays here.
 */
import {
  IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar
} from "@ionic/vue";
import { closeOutline, saveOutline } from "ionicons/icons";
import { onMounted, ref } from "vue";
import { useModalFlowOrDefault } from "../composables/useModalFlow";
import { translate } from "../core/i18n";

defineProps<{
  title: string;
  /** What the confirm button does, for its label. Defaults to Save. */
  confirmLabel?: string;
  /** Defaults to the save icon. */
  confirmIcon?: string;
}>();

const flow = useModalFlowOrDefault();
const header = ref();
onMounted(() => flow.attach(header.value?.$el));
</script>
