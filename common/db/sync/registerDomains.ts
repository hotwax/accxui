import type { SyncDomain } from "../types";
import { registerSyncDomain } from "./syncRegistry";

export function registerDomains(domains: SyncDomain[]): SyncDomain[] {
  return domains.map((domain) => registerSyncDomain(domain));
}
