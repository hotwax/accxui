import logger from "../core/logger";
import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { DateTime } from "luxon";

/**
 * How initialiseFirebaseApp ended, for callers that need to tell a registered device from one that
 * was skipped. Resolving is not success: it also resolves when push is unsupported or permission
 * was not granted, and callers that ignore the result keep the old behaviour.
 */
export type FirebaseInitialiseResult =
  | { status: "unsupported" }
  | { status: "permission"; permission: NotificationPermission }
  | { status: "token" };

const initialiseFirebaseApp = async (
  appFirebaseConfig: any,
  appFirebaseVapidKey: string,
  onTokenReceived: (token: string) => Promise<void>,
  onMessageReceived: (payload: any) => void
): Promise<FirebaseInitialiseResult> => {
  if (!await isSupported()) {
    logger.error("Notifications not supported");
    return { status: "unsupported" };
  }

  const app = initializeApp(appFirebaseConfig);
  const messaging = getMessaging(app);
  // Only ask when nothing has been decided yet. This always runs after several awaits, so it is
  // never inside a user gesture, and iOS answers an out-of-gesture request with a refusal even for
  // an app that already holds permission — without changing the permission itself. Asking again
  // for a granted device therefore skipped the token on every iOS login, launch and Enable tap.
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();

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
    return { status: "token" };
  }

  logger.warn(`Notification permission not granted: ${permission}`);
  return { status: "permission", permission };
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
