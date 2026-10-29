import { afterEach, describe, expect, it, vi } from "vitest";
import { cookieHelper } from "../helpers/cookieHelper";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("cookie deployment scope", () => {
  it.each(["hotwax.io", "inventorycount-uat.hotwax.io"])("preserves shared sessions on %s", (hostname) => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", { location: { hostname } });
    vi.stubGlobal("document", { cookie: "" });
    cookieHelper().set("oms", "sandbox", 60);
    expect(document.cookie).toContain("; domain=hotwax.io");
    expect(document.cookie).toContain("; max-age=60");
  });

  it.each(["inventorycount-uat--qa.web.app", "localhost", "nothotwax.io", "hotwax.io.example.com"])("keeps %s host-only", (hostname) => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", { location: { hostname } });
    vi.stubGlobal("document", { cookie: "" });
    cookieHelper().set("oms", "sandbox");
    expect(document.cookie).not.toContain("domain=");
    expect(cookieHelper().get("oms")).toBe("sandbox");
  });

  it("keeps development host-only on a HotWax hostname", () => {
    vi.stubEnv("DEV", true);
    vi.stubGlobal("window", { location: { hostname: "test.hotwax.io" } });
    vi.stubGlobal("document", { cookie: "" });
    cookieHelper().set("oms", "sandbox");
    expect(document.cookie).not.toContain("domain=");
  });
});
