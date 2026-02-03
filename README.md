## 🚀 Getting Started

### 1. Install dependencies

Install all dependencies for every app and package in the workspace:

```bash
pnpm install

# build the launchpad app
pnpm --filter launchpad build

# Start launchpad app
pnpm --filter launchpad dev

# Build fulfillment app
pnpm --filter fulfillment build

# Start fulfillment app
pnpm --filter fulfillment dev

#Start all the apps
pnpm -r dev
