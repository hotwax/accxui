import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@common", () => ({
  api: vi.fn(),
  commonUtil: { getMaargURL: () => "", getOmsURL: () => "", hasError: () => false },
  logger: { error: vi.fn() },
  useAuth: () => ({ updateUserId: vi.fn() }),
}));

import { useUserStore } from "@/store/userStore";

describe("userStore.hasPermission", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("returns false when the permission is not granted", () => {
    const store = useUserStore();
    store.permissions = ["APP_RETURNS_VIEW"];
    expect(store.hasPermission("APP_RETURNS_ADMIN")).toBe(false);
  });

  it("returns true when the permission is granted", () => {
    const store = useUserStore();
    store.permissions = ["APP_RETURNS_VIEW"];
    expect(store.hasPermission("APP_RETURNS_VIEW")).toBe(true);
  });
});
