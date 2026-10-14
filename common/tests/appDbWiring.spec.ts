import { describe, expect, it } from "vitest";
import { bodyOf, checkDomainWiring, checkSyncLifecycle } from "../db/testing/appDbWiring";
import type { SyncDomain } from "../db/types";

const domain = (name: string, table: string, syncClass: "A" | "B" | "C" = "B", refetchOne = true): SyncDomain => ({
  name,
  table,
  label: name,
  syncClass,
  sync: async () => 0,
  ...(refetchOne ? { refetchOne: async () => 0 } : {}),
});

describe("checkDomainWiring", () => {
  it("passes a database whose every table has a domain", () => {
    expect(checkDomainWiring({ tables: ["a", "b"], domains: [domain("a", "a"), domain("b", "b")] })).toEqual([]);
  });

  it("accepts several domains filling one table", () => {
    expect(checkDomainWiring({ tables: ["a"], domains: [domain("a1", "a"), domain("a2", "a", "A")] })).toEqual([]);
  });

  it("reports a domain whose table the database does not declare", () => {
    expect(checkDomainWiring({ tables: [], domains: [domain("x", "missing")] }))
      .toEqual(['domain "x" fills table "missing", which the database does not declare']);
  });

  it("reports a domain registered twice", () => {
    expect(checkDomainWiring({ tables: ["a"], domains: [domain("a", "a"), domain("a", "a")] }))
      .toEqual(['domain "a" is registered twice']);
  });

  it("reports a table nothing fills", () => {
    expect(checkDomainWiring({ tables: ["a", "orphan"], domains: [domain("a", "a")] }))
      .toEqual(['table "orphan" has no sync domain, so it stays empty']);
  });

  it("reports a class C domain without refetchOne", () => {
    expect(checkDomainWiring({ tables: ["c"], domains: [domain("c", "c", "C", false)] }))
      .toEqual(['class C domain "c" has no refetchOne, so refreshAfterMutation cannot fill it']);
  });

  it("accepts a table filled by another domain or declared unfilled, and keeps those lists honest", () => {
    const domains = [domain("a", "a")];
    expect(checkDomainWiring({ tables: ["a", "side", "dead"], domains, filledBy: { side: "a" }, unfilled: { dead: "unused" } }))
      .toEqual([]);
    expect(checkDomainWiring({ tables: ["a"], domains, filledBy: { a: "nope", gone: "a" }, unfilled: { a: "x" } })).toEqual([
      'filledBy says "nope" fills "a", but no such domain is registered',
      'filledBy lists "a", but a domain already names it as its table',
      'filledBy lists "gone", which the database does not declare',
      'unfilled lists "a", but a domain fills it',
    ]);
  });
});

describe("checkSyncLifecycle", () => {
  const appVue = "watch(useAuth().isAuthenticated, (on) => { if (on) void startAppDbSync() })";
  const store = `actions: {
    async postLogin() {
      await stopAppDbSync().catch(() => {});
      if (ok) { void startAppDbSync(); }
    },
    async postLogout() { await stopAppDbSync(); },
  }`;

  it("passes the wiring every app uses", () => {
    expect(checkSyncLifecycle({ appVue, userStore: store })).toEqual([]);
  });

  it("reports App.vue not starting the sync on authentication", () => {
    expect(checkSyncLifecycle({ appVue: "onMounted(() => {})", userStore: store }))
      .toEqual(["App.vue does not start the sync when isAuthenticated turns true"]);
  });

  it("reports postLogin starting before stopping, and postLogout not stopping", () => {
    const wrong = `async postLogin() { void startAppDbSync(); await stopAppDbSync(); }
      async postLogout() { router.push("/login"); }`;
    expect(checkSyncLifecycle({ appVue, userStore: wrong })).toEqual([
      "postLogin starts the sync before stopping it",
      "postLogout does not stop the sync, so the tables are not cleared",
    ]);
  });

  it("reports a missing postLogin or postLogout", () => {
    expect(checkSyncLifecycle({ appVue, userStore: "actions: {}" }))
      .toEqual(["the user store has no postLogin", "the user store has no postLogout"]);
  });
});

describe("bodyOf", () => {
  it("returns the balanced body of a method, an arrow or a function", () => {
    expect(bodyOf("async postLogin() { if (a) { b() } } other() {}", "postLogin")).toBe(" if (a) { b() } ");
    expect(bodyOf("const postLogout = async (x: any): Promise<void> => { c() }", "postLogout")).toBe(" c() ");
    expect(bodyOf("function postLogin(a, b) { d() }", "postLogin")).toBe(" d() ");
    expect(bodyOf("nothing here", "postLogin")).toBeUndefined();
  });
});
