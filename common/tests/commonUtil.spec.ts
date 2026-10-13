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

describe("commonUtil.getErrorMessage", () => {
  const msg = (e: any, f?: string) => commonUtil.getErrorMessage(e, f);

  it("reads OFBiz string and list errors", () => {
    expect(msg({ response: { data: { _ERROR_MESSAGE_: "Bad item" } } })).toBe("Bad item");
    expect(msg({ response: { data: { _ERROR_MESSAGE_LIST_: ["first error", "second error"] } } })).toBe("first error, second error");
  });

  it("reads Moqui string and array errors", () => {
    expect(msg({ response: { data: { errors: "No access" } } })).toBe("No access");
    expect(msg({ response: { data: { errors: ["x", "y"] } } })).toBe("x, y");
  });

  it("reads errorMessage and error properties", () => {
    expect(msg({ response: { data: { errorMessage: "Service failed" } } })).toBe("Service failed");
    expect(msg({ response: { data: { error: "Custom error" } } })).toBe("Custom error");
  });

  it("reads plain string response data", () => {
    expect(msg({ response: { data: "Service Unavailable" } })).toBe("Service Unavailable");
    expect(msg("Direct error string")).toBe("Direct error string");
  });

  it("ignores empty and whitespace-only bodies and falls back to error.message", () => {
    expect(msg({ response: { data: "  " }, message: "Network Error" })).toBe("Network Error");
    expect(msg({ response: { data: "" }, message: "Connection timeout" })).toBe("Connection timeout");
  });

  it("ignores HTML bodies from gateway/proxy error pages", () => {
    expect(msg({ response: { data: "<html><body>502 Bad Gateway</body></html>" } }, "Gateway fallback")).toBe("Gateway fallback");
    expect(msg({ response: { data: "  <!DOCTYPE html><html>504</html>" } }, "Timeout fallback")).toBe("Timeout fallback");
  });

  it("handles an already-unwrapped response object", () => {
    expect(msg({ data: { _ERROR_MESSAGE_: "From resp" } })).toBe("From resp");
    expect(msg({ data: { errors: "From Moqui resp" } })).toBe("From Moqui resp");
  });

  it("uses the provided fallback when no message is extractable", () => {
    expect(msg({}, "Custom fallback")).toBe("Custom fallback");
    expect(msg({ response: {} }, "Custom fallback")).toBe("Custom fallback");
    expect(msg(null, "Fallback")).toBe("Fallback");
    expect(msg(undefined)).toBe("");
  });
});
