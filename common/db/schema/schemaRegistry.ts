/**
 * Framework-internal: every module's tables merged into one schema, for the framework's own checks
 * (its specs compare it with the domain registry). Apps never import this; they pick from the module
 * they use (`./commonSchema`, and any further module) and merge with `mergeSchemas`, so a new module
 * changes nothing for an app that does not take it. Lint rejects an import of this file from `src/`.
 *
 * Every module schema is declared with `{ framework: true }`, so its tables keep their framework
 * provenance through `pick` and `mergeSchemas`; `mergeSchemas` throws when two modules declare the
 * same table.
 *
 * Worker-safe: imports only schema modules, which import nothing that pulls in `vue`.
 */

import { mergeSchemas } from "../model/defineSchema";
import { commonSchema } from "./commonSchema";

export const schemaRegistry = mergeSchemas(commonSchema);
