import { existsSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { commonEnvPlugin } from "../vite/commonEnvPlugin";

const runConfig = (root: string, command: "build" | "serve") =>
  (commonEnvPlugin().config as any)({ root }, { command, mode: "production" });

describe("commonEnvPlugin luxon alias", () => {
  const accxuiRoot = path.resolve(__dirname, "../..");

  it("points bare luxon at its ES build on vite build", () => {
    const [alias] = runConfig(accxuiRoot, "build").resolve.alias;

    expect(alias.replacement.endsWith(path.join("luxon", "build", "es6", "luxon.mjs"))).toBe(true);
    expect(existsSync(alias.replacement)).toBe(true);
    expect(alias.find.test("luxon")).toBe(true);
    expect(alias.find.test("luxon/package.json")).toBe(false);
  });
});
