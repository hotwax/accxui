import { ref } from 'vue';

export interface Config {
  // State
  current: any;
  permissions?: any[];
  oms: string;
  // The app version this deployment is pinned to (mirrors the app's useUserStore().appVersion via a
  // getter/setter). undefined = not resolved yet, "" = no version configured, "vX.Y.Z" = pinned.
  appVersion?: string;

  // Actions
  $reset?: () => void;
  postLogout: () => Promise<void>;
  preLogout: () => Promise<void>; // runs only in case when its manual logout and not unauth or invalid app context
  postLogin: () => Promise<void>;
  router: any;
}

export const accxuiConfig = ref<Config>({
  postLogin: () => Promise.resolve(),
  postLogout: () => Promise.resolve(),
  preLogout: () => Promise.resolve(),
  oms: "",
  current: {},
  router: ref(null)
});

export function unregisterLegacyServiceWorkers(appScope?: string) {
  if (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof navigator.serviceWorker?.getRegistrations === 'function'
  ) {
    return navigator.serviceWorker.getRegistrations().then((registrations) => {
      const currentOrigin = window.location.origin;
      const targetScope = appScope ? new URL(appScope, window.location.href).href : undefined;

      for (const registration of registrations) {
        const scriptURL =
          registration.active?.scriptURL ||
          registration.installing?.scriptURL ||
          registration.waiting?.scriptURL ||
          '';

        // Never unregister Firebase Cloud Messaging workers (push notifications)
        if (
          scriptURL.includes('firebase-messaging') ||
          registration.scope?.includes('firebase-cloud-messaging')
        ) {
          continue;
        }

        // Only target known legacy PWA service worker scripts (e.g. sw.js, service-worker.js, workbox)
        const isLegacyPwaScript =
          !scriptURL ||
          /(?:^|\/)(sw|service-worker|workbox-[a-f0-9]+)\.js(?:\?.*)?$/i.test(scriptURL);

        // Ensure registration is within the current origin/app scope and not an unrelated path
        const matchesScope = targetScope
          ? registration.scope === targetScope || registration.scope?.startsWith(targetScope)
          : registration.scope?.startsWith(currentOrigin) &&
            (window.location.href.startsWith(registration.scope) ||
             registration.scope.startsWith(window.location.href.split('?')[0].split('#')[0]));

        if (isLegacyPwaScript && matchesScope) {
          registration.unregister();
        }
      }
    }).catch(() => {
      // Ignore background unregistration failures
    });
  }
}

export const initialiseConfig = (params: any) => {
  accxuiConfig.value = params
  unregisterLegacyServiceWorkers()
}
