import { describe, expect, it } from "vitest";
import { cookieDomain } from "../helpers/cookieHelper";

describe("cookie deployment scope", () => {
  it.each(["hotwax.io", "inventorycount-uat.hotwax.io"])("preserves shared sessions on %s", (hostname) => {
    expect(cookieDomain(hostname, false)).toBe("; domain=hotwax.io");
  });

  it.each(["inventorycount-uat--qa.web.app", "localhost", "nothotwax.io", "hotwax.io.example.com"])("keeps %s host-only", (hostname) => {
    expect(cookieDomain(hostname, false)).toBe("");
  });

  it("keeps development host-only on a HotWax hostname", () => {
    expect(cookieDomain("test.hotwax.io", true)).toBe("");
  });
});
