---
name: accxui-push-notifications
description: Use when an AccxUI app (apps/bopis, apps/fulfillment or a new one) sends or receives Firebase Cloud Messaging push notifications, or works on notification preferences / topics. Triggers include firebaseMessaging, initialiseFirebaseApp, generateTopicName, generateDeviceId, isFcmConfigured, useNotificationStore, subscribeTopic / unsubscribeTopic, storeClientRegistrationToken / removeClientRegistrationToken, fetchNotificationPreferences / fetchAllNotificationPrefs, firebase-messaging-sw.js, FB_BG_MESSAGES, VITE_FIREBASE_CONFIG, VITE_FIREBASE_VAPID_KEY, VITE_NOTIF_APP_ID, VITE_NOTIF_ENUM_TYPE_ID, a device that stops receiving pushes (iOS / Safari), a duplicate banner, or a notification preferences screen.
---

# Firebase push notifications

The framework (`@common`) gives two pieces: `firebaseMessaging` (Firebase setup and naming helpers)
and `useNotificationStore` (device token, topic subscriptions, received notifications; persisted).
The app supplies the env config, the service worker, and the wiring into login, logout and its
preference screen. BOPIS is the working reference (`apps/bopis`); Fulfillment wires the same pieces through
`src/utils/firebaseUtil.ts` (a util that reads a store: don't copy that part). Push needs no app database.

## How it fits together

- A **topic** is one kind of notification for one facility on one OMS:
  `generateTopicName(oms, facilityId, enumId)` → `"<oms>-<facilityId>-<enumId>"`. The kinds are the
  enums of type `VITE_NOTIF_ENUM_TYPE_ID`.
- The backend sends to topics. A **device** receives a topic once it has registered its FCM token
  (`POST firebase/token`) and the user has subscribed the topic for that device (`POST firebase/topic`).
- Both backend tables are keyed by **device**: the token (`UserLoginFirebaseClient`: user, device,
  app) and the subscriptions (`FirebaseNotificationTopicUser`: topic, user, device). `POST firebase/topic`
  requires a `deviceId`. Registering a token subscribes it to the topics already saved for that device.
- `DELETE firebase/token` disconnects the token and deletes its row but **keeps the device's
  subscriptions**, so a device keeps one id for good: the next login re-registers under the same id
  and the subscriptions come back. `POST firebase/token` returns early when a row exists for the
  device, even if the token differs, so a changed token is registered by deleting the row first.
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
BOPIS's setup store parses it and skips setup when `apiKey` is empty. Never commit real values.

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
| `isFirebaseInitialised` | set by the app once the backend accepted a token; **not persisted** (the Firebase listeners are gone after a reload, so a persisted `true` skipped setup), reset by `clearNotificationState()` |
| `clearNotificationState()` | empties notifications and prefs, resets the flag; **keeps `firebaseDeviceId`** on purpose (see above) |

Each state field has a `get…` getter (`getNotifications`, `getNotificationPrefs`,
`getAllNotificationPrefs`, `getFirebaseDeviceId`, `getUnreadNotificationsStatus`) and a `set…`
action. `storeClientRegistrationToken` stores the device id before posting, so the id survives a
failed POST. Pass `deviceId` to the two `fetch…` calls only once the backend's rows carry a device; on older rows
the filter returns nothing.

## How BOPIS wires it (copy this)

Read `apps/bopis/src/store/notificationSetup.ts`, `apps/bopis/src/composables/useNotificationDeviceSetup.ts` and `apps/bopis/src/utils/firebaseUtil.ts`; they are the reference. The rules they encode:

| File | What it does |
|---|---|
| `src/store/notificationSetup.ts` | `useNotificationSetupStore`: token registration (`registerToken`), `initialiseFirebaseMessaging` with its listeners, the resume token check, and `lastInitialiseError`. A store because `postLogin` needs it too, and a store can't call a composable |
| `src/composables/useNotificationDeviceSetup.ts` | what only the screens use: the Enable chain (`setUpNotificationsOnThisDevice`), `getNotificationHealthIssue` and `isDeviceSetUp`. Calls the store to register |
| `src/utils/firebaseUtil.ts` | browser-only helpers, no API and no stores: the permission request, `canInitialiseWithoutPrompting`, the push worker (`ensurePushWorker`, `waitForActivation`), the platform check and the locally recorded token |
| `src/store/user.ts` | `postLogin`: mint the device id once (`setFirebaseDeviceId(generateDeviceId())` when empty); read **this device's** subscriptions; register only if there are any **and** permission is already `granted`. `preLogout`: remove the token. `postLogout`: `clearNotificationState()` |
| `src/main.ts` | passes `postLogin`, `preLogout`, `postLogout` to `initialiseConfig` (**accxui-auth**) |
| `src/App.vue` | on load (`postLogin` doesn't run on a reload): the same as login: mint the id if missing, read this device's subscriptions, register only when already granted |
| `src/views/Settings.vue` | one toggle per kind, read for this device; an **Enable** item on the card whenever `getNotificationHealthIssue()` reports something missing |
| `src/components/NotificationPreferenceModal.vue` | the same kinds as a form; asks permission from the Save tap, registers the device if it isn't yet, subscribes with this device's id |
| `src/views/Notifications.vue` | lists `getNotifications` (`notification.data.title` / `.body`, `time`) |
| `src/views/Orders.vue` | the bell: `setUnreadNotificationsStatus(false)`, then `/notifications` |
| `public/firebase-messaging-sw.js` | the service worker (below) |
| `.env.example` | the four `VITE_*` names |

**Permission only from a tap.** `Notification.requestPermission()` outside a user gesture is refused
by iOS and Firefox, which leave permission at `default` with nothing visibly wrong. So:
- Login and app mount call `initialiseFirebaseMessaging` only when `canInitialiseWithoutPrompting()`
  (permission already `granted`).
- Asking happens in a tap, **before that handler's first `await`**:
  `requestNotificationPermissionFromGesture()` in the Settings toggle and the modal's Save, and
  `setUpNotificationsOnThisDevice()` behind Settings' Enable button, which calls
  `Notification.requestPermission()` synchronously and then runs the chain.

**`setUpNotificationsOnThisDevice()`**: permission → config → `isSupported()` →
`ensurePushWorker()` (registers `/firebase-messaging-sw.js` at the SDK's scope and waits for
`activated`, since `getToken` subscribes before the worker is active and fails with `AbortError`) →
`initialiseFirebaseMessaging` → `isDeviceSetUp()`. It stops at the first step that
fails and returns `failedStep`, which Settings turns into a toast.

**`initialiseFirebaseMessaging()`** returns whether the backend accepted the token:
- registers the token with `api()` directly and checks `commonUtil.hasError`, because
  `storeClientRegistrationToken` swallows failures; the accepted token is kept in localStorage so
  `isDeviceSetUp` / `getNotificationHealthIssue` judge on facts;
- **deletes the device's row before posting** whenever the token differs from the one the backend
  confirmed (or none is recorded): `POST firebase/token` returns early on an existing row and keeps
  the old token. It aborts, without posting, unless the delete succeeded or the row was missing;
- attaches a resume check (`visibilitychange` / `focus`, at most once a minute) that asks
  `getToken` again and re-registers a rotated token, only while this session's device is registered;
- sets `isFirebaseInitialised` **only** when a token was accepted;
- only the listener from the latest call delivers, so calling it again never doubles notifications;
- subscribes nothing itself: storing the token subscribes it to the topics already saved for this
  device. A user switches notifications on per device; a new device does not inherit another's.

**Toggles** pass `getFirebaseDeviceId` to `subscribeTopic` / `unsubscribeTopic` /
`fetchNotificationPreferences` / `fetchAllNotificationPrefs`, and treat a `false` from
subscribe/unsubscribe as a failure: show the error toast, leave the switch, and skip the
register / remove-token step (a refused subscribe read as "last one off" would de-register the device).
The first switch on for this device registers it when permission is granted; the last one off
removes the token.

Notifications page: `ion-list` over `getNotifications`, each item `notification.data.title`,
`notification.data.body` and the relative `notification.time`; a button opens the preferences modal.
The bell elsewhere calls `setUnreadNotificationsStatus(false)` and routes to `/notifications`.

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
| Initialising from login or app mount while permission is `default` | the prompt is refused outside a gesture and permission can stay stuck | `canInitialiseWithoutPrompting()` there; ask from a tap, before its first `await` |
| Setting `isFirebaseInitialised` whatever the result | a device refused once never registers until logout | set it only when the backend accepted the token |
| Subscribing without this device's id, or ignoring a `false` | the backend refuses it and the switch reads on with nothing saved | mint the id at login, pass it, treat `false` as failure |
| Posting a changed token without deleting the row | the backend keeps the old token and the device receives nothing | delete, then post (`registerToken`) |
| Clearing `firebaseDeviceId` on logout | the next login registers a new id with no subscriptions | keep the id |
| Removing the token in `postLogout` | the session is gone by then, the DELETE fails | `preLogout` |
| No `App.vue` call | after a reload the device isn't set up until the next login | register again when authenticated with subscriptions |
| A push handler that shows nothing for some payloads | Safari revokes the subscription | always `showNotification` |
| Real Firebase values in `.env` / the worker in git | leaked config | CI injects them; commit placeholders |
| Topic built from a facility other than the current one | toggles show the wrong state | `generateTopicName(oms, currentFacilityId, enumId)` everywhere |
