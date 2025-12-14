<template>
  <ion-content>
    <div class="center-div">
      <ion-item lines="none" v-if='error.message.length'>
        <ion-icon slot="start" color="warning" :icon="warningOutline" />
        <h4>{{ translate('Login failed') }}</h4>
      </ion-item>
      <p v-if='error.responseMessage.length'>
        {{ translate('Reason:') }} {{ translate(error.responseMessage) }}
      </p>
      <p v-if='error.message.length'>
        {{ translate(error.message) }}
      </p>
      <ion-button v-if='error.message.length' class="ion-margin-top" @click="goToLaunchpad()">
        <ion-icon slot="start" :icon="arrowBackOutline" />
        {{ translate("Back to Launchpad") }}
      </ion-button>
    </div>
  </ion-content>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  IonButton,
  IonContent,
  IonIcon,
  IonItem
} from "@ionic/vue";
import { arrowBackOutline, warningOutline } from 'ionicons/icons'
import { addNotification, initialiseFirebaseApp, storeClientRegistrationToken } from "../utils/firebase"
import emitter from '../../event-bus'
import {
  useAuthStore,
  useUserStore,
  useFirebaseNotificationStore
} from "../index"
import { DateTime } from "luxon"
import { getAppLoginUrl } from "../utils";
import { useRouter } from 'vue-router';
import { useRoute } from 'vue-router'
import { getConfig, initialise } from "../../oms-api"
import { translate } from "../index"

declare var process: any;
const props = defineProps({
  appLogin: {
    type: Function,
    required: true
  },
  appLogout: {
    type: Function,
    required: true
  }
})

const firebaseNotificationStore = useFirebaseNotificationStore()
const authStore = useAuthStore()
const router = useRouter();
const route = useRoute()
const appLoginUrl = import.meta.env.VITE_VUE_APP_LOGIN_URL as string
const appFirebaseConfig = JSON.parse(import.meta.env.VITE_VUE_APP_FIREBASE_CONFIG as any)
const appFirebaseVapidKey = import.meta.env.VITE_VUE_APP_FIREBASE_VAPID_KEY

const error = ref({
  message: '',
  responseMessage: ''
})

onMounted(async () => {
  if (!Object.keys(route.query).length) {
    window.location.replace(appLoginUrl)
    return
  }

  //const { token, oms, expirationTime, omsRedirectionUrl, isEmbedded, shop, host} = route.query

  const { token, oms, expirationTime, omsRedirectionUrl, isEmbedded, shop, host } = route.query as {
    token: string
    oms: string
    expirationTime: string
    omsRedirectionUrl: string
    isEmbedded: string,
    shop: string,
    host: string
  }

  // Update the flag in auth, since the store is updated app login url will be embedded luanchpad's url.
  const isEmbeddedFlag = isEmbedded === 'true'
  await handleUserFlow(token, oms, expirationTime, omsRedirectionUrl, isEmbeddedFlag, shop, host)
});

async function handleUserFlow(token: string, oms: string, expirationTime: string, omsRedirectionUrl = "", isEmbedded: boolean, shop: string, host: string) {
  // fetch the current config for the user
  const appConfig = getConfig()

  // logout to clear current user state, don't mark the user as logout as we just want to clear the user data
  await props.appLogout({ isUserUnauthorised: true })

  // reset the config that we got from the oms-api, as on logout we clear the config of oms-api
  await initialise(appConfig)

  // checking if token from launchpad has expired and redirecting there only
  if (+expirationTime < DateTime.now().toMillis()) {
    console.error('User token has expired, redirecting to launchpad.')
    error.value.message = 'User token has expired, redirecting to launchpad.'

    // This will be the url of referer launchpad, we maintain two launchpads.
    // The launchpad urls are defined the env file in each PW App. 
    // Setting this flag here because it is needed to identify the launchpad's URL, this will updated in this function later.
    authStore.isEmbedded = isEmbedded
    authStore.shop = shop as any
    authStore.host = host as any
    const appLoginUrl = getAppLoginUrl()
    if (isEmbedded) {
      window.location.replace(appLoginUrl)
    } else {
      const redirectUrl = window.location.origin + '/login' // current app URL
      window.location.replace(`${appLoginUrl}?isLoggedOut=true&redirectUrl=${redirectUrl}`)
    }
    return
  }

  // update the previously set values if the user opts ending the previous session
  authStore.$patch({
    token: { value: token, expiration: expirationTime as any },
    oms,
    isEmbedded,
    shop: shop as any,
    host: host as any
  })

  //context.loader.present('Logging in')
  emitter.emit('presentLoader', { message: 'Logging in' })
  try {
    // redirect route will be returned for certain cases
    const redirectRoute = await props.appLogin({ token, oms, omsRedirectionUrl})

    const userStore = useUserStore()
    // to access baseUrl as we store only OMS in DXP
    await userStore.setLocale(userStore.getUserProfile.userLocale)

    const allNotificationPrefs = firebaseNotificationStore.getAllNotificationPrefs

    // check if firebase configurations are there
    if (appFirebaseConfig && appFirebaseConfig.apiKey && allNotificationPrefs?.length) {
      // initialising and connecting firebase app for notification support
      await initialiseFirebaseApp(
        appFirebaseConfig,
        appFirebaseVapidKey,
        storeClientRegistrationToken,
        addNotification,
      )
    }
    emitter.emit('dismissLoader')
    router.replace(redirectRoute ? redirectRoute : '/')
  } catch (err: any) {
    console.error(err)
    error.value.message = 'Please contact the administrator.'
    error.value.responseMessage = err.message || ''
  } finally {
    emitter.emit('dismissLoader')
  }
}

function goToLaunchpad() {
  window.location.replace(getAppLoginUrl())
}
</script>

<style>
.center-div {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
</style>