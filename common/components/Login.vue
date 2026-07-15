<template>
  <ion-page>
    <ion-content>
      <div class="flex" v-if="!isInitializing && !isConfirmingForActiveSession">
        <form class="login-container" @keyup.enter="handleSubmit()" @submit.prevent>
          <Logo />

          <section v-if="errorMessage">
            <div>
              <ion-item lines="none">
                <ion-icon slot="start" color="warning" :icon="warningOutline" />
                <h4>{{ translate('Login failed') }}</h4>
              </ion-item>
              <p>
                {{ errorMessage }}
              </p>
              <p>{{ translate("Please contact the administrator.") }}</p>
              <ion-button class="ion-margin-top" @click="goToLogin()">
                <ion-icon slot="start" :icon="arrowBackOutline" />
                {{ translate("Back to Login") }}
              </ion-button>
            </div>
          </section>

          <section v-else-if="showOmsInput">
            <ion-item lines="full">
              <ion-input :label="translate('OMS')" label-placement="fixed" name="instanceUrl" v-model="instanceUrl" id="instanceUrl" type="text" required />
            </ion-item>

            <ion-list v-if="isDiscoveringLocalApiServers || localApiServers.length">
              <ion-list-header>
                <ion-label>{{ translate("Local OMS") }}</ion-label>
                <ion-spinner v-if="isDiscoveringLocalApiServers" name="crescent" />
              </ion-list-header>
              <ion-item
                v-for="server in localApiServers"
                :key="server.oms"
                button
                :disabled="isCheckingOms"
                @click="selectLocalApiServer(server)"
              >
                <ion-label>
                  {{ server.label }}
                  <p>{{ server.oms }}</p>
                </ion-label>
                <ion-note slot="end">
                  {{ server.signal === "loginOptions" ? translate("Ready") : translate("Detected") }}
                </ion-note>
              </ion-item>
            </ion-list>

            <div class="ion-padding">
              <!-- @keyup.enter.stop to stop the form from submitting on enter press as keyup.enter is already bound
              through the form above, causing both the form and the button to submit. -->
              <ion-button color="primary" expand="block" @click.prevent="isCheckingOms ? '' : setOms()" @keyup.enter.stop>
                {{ translate("Next") }}
                <ion-spinner v-if="isCheckingOms" name="crescent" slot="end" />
                <ion-icon v-else slot="end" :icon="arrowForwardOutline" />
              </ion-button>
            </div>
          </section>

          <section v-else>
            <div class="ion-text-center ion-margin-bottom">
              <ion-chip :outline="true" @click="toggleOmsInput()">
                {{ cookieHelper().get("oms") }}
              </ion-chip>
            </div>

            <ion-item lines="full">
              <ion-input :label="translate('Username')" label-placement="fixed" name="username" v-model="username" id="username"  type="text" required />
            </ion-item>
            <ion-item lines="none">
              <ion-input :label="translate('Password')" label-placement="fixed" name="password" v-model="password" id="password" type="password" required />
            </ion-item>

            <div class="ion-padding">
              <ion-button color="primary" expand="block" @click="isLoggingIn ? '' : login()">
                {{ translate("Login") }}
                <ion-spinner v-if="isLoggingIn" slot="end" name="crescent" />
                <ion-icon v-else slot="end" :icon="arrowForwardOutline" />
              </ion-button>
            </div>
          </section>
        </form>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonChip,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonSpinner,
  loadingController,
  onIonViewWillEnter
} from "@ionic/vue";
import { ref } from "vue";
import Logo from "./Logo.vue";
import { arrowBackOutline, arrowForwardOutline, warningOutline } from 'ionicons/icons'
import { cookieHelper } from "../helpers/cookieHelper";
import { translate } from "../core/i18n"
import { commonUtil } from "../utils/commonUtil";
import { useAuth } from "../composables/useAuth";
import { accxuiConfig } from "../core/configRegistry";
import { discoverLocalApiServers, type LocalApiServer } from "../core/localApiServerDiscovery";

let route = null as any;

// This is the best practice for defining composable instance, as this ensures in managing the reactive state properly
const { loginOption, fetchLoginOptions, isAuthenticated, login: authLogin, updateOMS, clearAuth } = useAuth();

const username = ref("");
const password = ref("");
const instanceUrl = ref("");
const errorMessage = ref("");
const alias = import.meta.env.VITE_ALIAS ? JSON.parse(import.meta.env.VITE_ALIAS) : {};
const defaultAlias = import.meta.env.VITE_DEFAULT_ALIAS;
const showOmsInput = ref(false);
const isInitializing = ref(true);
const isConfirmingForActiveSession = ref(false);
const loader = ref<any>(null);
const isCheckingOms = ref(false);
// Separate flag to prevent concurrent initialise() calls.
// isInitializing starts true (to hide form), so we can't use it as the guard.
let initInProgress = false;
const isLoggingIn = ref(false);
const isDiscoveringLocalApiServers = ref(false);
const localApiServers = ref<LocalApiServer[]>([]);
const hasDiscoveredLocalApiServers = ref(false);
let router: any = ref();

const goToLogin = () => {
  router.value.go(0);
}

const presentLoader = async (message: string) => {
  if (!loader.value) {
    loader.value = await loadingController
      .create({
        message: translate(message),
        translucent: true,
        backdropDismiss: false
      });
  }
  loader.value.present();
};

const dismissLoader = () => {
  if (loader.value) {
    loader.value.dismiss();
    loader.value = null;
  }
};

const toggleOmsInput = () => {
  showOmsInput.value = !showOmsInput.value;
  // clearing username and password if moved to OMS input
  if (showOmsInput.value) {
    username.value = "";
    password.value = "";
    discoverLocalApiServerOptions();
  }
};

const canDiscoverLocalApiServers = () => {
  return import.meta.env.DEV && typeof window !== "undefined";
};

const discoverLocalApiServerOptions = async () => {
  if (!canDiscoverLocalApiServers() || hasDiscoveredLocalApiServers.value) return;

  hasDiscoveredLocalApiServers.value = true;
  isDiscoveringLocalApiServers.value = true;
  try {
    localApiServers.value = await discoverLocalApiServers();
  } catch (error) {
    console.error("Failed to discover local API servers:", error);
  } finally {
    isDiscoveringLocalApiServers.value = false;
  }
};

const login = async (params?: any) => {
  if((!username.value || !password.value) && !params?.token) {
    commonUtil.showToast(translate("Please fill in the user details"));
    return;
  }

  isLoggingIn.value = true;
  try {
    await authLogin(username.value?.trim(), password.value, params?.token, params?.expirationTime)
    // All the failure cases are handled in action, if then block is executing, login is successful
    username.value = "";
    password.value = "";
    if(localStorage.getItem("requestedPagePath")) {
      router.value.replace(localStorage.getItem("requestedPagePath"))
    } else {
      router.value.replace("/")
    }
  } catch (error: any) {
    errorMessage.value = error
    console.error(error);
  }
  isLoggingIn.value = false;
};

const setOms = async () => {
  if (!instanceUrl.value) {
    commonUtil.showToast(translate("Please fill in the OMS"));
    return;
  }

  isCheckingOms.value = true;

  const instanceURL = instanceUrl.value.trim().toLowerCase();
  updateOMS(alias[instanceURL] ? alias[instanceURL] : instanceURL)
  accxuiConfig.value.oms = alias[instanceURL] ? alias[instanceURL] : instanceURL

  // run SAML login flow if login options are configured for the OMS
  await fetchLoginOptions();

  // checking loginOption.length to know if fetchLoginOptions API returned data
  // as toggleOmsInput is called twice without this check, from fetchLoginOptions and
  // through setOms (here) again
  if (Object.keys(loginOption.value).length && loginOption.value.loginAuthType !== "BASIC") {
    window.location.href = `${loginOption.value.loginAuthUrl}?relaystate=${window.location.origin}/login`;
  } else {
    toggleOmsInput();
  }
  isCheckingOms.value = false;
};

const selectLocalApiServer = async (server: LocalApiServer) => {
  if (isCheckingOms.value) return;

  instanceUrl.value = server.oms;
  await setOms();

  // Toggling the oms again so to login into the app instead of moving to the login view where users sees
  // login process in action
  // We can check if this behaviour needs to be improved, like let user move ahead to login screen or
  // add a loader and do not toggle the UI, so that in backgroun the UI changes, but due to the loader
  // user can't perform any operation there
  toggleOmsInput();

  const devUsername = import.meta.env.VITE_USERNAME;
  const devPassword = import.meta.env.VITE_PASSWORD;
  if (import.meta.env.DEV && devUsername && devPassword) {
    username.value = devUsername;
    password.value = devPassword;
    await login();
  }
};

const initialise = async () => {
  // Guard against concurrent calls — onIonViewWillEnter fires on each navigation
  if (initInProgress) return;
  initInProgress = true;
  isInitializing.value = true;
  await presentLoader("Processing");

  try {
    // When having token and oms in login, it means that we are coming from legacy launchpad login flow
    if(route.query?.token && route.query?.oms) {
      // This array is maintaining list of apps those are moqui first, we are maintaining this to have support
      // to run the accxui apps with old login launchpad redirect flow
      const maargApps = ["atp", "company", "order-routing", "inventorycount", "bopis", "transfers", "localhost", "products"]
      const { host } = new URL(window.location.href)
      // Need to consider the info received in query as valid and thus need to clear the auth state
      clearAuth()
      const { oms, omsRedirectionUrl } = route.query as any
      // TODO: Previous condition was maargApps.some(app => host.includes(app)), need to identify to make this work with old launchpad redirection flow
      if(commonUtil.isMoqui()) {
        updateOMS(omsRedirectionUrl)
        accxuiConfig.value.oms = omsRedirectionUrl
      } else {
        updateOMS(oms)
        accxuiConfig.value.oms = oms
      }
      await fetchLoginOptions()
      await login(route.query)
      return;
    }

    if (route.query?.token) {
      // SAML login handling as only token will be returned in the query when login through SAML
      await login(route.query)
      return;
    }

    // fetch login options only if OMS is there as API calls require OMS
    if (cookieHelper().get("oms")) {
      await fetchLoginOptions();
    }

    // show OMS input if SAML is configured or if OMS cookie is not set
    if (loginOption.value.loginAuthType !== 'BASIC' || !cookieHelper().get("oms")) {
      showOmsInput.value = true;
    }

    // if a session is already active, login directly in the app
    if (isAuthenticated.value) {
      router.value.push("/");
      return;
    }

    if(cookieHelper().get("oms") && cookieHelper().get("token") && cookieHelper().get("userId") && cookieHelper().get("expirationTime")) {
      accxuiConfig.value.oms = cookieHelper().get("oms") as string
      await login({ token: cookieHelper().get("token"), expirationTime: cookieHelper().get("expirationTime") })
      return;
    }

    instanceUrl.value = commonUtil.getOMSInstanceName();
    if (instanceUrl.value) {
      // If the current URL is available in alias show it for consistency
      const currentInstanceUrlAlias = Object.keys(alias).find((key) => alias[key] === instanceUrl.value);
      currentInstanceUrlAlias && (instanceUrl.value = currentInstanceUrlAlias);
    }
    // If there is no current preference set the default one
    if (!instanceUrl.value && defaultAlias) {
      instanceUrl.value = defaultAlias;
    }

    if (showOmsInput.value) {
      discoverLocalApiServerOptions();
    }
  } catch (error) {
    console.error(error);
  } finally {
    dismissLoader();
    isInitializing.value = false;
    initInProgress = false;
  }
};

const handleSubmit = () => {
  if (instanceUrl.value.trim() && showOmsInput.value && (!username.value && !password.value)) setOms();
  else if (instanceUrl.value) login();
};

onIonViewWillEnter(() => {
  router.value = accxuiConfig.value.router
  route = router.value.currentRoute;
  initialise();
});
</script>

<style scoped>
.login-container {
  width: 375px;
}

.flex {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
}
</style>
