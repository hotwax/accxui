// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createDxpI18n, translate } from "../core/i18n";

describe("i18n translate", () => {
  createDxpI18n({
    "en-US": {
      "Welcome, {name}!": "Welcome, {name}!",
      "Simple label": "Translated Label",
      "Failed to login. {error}": "Failed to login. {error}"
    }
  });

  it("translates existing keys using vue-i18n", () => {
    expect(translate("Simple label")).toBe("Translated Label");
    expect(translate("Welcome, {name}!", { name: "John" })).toBe("Welcome, John!");
  });

  it("does not re-interpolate brace tokens in param values when key exists", () => {
    expect(translate("Failed to login. {error}", { error: "Invalid {error}" })).toBe(
      "Failed to login. Invalid {error}"
    );
  });

  it("interpolates params on missing keys as a fallback without double-interpolating", () => {
    expect(translate("Failed to login. {error}", { error: "Bad credentials" })).toBe(
      "Failed to login. Bad credentials"
    );
    expect(translate("Missing key: {error}", { error: "Invalid {error}" })).toBe(
      "Missing key: Invalid {error}"
    );
  });

  it("leaves missing keys unchanged when no params are provided", () => {
    expect(translate("Some unconfigured key")).toBe("Some unconfigured key");
  });

  it("safely handles special characters like $, $&, $1, and braces in params", () => {
    expect(translate("Charge amount: {error}", { error: "$100.00 failed" })).toBe(
      "Charge amount: $100.00 failed"
    );
    expect(translate("Regex replacement symbols: {error}", { error: "Tokens $& and $1 and $`" })).toBe(
      "Regex replacement symbols: Tokens $& and $1 and $`"
    );
    expect(translate("Error detail: {error}", { error: "unexpected {token}" })).toBe(
      "Error detail: unexpected {token}"
    );
  });

  it("interpolates indexed array params", () => {
    expect(translate("Items: {0} and {1}", ["apple", "banana"])).toBe("Items: apple and banana");
  });
});
