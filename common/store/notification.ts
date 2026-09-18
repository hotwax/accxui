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
     * FirebaseNotificationTopicUser is keyed by device as well as user, so a subscription has to say
     * which device it is for. deviceId defaults to the one this store already holds rather than being
     * threaded through every caller: the store is where it lives, and a component reading the getter
     * only to hand it straight back is a round trip that can go stale. Pass it explicitly only when
     * registering a device whose id is not in the store yet.
     */
    async subscribeTopic(topicName: string, applicationId: string, deviceId?: string) {
      try {
        await api({
          url: "firebase/topic",
          method: "post",
          data: { topicName, applicationId, deviceId: deviceId ?? this.firebaseDeviceId }
        });
      } catch (error) {
        logger.error("Failed to subscribe the topic", error);
      }
    },
    async unsubscribeTopic(topicName: string, applicationId: string, deviceId?: string) {
      try {
        await api({
          url: "firebase/topic",
          method: "delete",
          data: { topicName, applicationId, deviceId: deviceId ?? this.firebaseDeviceId }
        });
      } catch (error) {
        logger.error("Failed to unsubscribe the topic", error);
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
  persist: true
});
