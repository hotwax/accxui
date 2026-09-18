// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const api = vi.hoisted(() => vi.fn());
vi.mock("../core/remoteApi", () => ({ default: (...args: any[]) => api(...args) }));
vi.mock("../core/logger", () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../core/i18n", () => ({ translate: (key: string) => key }));
vi.mock("../utils/commonUtil", () => ({
  // Mirrors the real helper: an error BODY on a resolved response counts as failure.
  commonUtil: { hasError: (resp: any) => !!(resp?.data?._ERROR_MESSAGE_), showToast: vi.fn() }
}));

const { useNotificationStore } = await import("../store/notification");

const TOPIC = "oms-100013-NEW_BOPIS_ODR";
const lastCall = () => api.mock.calls[api.mock.calls.length - 1][0];

beforeEach(() => {
  setActivePinia(createPinia());
  api.mockReset();
  api.mockResolvedValue({ status: 200, data: {} });
});

describe("topic subscription is scoped to the device", () => {
  it("subscribes with the device id this store registered when none is passed", async () => {
    const store = useNotificationStore();
    store.setFirebaseDeviceId("DEVICE-A");
    await store.subscribeTopic(TOPIC, "BOPIS");
    expect(lastCall()).toMatchObject({ url: "firebase/topic", method: "post", data: { topicName: TOPIC, applicationId: "BOPIS", deviceId: "DEVICE-A" } });
  });

  it("prefers an explicitly passed device id over the store's", async () => {
    const store = useNotificationStore();
    store.setFirebaseDeviceId("DEVICE-A");
    await store.subscribeTopic(TOPIC, "BOPIS", "DEVICE-B");
    expect(lastCall().data.deviceId).toBe("DEVICE-B");
  });

  it("sends no device id at all when neither exists, so a user-scoped backend still gets the old shape", async () => {
    const store = useNotificationStore();
    await store.subscribeTopic(TOPIC, "BOPIS");
    expect(lastCall().data).toEqual({ topicName: TOPIC, applicationId: "BOPIS" });
  });

  it("unsubscribes for the same device, otherwise the backend would delete nothing or someone else's row", async () => {
    const store = useNotificationStore();
    store.setFirebaseDeviceId("DEVICE-A");
    await store.unsubscribeTopic(TOPIC, "BOPIS");
    expect(lastCall()).toMatchObject({ method: "delete", data: { topicName: TOPIC, applicationId: "BOPIS", deviceId: "DEVICE-A" } });
  });
});

describe("failures are reported rather than thrown or swallowed", () => {
  it("returns false when the backend rejects the subscribe", async () => {
    api.mockRejectedValue({ response: { status: 400, data: { errors: "Field cannot be empty (Device ID)" } } });
    await expect(useNotificationStore().subscribeTopic(TOPIC, "BOPIS")).resolves.toBe(false);
  });

  it("returns false for an error body on a 200 too", async () => {
    api.mockResolvedValue({ status: 200, data: { _ERROR_MESSAGE_: "Field cannot be empty (Device ID)" } });
    await expect(useNotificationStore().unsubscribeTopic(TOPIC, "BOPIS")).resolves.toBe(false);
  });

  it("does NOT throw: every caller awaits these inside a try that also guards the token registration, so a rejection would de-register the device", async () => {
    api.mockRejectedValue({ response: { status: 500 } });
    const store = useNotificationStore();
    await expect(store.subscribeTopic(TOPIC, "BOPIS")).resolves.toBe(false);
    await expect(store.unsubscribeTopic(TOPIC, "BOPIS")).resolves.toBe(false);
  });

  it("counts an already-subscribed row as success, because that is the end state asked for", async () => {
    // What lovers-uat actually answers for a duplicate.
    api.mockRejectedValue({ response: { status: 400, data: { errorCode: 400, errors: "Error creating FirebaseNotificationTopicUser [...]: record already exists or related record does not exist [23000]\nDuplicate entry '...' for key 'firebase_notification_topic_user.PRIMARY'\n" } } });
    await expect(useNotificationStore().subscribeTopic(TOPIC, "BOPIS")).resolves.toBe(true);
  });

  it("reports a successful call as true", async () => {
    await expect(useNotificationStore().subscribeTopic(TOPIC, "BOPIS")).resolves.toBe(true);
  });
});

describe("reading preferences", () => {
  const enums = [{ enumId: "NEW_BOPIS_ODR" }, { enumId: "OPEN_BOPIS_ODR" }];
  const topicFor = (enumId: string) => `oms-100013-${enumId}`;

  it("asks for THIS device's rows and marks a switch on only from those", async () => {
    const store = useNotificationStore();
    store.setFirebaseDeviceId("DEVICE-A");
    api.mockImplementation(async (req: any) => req.url === "admin/enums"
      ? { data: enums }
      : { data: req.params.deviceId === "DEVICE-A" ? [{ topic: topicFor("NEW_BOPIS_ODR"), deviceId: "DEVICE-A" }] : [] });

    await store.fetchNotificationPreferences("NOTIF_BOPIS", "BOPIS", "100410", topicFor);

    const topicReq = api.mock.calls.map(([r]) => r).find((r) => r.url === "firebase/user/notificationtopic");
    expect(topicReq.params).toMatchObject({ topicTypeId: "BOPIS", userId: "100410", deviceId: "DEVICE-A" });
    expect(store.getNotificationPrefs.map((p: any) => [p.enumId, p.isEnabled])).toEqual([["NEW_BOPIS_ODR", true], ["OPEN_BOPIS_ODR", false]]);
  });

  it("fetchAllNotificationPrefs stays cross-device unless a device is named", async () => {
    const store = useNotificationStore();
    store.setFirebaseDeviceId("DEVICE-A");
    api.mockResolvedValue({ data: [] });
    await store.fetchAllNotificationPrefs("BOPIS", "100410");
    expect(lastCall().params).not.toHaveProperty("deviceId");
    await store.fetchAllNotificationPrefs("BOPIS", "100410", "DEVICE-B");
    expect(lastCall().params.deviceId).toBe("DEVICE-B");
  });
});
