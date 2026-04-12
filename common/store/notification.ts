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
    getAllNotificationPrefs: (state: NotificationState) => state.allNotificationPrefs,
    isFirebaseInitialised: (state: NotificationState) => state.isFirebaseInitialised,
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
    async fetchNotificationPreferences(enumTypeId: string, applicationId: string, userId: string, topicNameGenerator: (enumId: string) => string) {
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
          params: { topicTypeId: applicationId, userId: userId, pageSize: 200 }
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

    async fetchAllNotificationPrefs(applicationId: string, userId: string) {
      try {
        const resp: any = await api({
          url: "firebase/user/notificationtopic",
          method: "get",
          params: { topicTypeId: applicationId, userId: userId, pageSize: 200 }
        });
        this.allNotificationPrefs = resp.data;
      } catch (error) {
        logger.error(error);
      }
    },
    async subscribeTopic(topicName: string, applicationId: string) {
      try {
        await api({
          url: "firebase/topic",
          method: "post",
          data: { topicName, applicationId }
        });
      } catch (error) {
        logger.error(error);
      }
    },
    async unsubscribeTopic(topicName: string, applicationId: string) {
      try {
        await api({
          url: "firebase/topic",
          method: "delete",
          data: { topicName, applicationId }
        });
      } catch (error) {
        logger.error(error);
      }
    },
    clearNotificationState() {
      this.notifications = [];
      this.notificationPrefs = [];
      this.firebaseDeviceId = "";
      this.hasUnreadNotifications = true;
      this.allNotificationPrefs = [];
      this.isFirebaseInitialised = false;
    }
  },
  persist: true
});
