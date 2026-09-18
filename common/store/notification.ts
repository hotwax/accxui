import { defineStore } from "pinia";
import api from "../core/remoteApi";
import logger from "../core/logger";
import { commonUtil } from "../utils/commonUtil";
import { translate } from "../core/i18n";

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
    /*
     * Topic subscriptions are scoped to a DEVICE on the backend (NotificationTopicUser carries a
     * deviceId, and subscribe#Topic requires one), so a preference is "on" only for the device it
     * was switched on from. Every method below therefore names the device: the one passed in, or
     * failing that the one this store registered. When neither exists nothing is sent, which keeps
     * the same request shape a user-scoped backend accepts.
     */
    deviceScope(deviceId?: string) {
      const forDevice = deviceId || this.firebaseDeviceId;
      return forDevice ? { deviceId: forDevice } : {};
    },
    /** `deviceId` narrows the switches to THIS device's subscriptions; without it another device's "on" would show here as on. */
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
          params: { topicTypeId: applicationId, userId: userId, pageSize: 200, ...this.deviceScope(deviceId) }
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
      this.firebaseDeviceId = deviceId;
      try {
        await api({
          url: "firebase/token",
          method: "post",
          data: { registrationToken, deviceId, applicationId }
        });
      } catch (error) {
        logger.error(error);
      }
    },

    async removeClientRegistrationToken(deviceId: string, applicationId: string) {
      this.firebaseDeviceId = deviceId;
      try {
        await api({
          url: "firebase/token",
          method: "delete",
          data: { deviceId, applicationId }
        });
      } catch (error) {
        logger.error(error);
      }
    },

    /** Every device's rows unless `deviceId` is given — the cross-device view, so no default here. */
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
    /*
     * Both of these THROW on failure. They used to swallow it, so a 400 from the backend still left
     * the caller's "preferences updated" path running and the switch flipped on screen while the
     * server had changed nothing. Callers already carry the failure branch; this lets it run.
     * api() resolves with an error body as well as throwing, so that body counts as failure too.
     */
    async subscribeTopic(topicName: string, applicationId: string, deviceId?: string) {
      try {
        const resp: any = await api({
          url: "firebase/topic",
          method: "post",
          data: { topicName, applicationId, ...this.deviceScope(deviceId) }
        });
        if (commonUtil.hasError(resp)) throw resp;
      } catch (error) {
        logger.error(error);
        throw error;
      }
    },
    async unsubscribeTopic(topicName: string, applicationId: string, deviceId?: string) {
      try {
        const resp: any = await api({
          url: "firebase/topic",
          method: "delete",
          data: { topicName, applicationId, ...this.deviceScope(deviceId) }
        });
        if (commonUtil.hasError(resp)) throw resp;
      } catch (error) {
        logger.error(error);
        throw error;
      }
    },
    clearNotificationState() {
      this.notifications = [];
      this.notificationPrefs = [];
      this.hasUnreadNotifications = true;
      this.allNotificationPrefs = [];
      this.isFirebaseInitialised = false;
    }
  },
  persist: true
});
