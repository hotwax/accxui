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

            <ion-list v-if="canDiscoverLocalApiServers() && (isDiscoveringLocalApiServers || devServers.length)">
              <ion-list-header>
                <ion-label>{{ translate("Dev servers") }}</ion-label>
                <ion-spinner v-if="isDiscoveringLocalApiServers" name="crescent" />
              </ion-list-header>
              <ion-item
                v-for="server in devServers"
                :key="server.oms"
                button
                :disabled="isCheckingOms"
                @click="selectDevServer(server)"
              >
                <ion-label>
                  {{ server.label }}
                  <p>{{ server.oms }}</p>
                </ion-label>
                <ion-badge v-if="server.hasAutoLogin" color="primary" slot="end">
                  {{ translate("Auto login") }}
                </ion-badge>
                <ion-note v-else-if="server.signal" slot="end">
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
  IonBadge,
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
import { computed, ref } from "vue";
import Logo from "./Logo.vue";
import { arrowBackOutline, arrowForwardOutline, warningOutline } from 'ionicons/icons'
import { cookieHelper } from "../helpers/cookieHelper";
import { translate } from "../core/i18n"
import { commonUtil } from "../utils/commonUtil";
import { useAuth } from "../composables/useAuth";
import { accxuiConfig } from "../core/configRegistry";
import { discoverLocalApiServers, type LocalApiServer, type LocalApiServerSignal } from "../core/localApiServerDiscovery";

let route = null as any;

// This is the best practice for defining composable instance, as this ensures in managing the reactive state properly
const { loginOption, fetchLoginOptions, fetchAppVersion, isAuthenticated, login: authLogin, updateOMS, clearAuth } = useAuth();

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
const hasAttemptedDevAutoLogin = ref(typeof window !== "undefined" && window.sessionStorage?.getItem("skipDevAutoLogin") === "true");
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

const getDevCredentials = () => {
  const devUsername = import.meta.env.VITE_DEV_USERNAME || import.meta.env.VITE_USERNAME;
  const devPassword = import.meta.env.VITE_DEV_PASSWORD || import.meta.env.VITE_PASSWORD;
  return { devUsername, devPassword };
};

const canDevAutoLogin = () => {
  const { devUsername, devPassword } = getDevCredentials();
  return Boolean(import.meta.env.DEV && devUsername && devPassword);
};

// A BASIC OMS is the only one we can sign into with a username and password. An empty
// loginOption means it has not been fetched for this OMS yet, and setOms fetches it before
// deciding, so treating that as BASIC here defers the decision rather than guessing.
const isBasicLoginOption = () => {
  return !Object.keys(loginOption.value).length || loginOption.value.loginAuthType === "BASIC";
};

// Dev-only convenience: sign in with the credentials the local env supplies instead of making
// a developer retype them on every reload. Automatic callers get one attempt per page load, so
// a rejected sign-in leaves the form usable instead of retrying on each re-entry of the view;
// an explicit server selection passes force since that is a deliberate retry.
const attemptDevAutoLogin = async (force = false) => {
  if(!canDevAutoLogin() || isLoggingIn.value) {
    return;
  }
  if(!force && hasAttemptedDevAutoLogin.value) {
    return;
  }

  const { devUsername, devPassword } = getDevCredentials();
  hasAttemptedDevAutoLogin.value = true;
  username.value = devUsername;
  password.value = devPassword;
  await login();
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
      const requestedPagePath = localStorage.getItem("requestedPagePath")
      localStorage.removeItem("requestedPagePath")
      router.value.replace(requestedPagePath)
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
  await fetchAppVersion();

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

export interface DevServer {
  label: string;
  oms: string;
  hasAutoLogin: boolean;
  signal?: LocalApiServerSignal;
  isEnv?: boolean;
}

const normalizeOmsUrl = (url: string) => url.trim().toLowerCase().replace(/\/+$/, "");

const devServers = computed<DevServer[]>(() => {
  if (!canDiscoverLocalApiServers()) return [];

  const servers: DevServer[] = [];
  const seenOms = new Set<string>();

  // 1. Dev server from env (VITE_DEFAULT_ALIAS)
  if (defaultAlias) {
    const rawEnvOms = defaultAlias.trim();
    const resolvedEnvOms = alias[rawEnvOms.toLowerCase()] ? alias[rawEnvOms.toLowerCase()] : rawEnvOms;
    const normalizedEnvOms = normalizeOmsUrl(resolvedEnvOms);

    let label = defaultAlias;
    if (defaultAlias === resolvedEnvOms) {
      const aliasKey = Object.keys(alias).find((key) => normalizeOmsUrl(alias[key]) === normalizedEnvOms);
      label = aliasKey || defaultAlias;
    }

    servers.push({
      label,
      oms: resolvedEnvOms,
      hasAutoLogin: canDevAutoLogin(),
      isEnv: true
    });
    seenOms.add(normalizedEnvOms);
  }

  // 2. Discovered local API servers
  for (const server of localApiServers.value) {
    const normalizedServerOms = normalizeOmsUrl(server.oms);
    if (seenOms.has(normalizedServerOms)) {
      const existing = servers.find((s) => normalizeOmsUrl(s.oms) === normalizedServerOms);
      if (existing) {
        existing.signal = server.signal;
        if (server.label && existing.label === defaultAlias) {
          existing.label = server.label;
        }
      }
    } else {
      servers.push({
        label: server.label,
        oms: server.oms,
        hasAutoLogin: canDevAutoLogin(),
        signal: server.signal,
        isEnv: false
      });
      seenOms.add(normalizedServerOms);
    }
  }

  return servers;
});

const selectDevServer = async (server: DevServer) => {
  if (isCheckingOms.value) return;

  instanceUrl.value = server.oms;
  await setOms();

  // Toggling the oms again so to login into the app instead of moving to the login view where users sees
  // login process in action
  // We can check if this behaviour needs to be improved, like let user move ahead to login screen or
  // add a loader and do not toggle the UI, so that in backgroun the UI changes, but due to the loader
  // user can't perform any operation there
  toggleOmsInput();

  if (server.hasAutoLogin) {
    await attemptDevAutoLogin(true);
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
      const maargApps = ["atp", "company", "order-routing", "inventorycount", "bopis", "transfers", "order-manager", "products"]
      const { host } = new URL(window.location.href)
      // Need to consider the info received in query as valid and thus need to clear the auth state
      clearAuth()
      const { oms, omsRedirectionUrl } = route.query as any
      const isMaarg = maargApps.some(app => host.includes(app));
      const target = commonUtil.isMoqui() !== isMaarg ? omsRedirectionUrl : oms;
      updateOMS(target);
      accxuiConfig.value.oms = target;

      await fetchLoginOptions()
      await fetchAppVersion();
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
      // pin the Login page to the app version configured for this deployment, if any
      await fetchAppVersion();
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

      // VITE_DEFAULT_ALIAS only prefills the OMS input, it never applies it, so dev auto-login
      // had no resolved instance to authenticate against and the developer was dropped on an
      // empty form. Apply the prefilled OMS the same way selecting a discovered server does.
      if(canDevAutoLogin() && instanceUrl.value && isBasicLoginOption()) {
        await setOms();
      }
    }

    // setOms clears showOmsInput for a BASIC OMS and redirects away for a SAML one, so reaching
    // here with the credentials form showing means signing in is both possible and safe. This
    // also covers a reload where the OMS is already set and only the credentials are missing.
    if(!showOmsInput.value) {
      await attemptDevAutoLogin();
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
