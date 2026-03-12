import { defineStore } from "pinia";
import api from "../core/remoteApi";
import logger from "../core/logger";

interface NotificationState {
  notifications: any[];
  notificationPrefs: any[];
  firebaseDeviceId: string;
  hasUnreadNotifications: boolean;
  allNotificationPrefs: any[];
}

export const useNotificationStore = defineStore("notification", {
  state: (): NotificationState => ({
    notifications: [],
    notificationPrefs: [],
    firebaseDeviceId: "",
    hasUnreadNotifications: true,
    allNotificationPrefs: [],
  }),
  getters: {
    getNotifications(state: NotificationState) {
      return [...state.notifications].sort((a: any, b: any) => b.time - a.time);
    },
    getNotificationPrefs: (state: NotificationState) => state.notificationPrefs,
    getFirebaseDeviceId: (state: NotificationState) => state.firebaseDeviceId,
    getUnreadNotificationsStatus: (state: NotificationState) => state.hasUnreadNotifications,
    getAllNotificationPrefs: (state: NotificationState) => state.allNotificationPrefs,
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
    },
    async fetchNotificationPreferences(enumTypeId: string, applicationId: string, userLoginId: string, topicNameGenerator: (enumId: string) => string) {
      let enumerationResp: any[] = [];
      let userPrefIds: any[] = [];
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
          params: { topicTypeId: applicationId, userId: userLoginId, pageSize: 200 }
        });
        userPrefIds = resp.data.map((userPref: any) => userPref.userPrefTypeId);
      } catch (error) {
        logger.error(error);
      } finally {
        if (enumerationResp.length) {
          this.notificationPrefs = enumerationResp.reduce((notifactionPref: any, pref: any) => {
            const topicName = topicNameGenerator(pref.enumId);
            notifactionPref.push({ ...pref, isEnabled: userPrefIds.includes(topicName) });
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
    async fetchAllNotificationPrefs(applicationId: string, userLoginId: string) {
      try {
        const resp: any = await api({
          url: "firebase/user/notificationtopic",
          method: "get",
          params: { topicTypeId: applicationId, userId: userLoginId, pageSize: 200 }
        });
        this.allNotificationPrefs = resp.data.docs;
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
    }
  }
});
