// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { commonUtil } from "./commonUtil";

describe("commonUtil local instance URLs", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_OMS_TYPE", "MOQUI");

    for (const cookie of document.cookie.split(";")) {
      document.cookie = `${cookie.split("=")[0].trim()}=; path=/; max-age=0`;
    }
  });

  it("treats host-port localhost OMS values as local Moqui REST URLs", () => {
    document.cookie = "oms=localhost:8080; path=/";

    expect(commonUtil.getOmsURL()).toBe("http://localhost:8080/rest/s1/");
  });

  it("preserves local host-port values for the OMS login input", () => {
    document.cookie = "oms=http://localhost:8080; path=/";

    expect(commonUtil.getOMSInstanceName()).toBe("localhost:8080");
  });

  it("treats host-port localhost maarg values as local Moqui REST URLs", () => {
    document.cookie = "maarg=localhost:8080; path=/";

    expect(commonUtil.getMaargURL()).toBe("http://localhost:8080/rest/s1/");
  });

  it("keeps normal HotWax aliases on the hosted domain", () => {
    document.cookie = "oms=demo; path=/";

    expect(commonUtil.getOmsURL()).toBe("https://demo.hotwax.io/rest/s1/");
  });
});
