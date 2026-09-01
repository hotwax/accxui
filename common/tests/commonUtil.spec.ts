// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { commonUtil } from "../utils/commonUtil";

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

describe("commonUtil.isValidVersion", () => {
  it("accepts well-formed semantic versions", () => {
    expect(commonUtil.isValidVersion("1.0.0")).toBe(true);
    expect(commonUtil.isValidVersion("0.1.0")).toBe(true);
    expect(commonUtil.isValidVersion("10.20.30")).toBe(true);
    expect(commonUtil.isValidVersion(" 2.3.4 ")).toBe(true); // trims surrounding whitespace
    expect(commonUtil.isValidVersion("v1.0.0")).toBe(true); // optional v prefix
    expect(commonUtil.isValidVersion("V2.3.4")).toBe(true); // optional uppercase V prefix
    expect(commonUtil.isValidVersion("1.0.0-alpha.1")).toBe(true); // prerelease
    expect(commonUtil.isValidVersion("1.0.0+build.5")).toBe(true); // build metadata
    expect(commonUtil.isValidVersion("v1.2.3-rc.1+build.5")).toBe(true); // prefix + prerelease + build
  });

  it("rejects malformed or non-string values", () => {
    expect(commonUtil.isValidVersion("1.0")).toBe(false);
    expect(commonUtil.isValidVersion("version1.0.0")).toBe(false);
    expect(commonUtil.isValidVersion("vv1.0.0")).toBe(false);
    expect(commonUtil.isValidVersion("1.0.0.0")).toBe(false);
    expect(commonUtil.isValidVersion("01.0.0")).toBe(false); // no leading zeros
    expect(commonUtil.isValidVersion("1.0.x")).toBe(false);
    expect(commonUtil.isValidVersion("")).toBe(false);
    expect(commonUtil.isValidVersion(100 as any)).toBe(false);
    expect(commonUtil.isValidVersion(null as any)).toBe(false);
  });
});

describe("commonUtil.isVersionGreaterOrEqual", () => {
  it("returns true when the second version is greater than the first", () => {
    expect(commonUtil.isVersionGreaterOrEqual("1.0.0", "1.0.1")).toBe(true);
    expect(commonUtil.isVersionGreaterOrEqual("1.0.0", "1.1.0")).toBe(true);
    expect(commonUtil.isVersionGreaterOrEqual("1.9.0", "2.0.0")).toBe(true);
    expect(commonUtil.isVersionGreaterOrEqual("2.3.9", "2.3.10")).toBe(true); // numeric, not lexical
  });

  it("returns true when the versions are equal", () => {
    expect(commonUtil.isVersionGreaterOrEqual("1.0.0", "1.0.0")).toBe(true);
    expect(commonUtil.isVersionGreaterOrEqual("2.3.4", "2.3.4")).toBe(true);
  });

  it("returns false when the second version is lower", () => {
    expect(commonUtil.isVersionGreaterOrEqual("1.0.1", "1.0.0")).toBe(false);
    expect(commonUtil.isVersionGreaterOrEqual("2.0.0", "1.9.9")).toBe(false);
    expect(commonUtil.isVersionGreaterOrEqual("1.1.0", "1.0.9")).toBe(false);
  });

  it("handles the optional v/V prefix on either argument", () => {
    expect(commonUtil.isVersionGreaterOrEqual("v1.0.0", "v1.0.1")).toBe(true);
    expect(commonUtil.isVersionGreaterOrEqual("1.0.0", "v1.0.1")).toBe(true); // mixed prefix
    expect(commonUtil.isVersionGreaterOrEqual("V1.2.0", "1.2.0")).toBe(true); // equal ignoring prefix
  });

  it("strips prerelease/build metadata before comparing core versions", () => {
    // "1.0.1-rc1" must not leave "1-rc1" as the patch (which would be NaN)
    expect(commonUtil.isVersionGreaterOrEqual("1.0.0", "1.0.1-rc1")).toBe(true);
    expect(commonUtil.isVersionGreaterOrEqual("1.0.1-rc1", "1.0.0")).toBe(false);
    expect(commonUtil.isVersionGreaterOrEqual("1.0.0-alpha", "1.0.0")).toBe(true); // core equal → true
    expect(commonUtil.isVersionGreaterOrEqual("1.0.0", "1.0.0-rc.1")).toBe(true); // core equal → true
    expect(commonUtil.isVersionGreaterOrEqual("1.0.0+build.1", "1.0.0+build.9")).toBe(true); // build ignored, equal
  });

  it("returns false when either argument is not a valid version", () => {
    expect(commonUtil.isVersionGreaterOrEqual("1.0", "1.0.1")).toBe(false);
    expect(commonUtil.isVersionGreaterOrEqual("1.0.0", "not-a-version")).toBe(false);
    expect(commonUtil.isVersionGreaterOrEqual(undefined as any, "1.0.0")).toBe(false);
  });
});
