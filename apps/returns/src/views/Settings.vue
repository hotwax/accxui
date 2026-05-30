<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>{{ translate("Settings") }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="user-profile">
        <ion-card>
          <ion-card-header class="ion-no-padding ion-padding-vertical ion-padding-start">
            <ion-card-subtitle>{{ userProfile?.userId }}</ion-card-subtitle>
            <ion-card-title>{{ userProfile?.userFullName || userProfile?.userId }}</ion-card-title>
          </ion-card-header>
          <ion-button data-testid="settings-logout-btn" color="danger" @click="logout()">
            {{ translate("Logout") }}
          </ion-button>
          <ion-button data-testid="settings-go-launchpad-btn" fill="outline" @click="goToLaunchpad()">
            {{ translate("Go to Launchpad") }}
            <ion-icon slot="end" :icon="openOutline" />
          </ion-button>
        </ion-card>
      </div>

      <div class="section-header">
        <h1>{{ translate("OMS") }}</h1>
      </div>
      <section>
        <!-- DXP: OMS instance navigator — added in a later task -->
        <ion-item lines="none">
          <ion-label>
            <p>{{ translate("Instance") }}</p>
            <h2>{{ userStore.getOms || "—" }}</h2>
          </ion-label>
        </ion-item>
      </section>

      <hr />

      <!-- DXP: app version info — added in a later task -->

      <section>
        <!-- DXP: product identifier + timezone switcher — added in a later task -->
      </section>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton, IonCard, IonCardHeader, IonCardSubtitle, IonCardTitle, IonContent,
  IonHeader, IonIcon, IonItem, IonLabel, IonPage, IonTitle, IonToolbar,
} from "@ionic/vue";
import { computed } from "vue";
import { openOutline } from "ionicons/icons";
import router from "@/router";
import { translate, useAuth } from "@common";
import { useUserStore } from "@/store/userStore";

const userStore = useUserStore();
const userProfile = computed(() => userStore.getUserProfile);

async function logout() {
  const redirectionUrl: any = await useAuth().logout({ isUserUnauthorised: false });
  if (!redirectionUrl) router.replace("/login");
  else window.location.href = redirectionUrl;
}

function goToLaunchpad() {
  window.location.href = `${import.meta.env.VITE_LOGIN_URL}`;
}
</script>

<style scoped>
:is(ion-card) > ion-button {
  margin: var(--spacer-xs);
}
section {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  align-items: start;
}
.user-profile {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
}
hr {
  border-top: 1px solid var(--border-medium);
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-xs) 10px 0px;
}
ion-content {
  --padding-bottom: 80px;
}
</style>
