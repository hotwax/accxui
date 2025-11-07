import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { useUserStore, useFirebaseNotificationStore } from "../index";
import { DateTime } from "luxon"

type StoreClientRegistrationTokenFn = (token: string) => Promise<void> | void;
type AddNotificationFn = (notification: { notification: any; isForeground: boolean }) => Promise<void> | void;


const initialiseFirebaseApp = async (
  appFirebaseConfig: any,
  appFirebaseVapidKey: string,
  storeClientRegistrationToken: StoreClientRegistrationTokenFn,
  addNotification: AddNotificationFn
) => {
  const firebaseConfig = appFirebaseConfig

  if(!await isSupported()) {
    console.error("Notifications not supported");
    return;
  }

  const app = initializeApp(firebaseConfig);
  const messaging = getMessaging(app);
  const permission = await Notification.requestPermission();

  if (permission === "granted") {
    const token = await getToken(messaging, {
      vapidKey: appFirebaseVapidKey
    });
    await storeClientRegistrationToken(token)

    // handle foreground message
    onMessage(messaging, (payload: any) => {
      addNotification({ notification: payload, isForeground: true });
    });

    // handle background message (service worker)
    const broadcast = new BroadcastChannel('FB_BG_MESSAGES');
    broadcast.onmessage = (event) => {
      addNotification({ notification: event.data, isForeground: false });
    };
  } else {
    alert("You denied notifications.");
  }
};

const storeClientRegistrationToken = async (registrationToken: string) => {
  const firebaseNotificationStore = useFirebaseNotificationStore()
  firebaseNotificationStore.storeClientRegistrationToken(registrationToken);
}

const addNotification = async (notification: any) => {
  const firebaseNotificationStore = useFirebaseNotificationStore()
  firebaseNotificationStore.addNotification(notification);
}

// device ID: <DDMMYY><timestamp[6]>
const generateDeviceId = () => {
  const firebaseNotificationStore = useFirebaseNotificationStore()
  const deviceId = firebaseNotificationStore.getFirebaseDeviceId
  return deviceId ? deviceId : (DateTime.now().toFormat('ddMMyy') + String(DateTime.now().toMillis()).slice(-6))
}

// topic name: oms-facilityId-enumId(enumCode)
const generateTopicName = (facilityId: string, enumId: string) => {
  const userStore = useUserStore()
  const userProfile = userStore.getUserProfile
  return `${userProfile.omsInstanceName}-${facilityId}-${enumId}`;
};

//Checking if firebase cloud messaging is configured.
const isFcmConfigured = () => {
  try {
    const config = JSON.parse(import.meta.env.VITE_VUE_APP_FIREBASE_CONFIG as any);
    return !!(config && config.apiKey);
  } catch (e) {
    return false;
  }
}

export {
  initialiseFirebaseApp,
  storeClientRegistrationToken,
  generateDeviceId,
  generateTopicName,
  isFcmConfigured,
  addNotification
}