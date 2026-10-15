---
name: accxui-push-notifications
description: Use when an AccxUI app (apps/bopis or a new one) sends or receives Firebase Cloud Messaging push notifications, or works on notification preferences / topics. Triggers include firebaseMessaging, initialiseFirebaseApp, generateTopicName, generateDeviceId, isFcmConfigured, useNotificationStore, subscribeTopic / unsubscribeTopic, storeClientRegistrationToken / removeClientRegistrationToken, fetchNotificationPreferences / fetchAllNotificationPrefs, firebase-messaging-sw.js, FB_BG_MESSAGES, VITE_FIREBASE_CONFIG, VITE_FIREBASE_VAPID_KEY, VITE_NOTIF_APP_ID, VITE_NOTIF_ENUM_TYPE_ID, a device that stops receiving pushes (iOS / Safari), a duplicate banner, or a notification preferences screen.
---

# Firebase push notifications

The framework (`@common`) gives two pieces: `firebaseMessaging` (Firebase setup and naming helpers)
and `useNotificationStore` (device token, topic subscriptions, received notifications; persisted).
The app supplies the env config, the service worker, and the wiring into login, logout and its
preference screen. BOPIS is the working reference (`apps/bopis`). Push needs no app database.

## How it fits together

- A **topic** is one kind of notification for one facility on one OMS:
  `generateTopicName(oms, facilityId, enumId)` → `"<oms>-<facilityId>-<enumId>"`. The kinds are the
  enums of type `VITE_NOTIF_ENUM_TYPE_ID`.
- The backend sends to topics. A **device** receives a topic once it has registered its FCM token
  (`POST firebase/token`) and the user has subscribed the topic for that device (`POST firebase/topic`).
- The app registers the device **only when the user has at least one subscription**, and removes the
  token on logout and when the last subscription is turned off.

## Config

| Item | What |
|---|---|
| `VITE_FIREBASE_CONFIG` | the Firebase web config as a JSON string (`{"apiKey":…,"projectId":…}`) |
| `VITE_FIREBASE_VAPID_KEY` | the web push certificate key |
| `VITE_NOTIF_APP_ID` | the app's id on the backend: `applicationId` for tokens and topics, `topicTypeId` when listing subscriptions |
| `VITE_NOTIF_ENUM_TYPE_ID` | the enum type whose enums are the notification kinds shown as toggles |
| `public/firebase-messaging-sw.js` | the service worker (copy BOPIS's). Its `const firebaseConfig = {…}` line is a placeholder: the shared hosting workflows (`.github/workflows/common-firebase-hosting-*.yml`) `sed` it from the `VITE_FIREBASE_CONFIG` secret at deploy. Locally it stays empty and the background handler is skipped |

BOPIS's `.env.example`, to copy and rename for a new app:

```
VITE_NOTIF_APP_ID=BOPIS
VITE_NOTIF_ENUM_TYPE_ID=NOTIF_BOPIS
VITE_FIREBASE_CONFIG={"apiKey": "","authDomain": "","databaseURL": "","projectId": "","storageBucket": "","messagingSenderId": "","appId": ""}
VITE_FIREBASE_VAPID_KEY=""
```

A new app uses its own app id and enum type (both must exist on the backend, with one enum per
notification kind). Keep `VITE_FIREBASE_CONFIG` valid JSON with an empty `apiKey` locally:
`firebaseUtil` parses it and skips setup when `apiKey` is empty. Never commit real values.

**Service worker:** copy `apps/bopis/public/firebase-messaging-sw.js` as is, changing only the
`bopis-` tag prefix and the icon path. The deploy step replaces the whole line starting
`const firebaseConfig =`, so keep that line on one line. The app must deploy through the shared
`common-firebase-hosting-*` workflows (or do the same `sed`) for background messages to work. Check the config with
`firebaseMessaging.isFcmConfigured(import.meta.env.VITE_FIREBASE_CONFIG)` before showing toggles as
usable.

## `firebaseMessaging`

| Call | Does |
|---|---|
| `initialiseFirebaseApp(config, vapidKey, onToken, onMessage)` | Firebase init; asks permission **only if not already granted**; on `granted` gets the token, awaits `onToken(token)`, and routes messages to `onMessage({ notification, isForeground })`: foreground via Firebase `onMessage`, background via the `FB_BG_MESSAGES` BroadcastChannel the service worker posts to. Resolves `{ status: "token" }`, `{ status: "permission", permission }` (denied or dismissed) or `{ status: "unsupported" }`; it never rejects for those |
| `generateDeviceId(existing?)` | returns `existing` if set, else a new id (`ddMMyy` + 6 digits). Pass the stored id so a device keeps one id |
| `generateTopicName(oms, facilityId, enumId)` | the topic string above |
| `isFcmConfigured(configString)` | the JSON parses and has an `apiKey` |

## `useNotificationStore()` (Pinia, `persist: true`)

| Member | Does |
|---|---|
| `notifications` / `getNotifications` | received notifications, newest first (`time` desc); each is the FCM payload (`data.title`, `data.body`, …) plus `isForeground` and `time` |
| `hasUnreadNotifications` / `getUnreadNotificationsStatus`, `setUnreadNotificationsStatus(bool)` | the bell badge; `addNotification` sets it, the app clears it when the list opens |
| `addNotification(payload)` | prepends it, sets `hasUnreadNotifications`, toasts when `payload.isForeground` |
| `firebaseDeviceId` / `getFirebaseDeviceId` | this device's id, set by `storeClientRegistrationToken` |
| `storeClientRegistrationToken(token, deviceId, appId)` | `POST firebase/token`; logs on failure, doesn't throw |
| `removeClientRegistrationToken(deviceId, appId)` | `DELETE firebase/token`; logs on failure |
| `fetchAllNotificationPrefs(appId, userId, deviceId?)` | the user's subscribed topics into `allNotificationPrefs` |
| `fetchNotificationPreferences(enumTypeId, appId, userId, topicNameFor, deviceId?)` | the kinds into `notificationPrefs`: the enum rows (`enumId`, `description`, …) each with `isEnabled` = subscribed |
| `subscribeTopic(topic, appId, deviceId?)` / `unsubscribeTopic(…)` | **resolve `true`/`false`, never reject**. "Already subscribed" counts as `true`. `deviceId` defaults to the stored one |
| `isFirebaseInitialised` | set by the app once registration ran (BOPIS's guard); persisted, reset by `clearNotificationState()` |
| `clearNotificationState()` | empties notifications and prefs, resets the flag; keeps `firebaseDeviceId` |

Each state field has a `get…` getter (`getNotifications`, `getNotificationPrefs`,
`getAllNotificationPrefs`, `getFirebaseDeviceId`, `getUnreadNotificationsStatus`) and a `set…`
action. `storeClientRegistrationToken` stores the device id before posting, so the id survives a
failed POST. Pass `deviceId` to the two `fetch…` calls only once the backend's rows carry a device; on older rows
the filter returns nothing.

## How BOPIS wires it (copy this)

| File | What it does |
|---|---|
| `src/utils/firebaseUtil.ts` | `initialiseFirebaseMessaging()`: one function around `initialiseFirebaseApp` |
| `src/store/user.ts` | `postLogin`: load the user's subscriptions, register only if there are any. `preLogout`: remove the token. `postLogout`: `clearNotificationState()` |
| `src/main.ts` | passes `postLogin`, `preLogout`, `postLogout` to `initialiseConfig` (**accxui-auth**) |
| `src/App.vue` | on load, when authenticated and the user has subscriptions, registers again (`postLogin` doesn't run on a reload) |
| `src/views/Settings.vue` | one toggle per notification kind for the current facility |
| `src/components/NotificationPreferenceModal.vue` | the same kinds as a form, saved together; opened from the Notifications page |
| `src/views/Notifications.vue` | lists `getNotifications` (`notification.data.title` / `.body`, `time`) |
| `src/views/Orders.vue` | the bell: `setUnreadNotificationsStatus(false)`, then `/notifications` |
| `public/firebase-messaging-sw.js` | the service worker (below) |
| `.env.example` | the four `VITE_*` names |

Imports used below: `firebaseMessaging`, `useNotificationStore`, `commonUtil`, `emitter`,
`translate`, `useAuth` from `@common`; `firebaseUtil` from `@/utils/firebaseUtil`; `DateTime` from
`luxon`. `currentFacility` and `userProfile` come from the app's own stores.

### Registering the device

```ts
// src/utils/firebaseUtil.ts
import { firebaseMessaging, useNotificationStore } from "@common";
import { DateTime } from "luxon";

const initialiseFirebaseMessaging = async () => {
  const notificationStore = useNotificationStore();
  if (notificationStore.isFirebaseInitialised) return;

  const appFirebaseConfig = JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG as any);
  const appFirebaseVapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

  if (appFirebaseConfig && appFirebaseConfig.apiKey) {
    await firebaseMessaging.initialiseFirebaseApp(
      appFirebaseConfig,
      appFirebaseVapidKey,
      async (token: string) => {
        await notificationStore.storeClientRegistrationToken(token, firebaseMessaging.generateDeviceId(notificationStore.getFirebaseDeviceId), import.meta.env.VITE_NOTIF_APP_ID);
      },
      (notification: any) => {
        notificationStore.addNotification({ ...notification.notification, isForeground: notification.isForeground, time: DateTime.now().toMillis() });
      }
    );
    notificationStore.isFirebaseInitialised = true;
  }
};

export const firebaseUtil = { initialiseFirebaseMessaging };
```

An app whose build runs the shared `dbConfig` lint (Company, Order Manager) rejects a store call in
`src/utils`; there, put the same function in a user-store action instead. BOPIS's build doesn't lint.

### Login, reload, logout

```ts
// src/store/user.ts, inside postLogin after the profile and facilities are loaded
const notificationStore = useNotificationStore();
await notificationStore.fetchAllNotificationPrefs(import.meta.env.VITE_NOTIF_APP_ID as any, this.current.userId);
// Register the device token only when there are notification preferences already set
if (notificationStore.getAllNotificationPrefs?.length) {
  await firebaseUtil.initialiseFirebaseMessaging();
}

// preLogout: the session is still valid here
const notificationStore = useNotificationStore();
if (notificationStore.getFirebaseDeviceId) {
  await notificationStore.removeClientRegistrationToken(notificationStore.getFirebaseDeviceId, import.meta.env.VITE_NOTIF_APP_ID as any);
}

// postLogout
useNotificationStore().clearNotificationState();
```

```ts
// src/App.vue, onMounted
const allNotificationPrefs = computed(() => useNotificationStore().getAllNotificationPrefs);
if (isAuthenticated.value && allNotificationPrefs.value?.length) {
  await firebaseUtil.initialiseFirebaseMessaging();
}
```

### Preferences

Load the kinds for the current facility whenever the screen opens or the facility changes (the
modal and the Settings page both change them):

```ts
await useNotificationStore().fetchNotificationPreferences(
  import.meta.env.VITE_NOTIF_ENUM_TYPE_ID,
  import.meta.env.VITE_NOTIF_APP_ID,
  userProfile.value?.userId,
  (enumId: string) => firebaseMessaging.generateTopicName(commonUtil.getOMSInstanceName(), currentFacility.value?.facilityId, enumId),
);
// → getNotificationPrefs: the enums, each with isEnabled
```

One toggle (Settings):

```ts
async function updateNotificationPref(enumId: string) {
  let isToggledOn = false;
  const notificationStore = useNotificationStore();
  try {
    if (!firebaseMessaging.isFcmConfigured(import.meta.env.VITE_FIREBASE_CONFIG)) {
      commonUtil.showToast(translate("Notification preferences not updated. Please try again."));
      return;
    }
    emitter.emit("presentLoader", { backdropDismiss: false });
    const topicName = firebaseMessaging.generateTopicName(commonUtil.getOMSInstanceName(), currentFacility.value?.facilityId, enumId);
    const pref = notificationPrefs.value.find((p: any) => p.enumId === enumId);
    pref.isEnabled
      ? await notificationStore.unsubscribeTopic(topicName, import.meta.env.VITE_NOTIF_APP_ID)
      : await notificationStore.subscribeTopic(topicName, import.meta.env.VITE_NOTIF_APP_ID);
    isToggledOn = !pref.isEnabled;
    pref.isEnabled = !pref.isEnabled;
    notificationStore.setNotificationPrefs(notificationPrefs.value);
    commonUtil.showToast(translate("Notification preferences updated."));
  } catch (error) {
    commonUtil.showToast(translate("Notification preferences not updated. Please try again."));
  } finally {
    emitter.emit("dismissLoader");
  }

  // First subscription on this device → register it; last one off → remove the token.
  if (!allNotificationPrefs.value.length && isToggledOn) {
    await firebaseUtil.initialiseFirebaseMessaging();
  } else if (allNotificationPrefs.value.length == 1 && !isToggledOn) {
    await notificationStore.removeClientRegistrationToken(firebaseDeviceId.value, import.meta.env.VITE_NOTIF_APP_ID);
  }
  await notificationStore.fetchAllNotificationPrefs(import.meta.env.VITE_NOTIF_APP_ID, userProfile.value?.userId);
}
```

Settings template: one `ion-toggle` per `notificationPrefs` entry, label `pref.description`,
`:checked="pref.isEnabled"`, `@click.prevent="updateNotificationPref(pref.enumId)"`, shown when
`isFcmConfigured` is true.

Notifications page: `ion-list` over `getNotifications`, each item `notification.data.title`,
`notification.data.body` and the relative `notification.time`; a button opens the preferences modal.
The bell elsewhere calls `setUnreadNotificationsStatus(false)` and routes to `/notifications`.

Several kinds saved at once (the modal): collect the enums to subscribe and to unsubscribe, then
send them together with `subscribeTopic` / `unsubscribeTopic` for each, built with the same
`generateTopicName`.

`subscribeTopic` / `unsubscribeTopic` resolve `true` when the backend confirmed the change and
`false` when it didn't (they don't throw); read the value if a screen needs to tell the two apart.

## Service worker rules

- **Show a notification inside every `push` event** (`event.waitUntil(self.registration.showNotification(…))`).
  WebKit counts a push that shows nothing as silent and, after a few, revokes the subscription: the
  device stays registered and receives nothing.
- Skip your own banner when the payload has a `notification` block and no window is visible:
  Firebase shows that one itself, and both would appear.
- Give banners a `tag` (the order id when there is one) so a repeat replaces instead of stacking.
- Keep the `FB_BG_MESSAGES` channel name: `initialiseFirebaseApp` listens on it.
- Never let Firebase init throw out of the worker: a failed install leaves the device with no push
  subscription at all.
- `notificationclick` routes to `data.click_action` (focus an open window on that path, else open one).

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| Registering the device for every user at login | permission prompts and tokens for users with no subscriptions | only when `getAllNotificationPrefs` is non-empty |
| Calling `Notification.requestPermission()` yourself before init | iOS refuses out of a user gesture | let `initialiseFirebaseApp` ask, only when not granted |
| Removing the token in `postLogout` | the session is gone by then, the DELETE fails | `preLogout` |
| No `App.vue` call | after a reload the device isn't set up until the next login | register again when authenticated with subscriptions |
| A push handler that shows nothing for some payloads | Safari revokes the subscription | always `showNotification` |
| Real Firebase values in `.env` / the worker in git | leaked config | CI injects them; commit placeholders |
| Topic built from a facility other than the current one | toggles show the wrong state | `generateTopicName(oms, currentFacilityId, enumId)` everywhere |
