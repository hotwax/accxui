import type { AppDb } from "./defineAppDb";

let activeAppDb: AppDb | null = null;

export function setAppDb(db: AppDb): void {
  activeAppDb = db;
}

export function getAppDb(): AppDb {
  if (!activeAppDb) {
    throw new Error("[db] No AppDb registered. Ensure defineAppDb has been called.");
  }
  return activeAppDb;
}
