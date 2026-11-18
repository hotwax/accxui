import { register } from "register-service-worker";
import { ref, watch } from "vue";
import { translate } from "../core/i18n";
import logger from "../core/logger";
import { commonUtil } from "../utils/commonUtil";

/*
 * Tells the user when a new build of the app is deployed, through the service worker lifecycle,
 * without caching anything.
 *
 * The detect-only worker (common/pwa/sw.ts, built with appUpdatePwaOptions from
 * common/vite/appUpdatePwa.ts) changes with every build. The browser checks sw.js on every page
 * load (and hourly here for tabs left open), installs a new one, and that one waits until the user
 * picks Update. register-service-worker reports it as `updated`, also when it is already waiting at
 * registration, so every tab of the app offers the update until it is applied.
 */

const CHECK_INTERVAL = 60 * 60 * 1000;

export interface AppUpdateOptions {
  /** Show the framework's "New version available" toast with an Update button. Default true. */
  showToast?: boolean;
}

// Not user data: it describes the deployed build, so it survives logout.
const updateAvailable = ref(false);
let waitingRegistration: ServiceWorkerRegistration | undefined;
let started = false;

const onUpdated = (registration: ServiceWorkerRegistration) => {
  waitingRegistration = registration;
  updateAvailable.value = true;
};

// Activates the waiting worker, then reloads once it is active. The worker caches nothing, so the
// reload revalidates index.html and loads the new build whatever its max-age. Other tabs are not
// reloaded: they keep their own toast, and their Update just reloads.
const applyUpdate = () => {
  const waiting = waitingRegistration?.waiting;

  if(!waiting) {
    window.location.reload();

    return;
  }
  // The worker's own state, not controllerchange: a tab no worker controls (the first visit, or a
  // hard refresh) never gets controllerchange, because the worker does not claim clients.
  waiting.addEventListener("statechange", () => {
    if(waiting.state === "activated") {
      window.location.reload();
    }
  });
  waiting.postMessage({ type: "SKIP_WAITING" });
};

// Never reloads on its own: the user may have unsaved work open, so they pick the moment.
// manualDismiss keeps it on screen until the user acts, and hands the toast back unpresented.
const presentUpdateToast = async () => {
  const toast = await commonUtil.showToast(translate("New version available, click update to get latest version"), {
    manualDismiss: true,
    canDismiss: true,
    buttons: [{ text: translate("Update"), handler: () => applyUpdate() }]
  }) as { present: () => Promise<void> };

  await toast.present();
};

const startAppUpdateWatch = (options: AppUpdateOptions = {}) => {
  if(started || !import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return;
  }
  started = true;
  if(options.showToast !== false) {
    watch(updateAvailable, (available) => {
      if(available) {
        void presentUpdateToast();
      }
    });
  }
  register(`${import.meta.env.BASE_URL}sw.js`, {
    registrationOptions: { scope: import.meta.env.BASE_URL, updateViaCache: "none" },
    registered(registration: ServiceWorkerRegistration) {
      setInterval(() => registration.update().catch(() => { /* offline: try again later */ }), CHECK_INTERVAL);
      // A worker found by the page load's own check but still installing when we register: its
      // updatefound has already fired, so the library would miss it.
      const installing = registration.installing;

      if(installing && registration.active) {
        installing.addEventListener("statechange", () => {
          if(installing.state === "installed") {
            onUpdated(registration);
          }
        });
      }
    },
    updated: onUpdated,
    // A tab from the very first visit has no controller, so the library reports a later update as
    // "cached". On a real first install no worker is active yet; an active one means an update.
    cached(registration: ServiceWorkerRegistration) {
      if(registration.active) {
        onUpdated(registration);
      }
    },
    error(error: unknown) {
      logger.error("Failed to register the app update worker", error);
    }
  });
};

/**
 * startAppUpdateWatch() once from App.vue's onMounted; updateAvailable / applyUpdate for an Update
 * button elsewhere (Settings). Needs the app built with appUpdatePwaOptions.
 */
export function useAppUpdate() {
  return { updateAvailable, startAppUpdateWatch, applyUpdate };
}
