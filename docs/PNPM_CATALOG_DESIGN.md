# Design Document: PNPM Catalog for Workspace Dependencies

This document outlines the adoption of the pnpm catalog feature to manage dependencies consistently across multiple applications in the AccxUI workspace.

---

## 1. Overview
### 1.1 Objective
Adopt the pnpm `catalog:` feature to centralize and manage shared dependency versions across all applications within the monorepo workspace.

### 1.2 Problem Statement
With multiple apps residing in the `apps/` directory, maintaining consistent versions for shared dependencies (such as `vue`, `pinia`, `@ionic/vue`, `@capacitor/*`) across each app's `package.json` is tedious and error-prone. Inconsistent dependency versions can lead to duplicated packages in the lockfile, obscure runtime bugs, and complex upgrade paths.

### 1.3 Success Criteria
- **Single Source of Truth:** All shared dependency versions are defined centrally.
- **Consistency:** Apps inherently use the identical versions of shared libraries unless explicitly overridden.
- **Simplified Maintenance:** Upgrading a core framework like Vue or Ionic requires changes in only one place.

## 2. Scope
### 2.1 In Scope
- Configuring the pnpm workspace with a centralized catalog of dependencies.
- Migrating `package.json` files within `apps/*` (e.g., `job-manager`) to use the `catalog:` protocol for shared libraries.
- Establishing standard practices for how developers should add or update dependencies moving forward.

### 2.2 Out of Scope
- Migrating backend services or non-frontend packages that don't share the same UI/Core dependencies.

## 3. Background / Context
Currently, the AccxUI ecosystem utilizes a pnpm workspace to house multiple applications. Each app specifies its own dependency versions. When a shared package (e.g., `@ionic/vue`) receives an update, a developer must traverse every app's `package.json` to ensure the version is synced up manually, creating a brittle and repetitive process.

By utilizing the newly introduced pnpm catalogs feature, we can leverage native package manager support for shared versioning without resorting to external sync scripts or manual upkeep.

## 4. Proposed Solution
### 4.1 High-Level Design
We will define our shared dependencies natively inside our central configuration (either a dedicated `pnpm-workspace.yaml` `catalogs` entry or via standard pnpm implementation protocols for catalogs).

### 4.2 How to use the Catalog in Apps
To effectively utilize the catalog within any application in the `apps/` folder, follow these steps:

#### Step 1: Define the dependency in the centralized catalog
Dependency versions are maintained globally. When you need to update or add a widespread dependency, you add it to the `catalogs` block in the workspace root configuration (`pnpm-workspace.yaml`):

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'

catalogs:
  default:
    vue: "^3.5.22"
    pinia: "^2.1.7"
    "@ionic/vue": "^8.0.0"
```

#### Step 2: Reference the catalog in your App
Within your specific app (e.g., `apps/job-manager/package.json`), replace the explicit semantic version snippet with the exact string `"catalog:"`.

```json
{
  "name": "job-manager",
  "dependencies": {
    "vue": "catalog:",
    "pinia": "catalog:",
    "@ionic/vue": "catalog:"
  }
}
```

#### Step 3: Install
Run the standard install command from the root or workspace. pnpm will automatically substitute `"catalog:"` with the version declared in the workspace configuration during resolution.

```bash
pnpm install
```

### 4.3 Pseudocode / Logic Flow (Dependency Resolution)
1. pnpm reads `apps/job-manager/package.json` during install.
2. It encounters `"vue": "catalog:"`.
3. It looks up the `vue` version in the closest `pnpm-workspace.yaml` under the default catalog.
4. It resolves to local hoisted packages and creates symlinks using the central version configuration constraints.

### 4.4 Alternatives Considered
- **Root-level hoisting only:** Leaves `package.json` files in apps empty of actual metadata. Makes individual apps harder to treat as independent modules if externalizing. Rejected because `catalog:` maintains clear app-level dependency manifests natively.

## 5. Security & Permissions
- N/A. Dependencies remain standard npm packages. Ensure rigorous auditing (`pnpm audit`) of the central catalog.

## 6. Verification Plan
- Run `pnpm install` - Ensure no catalog resolution errors occur.
- Inspect `pnpm-lock.yaml` - Confirm that shared dependencies like `vue` are resolving identically and no duplicate versions are bundled.
- App boot tests - Build and serve `job-manager` and other apps to ensure runtime resolution correctly picks up synced packages.

## 7. Rollout Plan
1. **Workspace Configuration:** Update `pnpm-workspace.yaml` with the definitive list of shared dependencies and their current agreed-upon versions.
2. **App Migration:** Update all `apps/*/package.json` files to replace hardcoded versions of those specific libraries with `"catalog:"`.
3. **Lockfile Generation:** Run `pnpm install` at root to regenerate the unified `pnpm-lock.yaml`.
4. **Validation:** Ensure all unit tests and builds pass.

## 8. Risks & Mitigation
- **Risk:** Some legacy apps might break if forced onto a newer version of a shared library.
- **Mitigation:** If an app requires a disparate version, pnpm catalogs permit named catalogs (e.g., `legacy-vue`), or the app can retain its explicit version string in its `package.json`. Explicit versions in an app override the workspace catalog.

## 9. References
- [pnpm workspace catalogs documentation](https://pnpm.io/catalogs)
