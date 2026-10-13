// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createDxpI18n, translate } from "../core/i18n";

describe("i18n translate", () => {
  createDxpI18n({
    "en-US": {
      "Welcome, {name}!": "Welcome, {name}!",
      "Simple label": "Translated Label"
    }
  });

  it("translates existing keys using vue-i18n", () => {
    expect(translate("Simple label")).toBe("Translated Label");
    expect(translate("Welcome, {name}!", { name: "John" })).toBe("Welcome, John!");
  });

  it("interpolates params on missing keys as a fallback", () => {
    expect(translate("Failed to login. {error}", { error: "Bad credentials" })).toBe(
      "Failed to login. Bad credentials"
    );
  });

  it("leaves missing keys unchanged when no params are provided", () => {
    expect(translate("Some unconfigured key")).toBe("Some unconfigured key");
  });

  it("safely handles special characters like $ and braces in params", () => {
    expect(translate("Charge amount: {error}", { error: "$100.00 failed" })).toBe(
      "Charge amount: $100.00 failed"
    );
    expect(translate("Error detail: {error}", { error: "unexpected {token}" })).toBe(
      "Error detail: unexpected {token}"
    );
  });

  it("interpolates indexed array params", () => {
    expect(translate("Items: {0} and {1}", ["apple", "banana"])).toBe("Items: apple and banana");
  });
});
