<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ translate("Settings") }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-list>
        <ion-item lines="none">
          <ion-label>
            <p>{{ translate("Instance") }}</p>
            <h2>{{ userStore.getOms || "—" }}</h2>
          </ion-label>
        </ion-item>
        <ion-item lines="none">
          <ion-label>
            <p>{{ translate("User") }}</p>
            <h2>{{ userStore.getUserProfile?.userId || "—" }}</h2>
          </ion-label>
        </ion-item>
      </ion-list>
      <ion-button expand="block" fill="outline" class="ion-margin" @click="logout">
        {{ translate("Logout") }}
      </ion-button>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { translate, useAuth } from "@common";
import { IonButton, IonContent, IonHeader, IonItem, IonLabel, IonList, IonPage, IonTitle, IonToolbar } from "@ionic/vue";
import { useUserStore } from "@/store/userStore";

const userStore = useUserStore();
function logout() { useAuth().logout(); }
</script>
