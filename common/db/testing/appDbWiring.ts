/**
 * Wiring checks every app runs from its own test suite. Lint sees one line at a time; these see how
 * an app's database, sync domains and login lifecycle fit together — the mistakes that otherwise
 * show up only as a table that never fills or a lookup that fails at runtime.
 *
 * Each check returns a list of problems instead of throwing, so a spec asserts
 * `expect(problems).toEqual([])` and a failure lists every problem at once.
 *
 * Test-only: nothing in an app's `src/` imports this.
 */

import type { SyncDomain } from "../types";

export interface DomainWiringInput {
  /** The app database's table names: `Object.keys(appDb.tables)`. */
  tables: readonly string[];
  /** Exactly what the worker registers: `appSyncDomains`. */
  domains: readonly SyncDomain[];
  /**
   * Tables a domain fills besides its own `table` (one sync writing several tables): table → that
   * domain's name.
   */
  filledBy?: Record<string, string>;
  /** Tables declared but filled by nothing on purpose, each with the reason. Prefer removing them. */
  unfilled?: Record<string, string>;
}

/**
 * - every registered domain's `table` exists in the database (otherwise its writes throw in the worker);
 * - no two registered domains share a name (the registry keeps one, the other never runs);
 * - every table is filled by some domain, or is declared in `filledBy` / `unfilled`;
 * - every class C domain has a `refetchOne` (`refreshRecord` and `refreshAfterMutation` call it);
 * - `filledBy` and `unfilled` stay true: listed tables exist, and a `filledBy` domain is registered.
 */
export function checkDomainWiring({ tables, domains, filledBy = {}, unfilled = {} }: DomainWiringInput): string[] {
  const problems: string[] = [];
  const tableSet = new Set(tables);
  const names = new Set<string>();
  const filledTables = new Set<string>();

  for (const domain of domains) {
    if (names.has(domain.name)) problems.push(`domain "${domain.name}" is registered twice`);
    names.add(domain.name);
    if (domain.table) {
      filledTables.add(domain.table);
      if (!tableSet.has(domain.table)) {
        problems.push(`domain "${domain.name}" fills table "${domain.table}", which the database does not declare`);
      }
    }
    if (domain.syncClass === "C" && !domain.refetchOne) {
      problems.push(`class C domain "${domain.name}" has no refetchOne, so refreshRecord cannot fill it`);
    }
  }

  for (const [table, domainName] of Object.entries(filledBy)) {
    if (!tableSet.has(table)) problems.push(`filledBy lists "${table}", which the database does not declare`);
    if (!names.has(domainName)) problems.push(`filledBy says "${domainName}" fills "${table}", but no such domain is registered`);
    if (filledTables.has(table)) problems.push(`filledBy lists "${table}", but a domain already names it as its table`);
  }
  for (const table of Object.keys(unfilled)) {
    if (!tableSet.has(table)) problems.push(`unfilled lists "${table}", which the database does not declare`);
    if (filledTables.has(table) || table in filledBy) problems.push(`unfilled lists "${table}", but a domain fills it`);
  }

  for (const table of tables) {
    if (!filledTables.has(table) && !(table in filledBy) && !(table in unfilled)) {
      problems.push(`table "${table}" has no sync domain, so it stays empty`);
    }
  }

  return problems;
}

/** The body of the first method or function named `name` in `source`, or undefined. */
export function bodyOf(source: string, name: string): string | undefined {
  const head = new RegExp(`\\b${name}\\s*(?:=\\s*(?:async\\s*)?)?\\([^)]*\\)\\s*(?::[^{]+)?(?:=>\\s*)?\\{`).exec(source);
  if (!head) return undefined;
  let depth = 0;
  for (let i = head.index + head[0].length - 1; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(head.index + head[0].length, i);
  }
  return undefined;
}

export interface SyncLifecycleInput {
  /** Source of `src/App.vue`. */
  appVue: string;
  /** Source of the store that holds `postLogin` / `postLogout` (`src/store/user.ts`). */
  userStore: string;
}

/**
 * - `App.vue` starts the sync when `isAuthenticated` turns true (a reload restores the session
 *   without going through `postLogin`);
 * - `postLogin` stops the sync (clearing the previous session's tables) before it starts it;
 * - `postLogout` stops it, which clears the tables.
 */
export function checkSyncLifecycle({ appVue, userStore }: SyncLifecycleInput): string[] {
  const problems: string[] = [];

  if (!/isAuthenticated/.test(appVue) || !/startAppDbSync\s*\(/.test(appVue)) {
    problems.push("App.vue does not start the sync when isAuthenticated turns true");
  }

  const postLogin = bodyOf(userStore, "postLogin");
  if (postLogin === undefined) {
    problems.push("the user store has no postLogin");
  } else {
    const stop = postLogin.search(/stopAppDbSync\s*\(/);
    const start = postLogin.search(/startAppDbSync\s*\(/);
    if (stop < 0) problems.push("postLogin does not stop the sync, so the previous session's rows survive");
    if (start < 0) problems.push("postLogin does not start the sync");
    if (stop >= 0 && start >= 0 && start < stop) problems.push("postLogin starts the sync before stopping it");
  }

  const postLogout = bodyOf(userStore, "postLogout");
  if (postLogout === undefined) {
    problems.push("the user store has no postLogout");
  } else if (!/stopAppDbSync\s*\(/.test(postLogout)) {
    problems.push("postLogout does not stop the sync, so the tables are not cleared");
  }

  return problems;
}
