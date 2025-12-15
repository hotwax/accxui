<template>
  <ion-card>
    <ion-card-header>
      <ion-card-subtitle>
        {{ translate('OMS instance') }}
      </ion-card-subtitle>
      <ion-card-title>
        {{ authStore.getOms }}
      </ion-card-title>
    </ion-card-header>
    <ion-card-content>
      {{ translate('This is the name of the OMS you are connected to right now. Make sure that you are connected to the right instance before proceeding.') }}
    </ion-card-content>
    <ion-button v-if="!authStore.isEmbedded" :standalone-hidden="!hasPermission('COMMON_ADMIN')" @click="goToOms(token.value, oms)" fill="clear" :disabled="!hasPermission('COMMERCEUSER_VIEW')">
      {{ translate('Go to OMS') }}
      <ion-icon slot="end" :icon="openOutline" />
    </ion-button>
  </ion-card>
</template>

<script setup lang="ts">
import { 
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonIcon
} from '@ionic/vue';
import { goToOms } from '../utils/commonUtil';
import { openOutline } from 'ionicons/icons'
import { computed } from 'vue';
import { hasPermission, translate, useAuthStore } from "../index";

const authStore = useAuthStore();

const token = computed(() => authStore.getToken)
const oms = computed(() => authStore.getOms)
</script>

<style scoped>
/* Added conditional hiding in standalone mode that respects user permissions */
@media (display-mode: standalone) {
  [standalone-hidden] {
    display: none;
  }
}
</style>