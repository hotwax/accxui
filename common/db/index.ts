/**
 * @common/db Entry Point.
 */

export * from "./types";
export * from "./syncChannel";
export * from "./projection";
export * from "./baseDb";
export * from "./dbClient";
export * from "./defineEntity";
export * from "./defineSchema";
export * from "./domains/commonSchema";
export * from "./domains/seedDomains";
export * from "./defineAppDb";
export * from "./sync/registerSeedDomains";
export * from "./useDb";
export * from "./useDbStatus";
export * from "./appDbRegistry";
export * from "./useSeedData";
export * from "./sync/syncRegistry";
export * from "./sync/workerFetch";
export * from "./sync/snapshotDomain";
export * from "./sync/cursorDomain";
export * from "./sync/pollingWorkerHarness";
export * from "./sync/pollingTokenChannel";
export * from "./sync/pollingService";
export * from "./sync/appDbBootstrap";

// Both pollingService and syncService export a type named `SyncService`. Until Task 12 deletes
// the former, alias the new module's exports on the way out of the barrel.
export { createSyncService as createSyncServiceV2, serviceState } from "./sync/syncService";
export type { SyncService as SyncServiceV2, SyncServiceOptions as SyncServiceOptionsV2 } from "./sync/syncService";
