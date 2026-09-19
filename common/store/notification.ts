import { defineStore } from "pinia";
import api from "../core/remoteApi";
import logger from "../core/logger";
import { commonUtil } from "../utils/commonUtil";
import { translate } from "../core/i18n";

/**
 * The backend refuses a second NotificationTopicUser row for the same topic, user and device with
 * a duplicate-key error. The device IS subscribed, which is the end state the caller asked for, so
 * this counts as success rather than a failure the UI has to explain.
 */
function isAlreadySubscribed(error: any): boolean {
  const body = error?.response?.data ?? error?.data ?? error;
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  return /already exists|duplicate entry/i.test(text);
}

interface NotificationState {
  notifications: any[];
  notificationPrefs: any[];
  firebaseDeviceId: string;
  hasUnreadNotifications: boolean;
  allNotificationPrefs: any[];
  isFirebaseInitialised: boolean;
}

export const useNotificationStore = defineStore("notification", {
  state: (): NotificationState => ({
    notifications: [],
    notificationPrefs: [],
    firebaseDeviceId: "",
    hasUnreadNotifications: true,
    allNotificationPrefs: [],
    isFirebaseInitialised: false,
  }),
  getters: {
    getNotifications(state: NotificationState) {
      return [...state.notifications].sort((a: any, b: any) => b.time - a.time);
    },
    getNotificationPrefs: (state: NotificationState) => state.notificationPrefs,
    getFirebaseDeviceId: (state: NotificationState) => state.firebaseDeviceId,
    getUnreadNotificationsStatus: (state: NotificationState) => state.hasUnreadNotifications,
    getAllNotificationPrefs: (state: NotificationState) => state.allNotificationPrefs
  },
  actions: {
    setNotifications(payload: any) {
      this.notifications = payload;
    },
    setNotificationPrefs(payload: any) {
      this.notificationPrefs = payload;
    },
    setFirebaseDeviceId(payload: any) {
      this.firebaseDeviceId = payload;
    },
    setUnreadNotificationsStatus(payload: any) {
      this.hasUnreadNotifications = payload;
    },
    setAllNotificationPrefs(payload: any) {
      this.allNotificationPrefs = payload;
    },
    async addNotification(payload: any) {
      this.notifications = [payload, ...this.notifications];
      this.hasUnreadNotifications = true;
      if (payload.isForeground) {
        commonUtil.showToast(translate("New notification received."));
      }
    },
    /**
     * deviceId is optional and only added to the query when a caller passes it. FirebaseNotificationTopicUser
     * now records a device, but rows written before that may not have one, and a filter on a column that is
     * not populated returns nothing - which would read as "no subscriptions" on a working device. Opting in
     * per caller keeps apps that have not verified their data on the old, unfiltered behaviour.
     */
    async fetchNotificationPreferences(enumTypeId: string, applicationId: string, userId: string, topicNameGenerator: (enumId: string) => string, deviceId?: string) {
      let enumerationResp: any[] = [];
      let userSubscribedTopics: any[] = [];
      try {
        let resp: any = await api({
          url: "admin/enums",
          method: "get",
          params: { enumTypeId, pageSize: 200 }
        });
        enumerationResp = resp.data;

        resp = await api({
          url: "firebase/user/notificationtopic",
          method: "get",
          params: { topicTypeId: applicationId, userId: userId, pageSize: 200, ...(deviceId ? { deviceId } : {}) }
        });
        userSubscribedTopics = resp.data.map((userPref: any) => userPref.topic);
      } catch (error) {
        logger.error(error);
      } finally {
        if (enumerationResp.length) {
          this.notificationPrefs = enumerationResp.reduce((notifactionPref: any, pref: any) => {
            const topicName = topicNameGenerator(pref.enumId);
            notifactionPref.push({ ...pref, isEnabled: userSubscribedTopics.includes(topicName) });
            return notifactionPref;
          }, []);
        }
      }
    },
    async storeClientRegistrationToken(registrationToken: string, deviceId: string, applicationId: string) {
      logger.warn('Storing the token')
      this.firebaseDeviceId = deviceId;
      try {
        const resp = await api({
          url: "firebase/token",
          method: "post",
          data: { registrationToken, deviceId, applicationId }
        });
        logger.warn('Token registered', resp)
      } catch (error) {
        logger.error(error);
      }
    },

    async removeClientRegistrationToken(deviceId: string, applicationId: string) {
      logger.warn('Removing the token')
      this.firebaseDeviceId = deviceId;
      try {
        const resp = await api({
          url: "firebase/token",
          method: "delete",
          data: { deviceId, applicationId }
        });
        logger.warn('Token removed', resp)
      } catch (error) {
        logger.error(error);
      }
    },

    /** See fetchNotificationPreferences for why deviceId is opt in rather than defaulted. */
    async fetchAllNotificationPrefs(applicationId: string, userId: string, deviceId?: string) {
      try {
        const resp: any = await api({
          url: "firebase/user/notificationtopic",
          method: "get",
          params: { topicTypeId: applicationId, userId: userId, pageSize: 200, ...(deviceId ? { deviceId } : {}) }
        });
        this.allNotificationPrefs = resp.data;
      } catch (error) {
        logger.error(error);
      }
    },
    /**
     * Both report whether the backend confirmed the change. They used to return nothing at all, so a
     * refused toggle still ran the caller's "preferences updated successfully" path while the server
     * had changed nothing — and api() resolves with an error body as well as throwing, so that body
     * counts as failure too.
     *
     * Reporting rather than throwing is deliberate: every caller awaits these inside a try whose
     * catch also guards the token registration that follows, so a rejection skips past the
     * preference update and de-registers the device — one refused toggle would stop push there
     * entirely.
     *
     * FirebaseNotificationTopicUser is keyed by device as well as user, so a subscription has to say
     * which device it is for. deviceId defaults to the one this store already holds rather than being
     * threaded through every caller: the store is where it lives, and a component reading the getter
     * only to hand it straight back is a round trip that can go stale. Pass it explicitly only when
     * registering a device whose id is not in the store yet.
     */
    async subscribeTopic(topicName: string, applicationId: string, deviceId?: string): Promise<boolean> {
      try {
        // An empty string is not a device: the store holds "" until a token registers, and the
        // backend answers an empty deviceId with "Field cannot be empty". Omit it instead.
        const forDevice = deviceId ?? this.firebaseDeviceId;
        const resp: any = await api({
          url: "firebase/topic",
          method: "post",
          data: { topicName, applicationId, ...(forDevice ? { deviceId: forDevice } : {}) }
        });
        if (commonUtil.hasError(resp)) throw resp;
        return true;
      } catch (error) {
        // The end state asked for already holds, so this is not a failure the UI has to explain.
        if (isAlreadySubscribed(error)) return true;
        logger.error("Failed to subscribe the topic", error);
        return false;
      }
    },
    async unsubscribeTopic(topicName: string, applicationId: string, deviceId?: string): Promise<boolean> {
      try {
        const forDevice = deviceId ?? this.firebaseDeviceId;
        const resp: any = await api({
          url: "firebase/topic",
          method: "delete",
          data: { topicName, applicationId, ...(forDevice ? { deviceId: forDevice } : {}) }
        });
        if (commonUtil.hasError(resp)) throw resp;
        return true;
      } catch (error) {
        logger.error("Failed to unsubscribe the topic", error);
        return false;
      }
    },
    clearNotificationState() {
      this.notifications = [];
      this.notificationPrefs = [];
      this.hasUnreadNotifications = true;
      this.allNotificationPrefs = [];
      this.isFirebaseInitialised = false;
      this.firebaseDeviceId = "";
    }
  },
  persist: {
    /*
     * `isFirebaseInitialised` is session state, not user data, and must NOT be persisted.
     *
     * It records whether the Firebase SDK has been initialised in THIS page context. The SDK
     * instance does not survive a reload, but a persisted flag does, so after any reload the
     * flag rehydrates as `true` against a freshly empty SDK. Every caller then takes the early
     * return in `initialiseFirebaseMessaging` and the app silently ends up with no `onMessage`
     * handler, no background-message listener and no registration token, while still reporting
     * itself as initialised.
     *
     * That is not a rare edge case: `VitePWA({ registerType: "autoUpdate" })` reloads the app
     * without asking, so a store device reaches this state on its own.
     */
    omit: ["isFirebaseInitialised"]
  }
});
