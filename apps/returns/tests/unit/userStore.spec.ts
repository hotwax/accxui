import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@common", () => ({
  api: vi.fn(),
  commonUtil: { getMaargURL: () => "", getOmsURL: () => "", hasError: () => false },
  logger: { error: vi.fn() },
  useAuth: () => ({ updateUserId: vi.fn() }),
}));
vi.mock("@/util/maargAuth", () => ({ maargApiKey: () => "TEST_KEY" }));

import { api } from "@common";
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

describe("userStore.fetchUserProfile", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(api).mockReset();
  });

  // Regression: this Moqui build authenticates only via the api_key header; a bare profile call 403s.
  it("attaches the api_key header to the profile call", async () => {
    vi.mocked(api).mockResolvedValue({ data: { userId: "u1" } } as any);
    const store = useUserStore();
    await store.fetchUserProfile();
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({ url: "admin/user/profile", headers: { api_key: "TEST_KEY" } }),
    );
  });
});
