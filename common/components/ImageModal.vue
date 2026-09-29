<template>
  <ion-modal :is-open="true" @didDismiss="closeModal">
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button @click="closeModal" :aria-label="translate('Close')" :title="translate('Close')">
            <ion-icon :icon="closeOutline" slot="icon-only" />
          </ion-button>
        </ion-buttons>
        <ion-title>{{ productName }}</ion-title>
      </ion-toolbar>
      <!-- The thumbnail's image shows at once; the bar runs while the full size one loads. -->
      <ion-progress-bar v-if="loading" type="indeterminate" />
    </ion-header>

    <ion-content class="ion-text-center">
      <img :src="displayedUrl" :alt="productName || ''" />
    </ion-content>
  </ion-modal>
</template>

<script lang="ts" setup>
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonProgressBar, IonTitle, IonToolbar } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import { computed, ref } from 'vue';
import defaultImgUrl from '../assets/images/defaultImage.png';
import { translate } from '../core/i18n';
import logger from '../core/logger';

/**
 * imageUrl is the full size image; previewUrl is what the thumbnail already shows, which the
 * browser has cached, so the modal opens on it instead of on the placeholder.
 */
const props = defineProps(["imageUrl", "previewUrl", "onClose", "productName"])

const fullImageUrl = ref('')
const loading = ref(!!props.imageUrl)
const displayedUrl = computed(() => fullImageUrl.value || props.previewUrl || defaultImgUrl)

if (props.imageUrl) {
  const image = new Image()
  image.onload = () => {
    fullImageUrl.value = props.imageUrl
    loading.value = false
  }
  // Keep the preview: a failed full size image is no reason to show the placeholder instead.
  image.onerror = (error) => {
    logger.error("Image - Failed to load the full size image", error)
    loading.value = false
  }
  image.src = props.imageUrl
}

const closeModal = () => {
  props.onClose()
}
</script>

<style scoped>
/* The preview and the full image fill the same box, so the sharper one replaces it in place. */
img {
  width: 100%;
  max-height: 530px;
  object-fit: contain;
}
</style>
