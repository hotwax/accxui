import { defineStore } from "pinia";
import { translate } from "../core/i18n";
import { showToast } from "../utils/commonUtil";
import { notificationApi } from '../index'
import logger from '../core/logger'
import { generateDeviceId } from '../utils/firebaseUtil'
import { DateTime } from 'luxon';

export const useFirebaseNotificationStore = defineStore('firebaseNotification', {
  state: () => {
    return {
      notifications: [],
      notificationPrefs: [],
      firebaseDeviceId: '',
      hasUnreadNotifications: true,
      allNotificationPrefs: [],
    }
  },
  getters: {
    getAllNotificationPrefs(state) {
      return state.allNotificationPrefs
    },
    getFirebaseDeviceId(state) {
      return state.firebaseDeviceId
    },
  },
  actions: {
    addNotification(payload: any) {
      const notifications = JSON.parse(JSON.stringify(this.notifications))
      notifications.push({ ...payload.notification, time: DateTime.now().toMillis() })
      this.hasUnreadNotifications = payload
      if (payload.isForeground) {
        showToast(translate("New notification received."));
      }
      this.notifications = notifications
    },
    async storeClientRegistrationToken(registrationToken: any) {
      const firebaseDeviceId = generateDeviceId()
      this.firebaseDeviceId = firebaseDeviceId

      try {
        await notificationApi.storeClientRegistrationToken(registrationToken, firebaseDeviceId,  import.meta.env.VITE_VUE_APP_NOTIF_APP_ID as any)
      } catch (error) {
        logger.error(error)
      }
    }
  },
  persist: true
})
