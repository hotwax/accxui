import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { DateTime } from "luxon";

const initialiseFirebaseApp = async (
  appFirebaseConfig: any,
  appFirebaseVapidKey: string,
  onTokenReceived: (token: string) => Promise<void>,
  onMessageReceived: (payload: any) => void
) => {
  if (!await isSupported()) {
    console.error("Notifications not supported");
    return;
  }

  const app = initializeApp(appFirebaseConfig);
  const messaging = getMessaging(app);
  const permission = await Notification.requestPermission();

  if (permission === "granted") {
    const token = await getToken(messaging, {
      vapidKey: appFirebaseVapidKey
    });
    await onTokenReceived(token);

    // handle foreground message
    onMessage(messaging, (payload: any) => {
      onMessageReceived({ notification: payload, isForeground: true });
    });

    // handle background message (service worker)
    const broadcast = new BroadcastChannel('FB_BG_MESSAGES');
    broadcast.onmessage = (event) => {
      onMessageReceived({ notification: event.data, isForeground: false });
    };
  } else {
    console.warn("Notification permission denied.");
  }
};

const generateDeviceId = (deviceId?: string) => {
  return deviceId ? deviceId : (DateTime.now().toFormat('ddMMyy') + String(DateTime.now().toMillis()).slice(-6));
}

const generateTopicName = (omsInstanceName: string, facilityId: string, enumId: string) => {
  return `${omsInstanceName}-${facilityId}-${enumId}`;
};

const isFcmConfigured = (firebaseConfig: string) => {
  try {
    const config = JSON.parse(firebaseConfig);
    return !!(config && config.apiKey);
  } catch (e) {
    return false;
  }
}

export const firebaseMessaging = {
  initialiseFirebaseApp,
  generateDeviceId,
  generateTopicName,
  isFcmConfigured
}
