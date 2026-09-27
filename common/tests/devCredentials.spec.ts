import { describe, expect, it } from "vitest";
import { getDevCredentialsFor, hasAnyDevCredentials, hasDevCredentialsFor } from "../utils/devCredentials";

// The env is passed in explicitly: Vite inlines import.meta.env at transform
// time, so it cannot be stubbed, and a test that read it would depend on
// whatever the developer has configured locally.
const ALIAS = JSON.stringify({
  local: "http://localhost:8080",
  "rails-oms": "https://rails-oms.hotwax.io"
});

const CREDENTIALS = JSON.stringify({
  local: { username: "local-user", password: "local-pass" },
  "rails-oms": { username: "oms-user", password: "oms-pass" }
});

const env = (values: Record<string, any> = {}) => ({
  DEV: true,
  VITE_ALIAS: ALIAS,
  VITE_DEV_CREDENTIALS: CREDENTIALS,
  ...values
});

describe("getDevCredentialsFor", () => {
  it("gives each server its own credentials", () => {
    expect(getDevCredentialsFor("local", env())?.password).toBe("local-pass");
    expect(getDevCredentialsFor("rails-oms", env())?.password).toBe("oms-pass");
  });

  it("matches a URL against a label-keyed entry", () => {
    expect(getDevCredentialsFor("https://rails-oms.hotwax.io", env())?.username).toBe("oms-user");
    expect(getDevCredentialsFor("https://rails-oms.hotwax.io/", env())?.username).toBe("oms-user");
    expect(getDevCredentialsFor("http://localhost:8080", env())?.username).toBe("local-user");
  });

  it("matches a label against a URL-keyed entry", () => {
    const e = env({
      VITE_DEV_CREDENTIALS: JSON.stringify({
        "https://rails-oms.hotwax.io": { username: "oms-user", password: "oms-pass" }
      })
    });

    expect(getDevCredentialsFor("rails-oms", e)?.username).toBe("oms-user");
  });

  it("fails closed when a label-keyed entry's label is absent from the app's VITE_ALIAS", () => {
    // Matching a URL to a label-keyed entry goes through the app's own
    // VITE_ALIAS. An app that does not offer that server therefore cannot
    // auto-login to it, which is the safe direction.
    const e = env({ VITE_ALIAS: JSON.stringify({ local: "http://localhost:8080" }) });

    expect(getDevCredentialsFor("https://rails-oms.hotwax.io", e)).toBeNull();
    expect(getDevCredentialsFor("rails-oms", e)?.username).toBe("oms-user");
  });

  it("returns nothing for a server with no entry and no flat pair", () => {
    expect(getDevCredentialsFor("https://someone-else.hotwax.io", env())).toBeNull();
    expect(hasDevCredentialsFor("https://someone-else.hotwax.io", env())).toBe(false);
  });

  it("never sends one server's credentials to another", () => {
    const local = getDevCredentialsFor("local", env());
    const railsOms = getDevCredentialsFor("rails-oms", env());

    expect(local?.password).not.toBe(railsOms?.password);
  });

  it("falls back to the legacy flat pair only when a server has no entry", () => {
    const e = env({ VITE_DEV_USERNAME: "flat-user", VITE_DEV_PASSWORD: "flat-pass" });

    expect(getDevCredentialsFor("rails-oms", e)?.username).toBe("oms-user");
    expect(getDevCredentialsFor("https://anything.hotwax.io", e)?.username).toBe("flat-user");
  });

  it("prefers VITE_DEV_* over the older VITE_USERNAME pair", () => {
    const e = env({
      VITE_DEV_CREDENTIALS: "",
      VITE_DEV_USERNAME: "new-user",
      VITE_DEV_PASSWORD: "new-pass",
      VITE_USERNAME: "old-user",
      VITE_PASSWORD: "old-pass"
    });

    expect(getDevCredentialsFor("http://localhost:8080", e)?.username).toBe("new-user");
  });

  it("ignores an incomplete entry rather than half-filling it", () => {
    const e = env({ VITE_DEV_CREDENTIALS: JSON.stringify({ local: { username: "only-user" } }) });

    expect(getDevCredentialsFor("local", e)).toBeNull();
  });

  it("survives malformed JSON without throwing", () => {
    const e = env({ VITE_DEV_CREDENTIALS: "{not json", VITE_ALIAS: "{also not json" });

    expect(() => getDevCredentialsFor("local", e)).not.toThrow();
    expect(getDevCredentialsFor("local", e)).toBeNull();
  });
});

describe("hasAnyDevCredentials", () => {
  it("is true when any server has an entry", () => {
    expect(hasAnyDevCredentials(env())).toBe(true);
  });

  it("is false when nothing is configured", () => {
    expect(hasAnyDevCredentials({ DEV: true })).toBe(false);
  });

  it("is false outside dev even when configured", () => {
    expect(hasAnyDevCredentials(env({ DEV: false }))).toBe(false);
    expect(hasDevCredentialsFor("local", env({ DEV: false }))).toBe(false);
  });
});
