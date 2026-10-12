# AccxUI App Worktree Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce AccxUI app worktrees to the app checkouts that actually matter, while preserving user work and avoiding accidental deletion of active branches or symlinked app entries.

**Architecture:** Treat cleanup as an audit-first operation. Subagents independently classify worktrees by cleanup class, return exact evidence and proposed commands, and the coordinator performs final removal only after confirming no dirty files, no unpushed commits, and no needed AccxUI app symlink will be broken.

**Tech Stack:** Git worktrees, zsh/bash shell commands, AccxUI pnpm workspace.

> **Path convention (2026-10-12):** All repository paths are relative to the
> AccxUI root. Run commands from that root. Each app is its own Git checkout
> at `apps/<app>`. This inventory remains the 2026-06-16 snapshot, so Task 2's
> former duplicate-registration premise may no longer apply. Historical
> external worktrees are identified by purpose rather than personal folder
> paths. Resolve their live locations with `git worktree list --porcelain`
> before acting; a missing candidate does not make its parent directory obsolete.

---

## Historical Inventory Snapshot

Generated on 2026-06-16 from the then-current `apps/*` layout. The wrapper and app paths used by the commands below were updated on 2026-10-12; the inventory counts and cleanup signals remain historical.

| App | Worktrees | Cleanup signal |
| --- | ---: | --- |
| `available-to-promise` | 2 | One normal checkout and one detached `apps` registration. Both dirty. |
| `bopis` | 3 | Detached GitHub checkout, detached `apps` registration, and clean temp favicon worktree. |
| `company` | 3 | Main checkout is dirty; two clean temp Codex PR worktrees. |
| `fulfillment` | 4 | Main checkout is dirty; detached `apps` registration; two clean named Codex worktrees. |
| `job-manager` | 3 | Main feature checkout is dirty; two clean temp Codex PR worktrees. |
| `order-manager` | 1 | Keep. Main checkout is dirty. |
| `order-routing` | 2 | Detached checkout is dirty; clean temp favicon worktree. |
| `products` | 1 | Keep. Main checkout has one dirty file. |
| `receiving` | 2 | Branch checkout and detached `apps` registration, both dirty. |
| `returns` | 1 | Keep. Feature checkout is dirty. |
| `shared-transition-demo` | 1 | Local workspace package, not a separate app repo. Keep unless explicitly retired. |

Coordinator rule: do not remove any worktree with dirty files, an unpushed branch, or unclear physical-path identity. Do not remove `apps/<app>` symlinks unless the user explicitly asks, because they are part of the workspace app setup.

## Baseline Commands

Commands assume the current directory is the AccxUI root. For historical
external candidates, set `faviconWorktreeRoot`, `iconWorktreeRoot`,
`permissionsWorktree`, and `cleanupWorktree` only after resolving the exact
locations from the owning app's live Git worktree inventory. These variables
are machine-specific inputs and are deliberately not stored in documentation.

- [ ] **Step 1: Capture the live app worktree inventory**

Run:

```bash
# Run from the AccxUI root.
/bin/bash -lc '
for app in available-to-promise bopis company fulfillment job-manager order-manager order-routing products receiving returns shared-transition-demo; do
  target=$(cd "apps/$app" 2>/dev/null && pwd -P) || continue
  git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1 || continue
  printf "\nAPP %s target=%s\n" "$app" "$target"
  git -C "$target" worktree list --porcelain
done
'
```

Expected: every app listed above appears, and worktree paths match this plan or are explained by recent user changes.

- [ ] **Step 2: Capture branch and dirty state before any cleanup**

Run:

```bash
# Run from the AccxUI root.
/bin/bash -lc '
for app in available-to-promise bopis company fulfillment job-manager order-manager order-routing products receiving returns shared-transition-demo; do
  target=$(cd "apps/$app" 2>/dev/null && pwd -P) || continue
  git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1 || continue
  printf "\nAPP %s target=%s\n" "$app" "$target"
  git -C "$target" worktree list --porcelain | awk '"'"'
    /^worktree /{path=substr($0,10); branch=""; head=""; next}
    /^HEAD /{head=substr($0,6); next}
    /^branch /{branch=substr($0,8); sub("refs/heads/", "", branch); next}
    /^detached$/{branch="DETACHED"; next}
    /^$/ {printf "%s\t%s\t%s\n", path, (branch?branch:"DETACHED"), head; next}
  '"'"' | while IFS=$'\''\t'\'' read -r path branch head; do
    short=$(git -C "$path" status --short 2>/dev/null | wc -l | tr -d " ")
    upstream=$(git -C "$path" rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null || true)
    aheadbehind=$(git -C "$path" rev-list --left-right --count "@{u}...HEAD" 2>/dev/null || true)
    printf "%s [%s] head=%.8s dirty=%s upstream=%s aheadbehind=%s\n" "$path" "$branch" "$head" "$short" "$upstream" "$aheadbehind"
  done
done
'
```

Expected: each worktree has a dirty count, branch or `DETACHED`, and upstream/ahead-behind data where available.

## Task 1: Temp Codex PR Worktrees

**Owner:** Subagent A

**Scope:** Only paths under `${faviconWorktreeRoot}/*` and `${iconWorktreeRoot}/*`.

**Candidate paths from snapshot:**

- `${faviconWorktreeRoot}/bopis`
- `${faviconWorktreeRoot}/company`
- `${iconWorktreeRoot}/company`
- `${faviconWorktreeRoot}/job-manager`
- `${iconWorktreeRoot}/job-manager`
- `${faviconWorktreeRoot}/order-routing`

- [ ] **Step 1: Verify each temp worktree is clean**

Run for each path:

```bash
git -C "${faviconWorktreeRoot}/bopis" status --short
git -C "${faviconWorktreeRoot}/bopis" rev-parse --abbrev-ref HEAD
git -C "${faviconWorktreeRoot}/bopis" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true
git -C "${faviconWorktreeRoot}/bopis" rev-list --left-right --count '@{u}...HEAD' 2>/dev/null || true
```

Expected: `status --short` is empty. If dirty, stop and report the path.

- [ ] **Step 2: Check whether the branch matters**

Run for branch paths that are not plain `main`:

```bash
git -C "${iconWorktreeRoot}/company" branch --show-current
git -C "${iconWorktreeRoot}/company" log --oneline --decorate -5
git -C "${iconWorktreeRoot}/company" branch -vv
```

Expected: identify whether the branch is pushed and already represented remotely. If no upstream exists, report it instead of removing.

- [ ] **Step 3: Return removal candidates**

Return a table with columns:

- path
- branch
- dirty count
- upstream
- ahead/behind
- recommended action: `remove`, `keep`, or `needs-user-confirmation`

Do not delete anything in the subagent unless the coordinator explicitly asks.

## Task 2: Duplicate or Detached `apps/*` Registrations

**Owner:** Subagent B

**Scope:** Worktree entries whose path is under `apps/` and whose app is also symlinked to a top-level checkout.

**Candidate paths from snapshot:**

- `apps/available-to-promise`
- `apps/bopis`
- `apps/fulfillment`
- `apps/receiving`

- [ ] **Step 1: Verify symlink identity before recommending cleanup**

Run:

```bash
# Run from the AccxUI root.
for app in available-to-promise bopis fulfillment receiving; do
  printf "\n%s\n" "$app"
  ls -l "apps/$app"
  printf "logical app path: %s\n" "apps/$app"
  printf "physical app path: "
  (cd "apps/$app" && pwd -P)
  git -C "apps/$app" rev-parse --git-dir --git-common-dir
done
```

Expected: determine whether the `apps/<app>` worktree entry is a real independent checkout, a symlink to the top-level checkout, or stale Git metadata.

- [ ] **Step 2: Check whether `git worktree prune` would remove stale entries**

Run from the top-level app repo for each candidate:

```bash
git -C apps/available-to-promise worktree prune --dry-run --verbose
git -C apps/bopis worktree prune --dry-run --verbose
git -C apps/fulfillment worktree prune --dry-run --verbose
git -C apps/receiving worktree prune --dry-run --verbose
```

Expected: if Git says it would prune entries, report them. If Git does not, do not force removal without coordinator review.

- [ ] **Step 3: Return repair options, not destructive commands**

Return one of:

- `no-op`: the entry is required by current workspace setup
- `prune-safe`: `git worktree prune` dry-run proves the entry is stale
- `repair-needed`: use `git worktree repair` or recreate app symlink after coordinator review
- `manual-review`: the path is dirty or physically ambiguous

## Task 3: Named Codex or Feature Worktrees Outside the Repository

**Owner:** Subagent C

**Scope:** Clean non-temp worktrees that may still represent real branches.

**Candidate paths from snapshot:**

- `${permissionsWorktree}`
- `${cleanupWorktree}`

- [ ] **Step 1: Verify clean and fully pushed**

Run:

```bash
git -C "${permissionsWorktree}" status --short
git -C "${permissionsWorktree}" branch -vv
git -C "${permissionsWorktree}" log --oneline --decorate -10

git -C "${cleanupWorktree}" status --short
git -C "${cleanupWorktree}" branch -vv
git -C "${cleanupWorktree}" log --oneline --decorate -10
```

Expected: both are clean and their branches track remotes with `ahead 0, behind 0`. If they are already merged or obsolete, recommend removal. If they look like active PR branches, recommend keeping until PR status is checked.

- [ ] **Step 2: Return branch disposition**

Return:

- path
- branch
- upstream
- clean or dirty
- likely purpose from recent commit messages
- recommended action

## Task 4: Real Working App Checkouts

**Owner:** Subagent D

**Scope:** Main app checkouts with dirty files or app branches. These are probably the worktrees that matter.

**Candidate paths from snapshot:**

- `apps/available-to-promise`
- `apps/bopis`
- `apps/company`
- `apps/fulfillment`
- `apps/job-manager`
- `apps/order-manager`
- `apps/order-routing`
- `apps/products`
- `apps/receiving`
- `apps/returns`

- [ ] **Step 1: Summarize uncommitted work without modifying it**

Run for each path:

```bash
git -C apps/job-manager status --short --branch
git -C apps/job-manager diff --stat
```

Expected: produce a short human-readable summary of dirty files and branch purpose. Do not run formatters, installs, or builds.

- [ ] **Step 2: Classify each checkout**

Use these labels:

- `keep-active`: dirty files or named feature branch that looks deliberate
- `keep-main`: clean or lightly dirty main checkout that is canonical for the app
- `needs-user-review`: detached branch, ambiguous purpose, or dirty state that could be stale
- `cleanup-after-save`: obvious generated files or stale branch, but only after user confirms whether to stash, commit, or discard

Expected: the coordinator gets a list of worktrees that should remain after cleanup.

## Coordinator Execution

- [ ] **Step 1: Merge subagent reports into a final cleanup table**

Create four sections:

- remove now
- remove after PR/remote check
- keep
- ask user

Expected: no path appears in more than one section.

- [ ] **Step 2: Show final removal commands before running them**

For safe removals, use `git worktree remove` from the owning repo, not `rm -rf`.

Example:

```bash
git -C apps/company worktree remove "${faviconWorktreeRoot}/company"
git -C apps/company worktree remove "${iconWorktreeRoot}/company"
```

Expected: user or coordinator confirms commands are limited to clean, irrelevant worktrees.

- [ ] **Step 3: Remove safe worktrees**

Run only commands approved in Step 2. If Git refuses because of dirty files or branch state, stop and report.

- [ ] **Step 4: Prune stale worktree metadata**

Run:

```bash
for repo in available-to-promise bopis company fulfillment job-manager order-routing receiving; do
  git -C "apps/$repo" worktree prune --verbose
done
```

Expected: Git removes stale administrative entries only.

- [ ] **Step 5: Verify the final count**

Run:

```bash
# Run from the AccxUI root.
for app in available-to-promise bopis company fulfillment job-manager order-manager order-routing products receiving returns shared-transition-demo; do
  target=$(cd "apps/$app" 2>/dev/null && pwd -P) || continue
  git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1 || continue
  count=$(git -C "$target" worktree list --porcelain | awk 'BEGIN{c=0} /^worktree /{c++} END{print c}')
  printf "%s\t%s\n" "$count" "$app"
done | sort -k2
```

Expected target outcome: temp PR worktrees removed; real active checkouts retained; ambiguous dirty/detached paths listed for user decision.

## Expected Keep Set

Keep by default:

- `apps/available-to-promise`
- `apps/bopis`
- `apps/company`
- `apps/fulfillment`
- `apps/job-manager`
- `apps/order-manager`
- `apps/order-routing`
- `apps/products`
- `apps/receiving`
- `apps/returns`
- `apps/shared-transition-demo`

Likely cleanup after verification:

- `${faviconWorktreeRoot}/bopis`
- `${faviconWorktreeRoot}/company`
- `${iconWorktreeRoot}/company`
- `${faviconWorktreeRoot}/job-manager`
- `${iconWorktreeRoot}/job-manager`
- `${faviconWorktreeRoot}/order-routing`

Requires careful review before removal:

- `apps/available-to-promise`
- `apps/bopis`
- `apps/fulfillment`
- `apps/receiving`
- `${permissionsWorktree}`
- `${cleanupWorktree}`

## Safety Gates

- Never use `rm -rf` for Git worktree cleanup.
- Never remove dirty worktrees.
- Never remove a worktree with commits ahead of upstream.
- Never remove `apps/<app>` symlinks as part of worktree metadata cleanup.
- Treat detached worktrees as user-owned until their physical path, dirty state, and branch provenance are understood.
- After cleanup, confirm `pnpm-workspace.yaml` still resolves the app packages from `./`.
