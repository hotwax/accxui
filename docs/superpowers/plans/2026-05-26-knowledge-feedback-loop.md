# Knowledge Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conversation-level feedback loop to Circuit. A header button in the chat opens a modal where the user types what *should* have happened; the current thread is sent automatically. A new circuit-side feedback agent proposes structured edits to `hotwax_order_routing_domain_knowledge.yaml`, the server applies them with comment-preserving YAML AST edits, validates the result, and git-commits the change. The PWA modal shows the resulting commit short SHA or a stage-tagged error.

**Architecture:** Two new surfaces. PWA: one service file, one modal component, and one header button + modal-host change in `CircuitChatCanvas.vue`. Circuit server: one new `feedback/` folder under `brokering/` containing the agent config, guidelines text, Zod schema for `EditOp[]`, a YAML AST applier, a structural validator, a git committer, and the route handler. Concurrency is a single in-process mutex around the route. Edits are committed one-per-feedback to the working tree where circuit runs.

**Tech Stack:** PWA — Vue 3 + Ionic 8, TypeScript. Circuit — TypeScript ESM, Mastra `Agent` + `structuredOutput`, Zod v4, `yaml` npm package (new dep), `child_process.execFile('git', ...)` (no new dep), `node:assert` + `tsx`-runnable test scripts.

---

## File map

| Status | Path | Responsibility |
|---|---|---|
| **Modify** | `sandbox/circuit/package.json` | Add `yaml` dependency |
| **Create** | `sandbox/circuit/src/mastra/brokering/feedback/feedbackEditOpsSchema.ts` | Zod schema for `EditOp[]` + `FeedbackAgentResponse` |
| **Create** | `sandbox/circuit/src/mastra/brokering/feedback/feedbackEditApplier.ts` | Apply `EditOp[]` to a YAML AST, preserve comments |
| **Create** | `sandbox/circuit/src/mastra/brokering/feedback/feedbackYamlValidator.ts` | Re-parse updated YAML + enforce structural + frozen-field invariants |
| **Create** | `sandbox/circuit/src/mastra/brokering/feedback/feedbackGitCommitter.ts` | Atomic write + `git add` + `git commit` for the YAML file |
| **Create** | `sandbox/circuit/src/mastra/brokering/feedback/feedbackGuidelines.ts` | Exported system-prompt string for the feedback agent |
| **Create** | `sandbox/circuit/src/mastra/brokering/feedback/feedbackAgent.ts` | Mastra `Agent` config for the feedback agent |
| **Create** | `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRoute.ts` | `POST /knowledge-feedback` handler orchestrating the whole flow |
| **Modify** | `sandbox/circuit/src/mastra/brokering/agents.ts` | Register `knowledgeFeedbackAgent` in `brokeringAgents` |
| **Modify** | `sandbox/circuit/src/mastra/brokering/routes.ts` | Add `knowledgeFeedbackRoute` to `brokeringApiRoutes` |
| **Create** | `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackEditApplier.test.ts` | Unit tests for the applier |
| **Create** | `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackYamlValidator.test.ts` | Unit tests for the validator |
| **Create** | `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts` | Tmp-repo integration tests for the committer |
| **Create** | `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackAgentSmoke.test.ts` | LLM smoke test, gated by `RUN_LLM_TESTS=1` |
| **Create** | `apps/order-routing/src/services/CircuitKnowledgeFeedbackService.ts` | PWA service: types + `submitKnowledgeFeedback` fetch wrapper |
| **Create** | `apps/order-routing/src/components/circuit/CircuitFeedbackModal.vue` | Feedback modal UI |
| **Modify** | `apps/order-routing/src/components/circuit/CircuitChatCanvas.vue` | Add header button + modal binding + `buildFeedbackMessages` helper |
| **Create** | `apps/order-routing/tests/circuitKnowledgeFeedbackService.test.ts` | PWA service unit tests (fetch mocked) |

---

## Task 1: Add `yaml` dependency

**Files:**
- Modify: `sandbox/circuit/package.json`

- [ ] **Step 1.1 — Add the `yaml` dependency**

In `sandbox/circuit/`, run:

```bash
pnpm add yaml@^2.6.0
```

Expected: `package.json` now lists `"yaml": "^2.6.0"` under `dependencies`. `pnpm-lock.yaml` updates.

- [ ] **Step 1.2 — Sanity check the lib resolves**

Run:

```bash
node -e "const y=require('yaml'); console.log(typeof y.parseDocument)"
```

Expected output: `function`

- [ ] **Step 1.3 — Commit**

```bash
git add sandbox/circuit/package.json sandbox/circuit/pnpm-lock.yaml
git commit -m "Added: yaml dependency for knowledge feedback edits"
```

---

## Task 2: Edit ops schema

**Files:**
- Create: `sandbox/circuit/src/mastra/brokering/feedback/feedbackEditOpsSchema.ts`

- [ ] **Step 2.1 — Create the schema file**

Create `sandbox/circuit/src/mastra/brokering/feedback/feedbackEditOpsSchema.ts`:

```typescript
import { z } from "zod";

// A dotted/bracketed path into the YAML document, e.g.
// "diagnosticPatterns[2].appropriateClarifyingQuestions".
export const editPathSchema = z.string().min(1).regex(
  /^[A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]+\]|\.[A-Za-z_][A-Za-z0-9_]*)*$/,
  "path must be a dotted/bracketed identifier expression"
);

export const editOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("append"),
    path: editPathSchema,
    value: z.unknown()
  }),
  z.object({
    op: z.literal("set"),
    path: editPathSchema,
    value: z.unknown()
  }),
  z.object({
    op: z.literal("remove"),
    path: editPathSchema
  }),
  z.object({
    op: z.literal("insertAt"),
    path: editPathSchema,
    index: z.number().int().min(0),
    value: z.unknown()
  })
]);

export const feedbackAgentResponseSchema = z.object({
  summary: z.string().min(1).max(72),
  rationale: z.string().min(1),
  edits: z.array(editOpSchema)
});

export type EditOp = z.infer<typeof editOpSchema>;
export type FeedbackAgentResponse = z.infer<typeof feedbackAgentResponseSchema>;
```

- [ ] **Step 2.2 — Commit**

```bash
git add sandbox/circuit/src/mastra/brokering/feedback/feedbackEditOpsSchema.ts
git commit -m "Added: feedback edit ops Zod schema"
```

---

## Task 3: YAML edit applier

**Files:**
- Create: `sandbox/circuit/src/mastra/brokering/feedback/feedbackEditApplier.ts`
- Create: `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackEditApplier.test.ts`

- [ ] **Step 3.1 — Write the failing test file**

Create `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackEditApplier.test.ts`:

```typescript
import assert from "assert";
import { parse } from "yaml";
import { applyEditOps } from "../../../brokering/feedback/feedbackEditApplier";

const fixture = `# top comment
diagnosticPatterns:
  - id: no_route
    intent: behavior_diagnostic
    requires: [facility_change_summary]
    userQuestionExamples:
      - "why didn't this order route?"
    appropriateClarifyingQuestions:
      - "which order id?"
    inappropriateClarifyingQuestions: []
    diagnosticLevers: []
  - id: backorder_rate
    intent: behavior_diagnostic
    requires: [facility_change_summary]
    userQuestionExamples: []
    appropriateClarifyingQuestions: []
    inappropriateClarifyingQuestions: []
    diagnosticLevers: []
`;

// append to a list
{
  const { updatedYaml, appliedOps } = applyEditOps(fixture, [
    {
      op: "append",
      path: "diagnosticPatterns[0].appropriateClarifyingQuestions",
      value: "is the product store id known?"
    }
  ]);
  assert.equal(appliedOps, 1, "append should report one applied op");
  const reparsed = parse(updatedYaml) as any;
  assert.deepEqual(
    reparsed.diagnosticPatterns[0].appropriateClarifyingQuestions,
    ["which order id?", "is the product store id known?"]
  );
}

// set scalar
{
  const { updatedYaml, appliedOps } = applyEditOps(fixture, [
    { op: "set", path: "diagnosticPatterns[0].id", value: "ROUTING_FAILURE" }
  ]);
  assert.equal(appliedOps, 1);
  const reparsed = parse(updatedYaml) as any;
  assert.equal(reparsed.diagnosticPatterns[0].id, "ROUTING_FAILURE");
}

// remove a list item by index
{
  const { updatedYaml, appliedOps } = applyEditOps(fixture, [
    { op: "remove", path: "diagnosticPatterns[1]" }
  ]);
  assert.equal(appliedOps, 1);
  const reparsed = parse(updatedYaml) as any;
  assert.equal(reparsed.diagnosticPatterns.length, 1);
  assert.equal(reparsed.diagnosticPatterns[0].id, "no_route");
}

// insertAt with index === length (append-at-end of sequence)
{
  const { updatedYaml, appliedOps } = applyEditOps(fixture, [
    {
      op: "insertAt",
      path: "diagnosticPatterns[0].userQuestionExamples",
      index: 1,
      value: "why was order X queued?"
    }
  ]);
  assert.equal(appliedOps, 1);
  const reparsed = parse(updatedYaml) as any;
  assert.deepEqual(
    reparsed.diagnosticPatterns[0].userQuestionExamples,
    ["why didn't this order route?", "why was order X queued?"]
  );
}

// path resolution failure: parent missing
{
  let threw = false;
  try {
    applyEditOps(fixture, [
      { op: "append", path: "diagnosticPatterns[5].userQuestionExamples", value: "x" }
    ]);
  } catch {
    threw = true;
  }
  assert.equal(threw, true, "append into out-of-range index must throw");
}

// path resolution failure: insertAt out-of-range
{
  let threw = false;
  try {
    applyEditOps(fixture, [
      { op: "insertAt", path: "diagnosticPatterns[0].userQuestionExamples", index: 99, value: "x" }
    ]);
  } catch {
    threw = true;
  }
  assert.equal(threw, true, "insertAt with out-of-range index must throw");
}

// comment preservation: top-level comment survives a no-op-equivalent edit
{
  const { updatedYaml } = applyEditOps(fixture, [
    { op: "append", path: "diagnosticPatterns[0].userQuestionExamples", value: "extra" }
  ]);
  assert.ok(updatedYaml.startsWith("# top comment"), "top comment must be preserved");
}

console.log("feedbackEditApplier tests passed");
```

- [ ] **Step 3.2 — Run test to verify it fails**

Run from `sandbox/circuit/`:

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackEditApplier.test.ts
```

Expected: FAIL with a module-not-found error for `feedbackEditApplier` (we haven't created it yet).

- [ ] **Step 3.3 — Implement the applier**

Create `sandbox/circuit/src/mastra/brokering/feedback/feedbackEditApplier.ts`:

```typescript
import { Document, parseDocument, isMap, isSeq, isScalar } from "yaml";
import type { EditOp } from "./feedbackEditOpsSchema";

type PathSegment = { kind: "key"; key: string } | { kind: "index"; index: number };

const PATH_TOKEN = /([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;

function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let lastIndex = 0;
  PATH_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_TOKEN.exec(path)) !== null) {
    if (match.index !== lastIndex && path[match.index - 1] !== "." && match.index !== 0) {
      // tolerant: the only separators are "." between identifiers; "[N]" attaches directly.
    }
    if (match[1] !== undefined) {
      segments.push({ kind: "key", key: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ kind: "index", index: Number(match[2]) });
    }
    lastIndex = match.index + match[0].length;
  }
  if (segments.length === 0) {
    throw new Error(`Invalid edit path: ${path}`);
  }
  return segments;
}

function getCollection(doc: Document, segments: PathSegment[]) {
  let node: any = doc.contents;
  for (let i = 0; i < segments.length; i++) {
    if (node === null || node === undefined) {
      throw new Error(
        `Cannot resolve path segment ${i} (${describeSegment(segments[i])}): parent is null at depth ${i}.`
      );
    }
    const seg = segments[i];
    if (seg.kind === "key") {
      if (!isMap(node)) {
        throw new Error(`Path segment ${i} (.${seg.key}) targets a non-map node.`);
      }
      const next = node.get(seg.key, true);
      if (next === undefined) {
        throw new Error(`Path segment ${i} (.${seg.key}) does not exist.`);
      }
      node = next;
    } else {
      if (!isSeq(node)) {
        throw new Error(`Path segment ${i} ([${seg.index}]) targets a non-sequence node.`);
      }
      if (seg.index < 0 || seg.index >= node.items.length) {
        throw new Error(`Path segment ${i} ([${seg.index}]) out of range (length ${node.items.length}).`);
      }
      node = node.items[seg.index];
    }
  }
  return node;
}

function describeSegment(seg: PathSegment) {
  return seg.kind === "key" ? `.${seg.key}` : `[${seg.index}]`;
}

export function applyEditOps(yamlSource: string, ops: EditOp[]): {
  updatedYaml: string;
  appliedOps: number;
} {
  const doc = parseDocument(yamlSource, { keepSourceTokens: true });
  if (doc.errors.length > 0) {
    throw new Error(`Input YAML has parse errors: ${doc.errors.map((e) => e.message).join("; ")}`);
  }

  let appliedOps = 0;

  for (const op of ops) {
    const segments = parsePath(op.path);

    if (op.op === "append") {
      const target = getCollection(doc, segments);
      if (!isSeq(target)) {
        throw new Error(`append target ${op.path} is not a sequence.`);
      }
      target.add(doc.createNode(op.value));
    } else if (op.op === "insertAt") {
      const target = getCollection(doc, segments);
      if (!isSeq(target)) {
        throw new Error(`insertAt target ${op.path} is not a sequence.`);
      }
      if (op.index < 0 || op.index > target.items.length) {
        throw new Error(`insertAt index ${op.index} out of range (length ${target.items.length}).`);
      }
      target.items.splice(op.index, 0, doc.createNode(op.value));
    } else if (op.op === "set") {
      // set at root path
      if (segments.length === 0) throw new Error("set requires a path");
      const parentSegments = segments.slice(0, -1);
      const last = segments[segments.length - 1];
      if (parentSegments.length === 0) {
        if (last.kind === "key") {
          if (!isMap(doc.contents)) throw new Error("Document root is not a map.");
          doc.contents.set(last.key, doc.createNode(op.value));
        } else {
          throw new Error("set with a top-level numeric index is not supported.");
        }
      } else {
        const parent = getCollection(doc, parentSegments);
        if (last.kind === "key") {
          if (!isMap(parent)) throw new Error(`set parent at ${op.path} is not a map.`);
          parent.set(last.key, doc.createNode(op.value));
        } else {
          if (!isSeq(parent)) throw new Error(`set parent at ${op.path} is not a sequence.`);
          if (last.index < 0 || last.index >= parent.items.length) {
            throw new Error(`set index ${last.index} out of range.`);
          }
          parent.items[last.index] = doc.createNode(op.value);
        }
      }
    } else if (op.op === "remove") {
      if (segments.length === 0) throw new Error("remove requires a path");
      const parentSegments = segments.slice(0, -1);
      const last = segments[segments.length - 1];
      const parent = parentSegments.length === 0 ? doc.contents : getCollection(doc, parentSegments);
      if (last.kind === "key") {
        if (!isMap(parent)) throw new Error(`remove parent at ${op.path} is not a map.`);
        const deleted = parent.delete(last.key);
        if (!deleted) throw new Error(`remove target ${op.path} did not exist.`);
      } else {
        if (!isSeq(parent)) throw new Error(`remove parent at ${op.path} is not a sequence.`);
        if (last.index < 0 || last.index >= parent.items.length) {
          throw new Error(`remove index ${last.index} out of range.`);
        }
        parent.items.splice(last.index, 1);
      }
    }

    appliedOps += 1;
  }

  return {
    updatedYaml: String(doc),
    appliedOps
  };
}

// Re-export commonly used type imports so callers don't need both files.
export type { EditOp } from "./feedbackEditOpsSchema";

// Mark imports referenced for completeness check
void isScalar;
```

- [ ] **Step 3.4 — Run test to verify it passes**

Run from `sandbox/circuit/`:

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackEditApplier.test.ts
```

Expected output: `feedbackEditApplier tests passed`

- [ ] **Step 3.5 — Commit**

```bash
git add sandbox/circuit/src/mastra/brokering/feedback/feedbackEditApplier.ts \
        sandbox/circuit/src/mastra/test/brokering/feedback/feedbackEditApplier.test.ts
git commit -m "Added: YAML edit applier with comment-preserving AST mutations"
```

---

## Task 4: YAML validator

**Files:**
- Create: `sandbox/circuit/src/mastra/brokering/feedback/feedbackYamlValidator.ts`
- Create: `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackYamlValidator.test.ts`

- [ ] **Step 4.1 — Write the failing test**

Create `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackYamlValidator.test.ts`:

```typescript
import assert from "assert";
import { validateUpdatedYaml } from "../../../brokering/feedback/feedbackYamlValidator";

const validBase = `diagnosticPatterns:
  - id: no_route
    intent: behavior_diagnostic
    requires: [facility_change_summary]
  - id: backorder
    intent: recommendation
    requires: [facility_change_summary, brokering_facility_groups]
`;

const validBaseParsed = [
  { id: "no_route", intent: "behavior_diagnostic", requires: ["facility_change_summary"] },
  { id: "backorder", intent: "recommendation", requires: ["facility_change_summary", "brokering_facility_groups"] }
];

// happy path: same shape, no changes to identity fields
{
  validateUpdatedYaml(validBase, validBaseParsed);
}

// added a new pattern with valid identity fields
{
  const updated = validBase + `  - id: new_one
    intent: config_lookup
    requires: [product_store_settings]
`;
  validateUpdatedYaml(updated, validBaseParsed);
}

// removed all patterns
{
  let threw = false;
  try {
    validateUpdatedYaml(`diagnosticPatterns: []
`, validBaseParsed);
  } catch (err: any) {
    threw = true;
    assert.match(err.message, /diagnosticPatterns/);
  }
  assert.equal(threw, true, "empty diagnosticPatterns must throw");
}

// changed an existing pattern's id
{
  let threw = false;
  try {
    const updated = `diagnosticPatterns:
  - id: RENAMED
    intent: behavior_diagnostic
    requires: [facility_change_summary]
  - id: backorder
    intent: recommendation
    requires: [facility_change_summary, brokering_facility_groups]
`;
    validateUpdatedYaml(updated, validBaseParsed);
  } catch (err: any) {
    threw = true;
    assert.match(err.message, /frozen|identity|no_route/);
  }
  assert.equal(threw, true, "changing an existing id must throw");
}

// changed an existing pattern's intent
{
  let threw = false;
  try {
    const updated = `diagnosticPatterns:
  - id: no_route
    intent: recommendation
    requires: [facility_change_summary]
  - id: backorder
    intent: recommendation
    requires: [facility_change_summary, brokering_facility_groups]
`;
    validateUpdatedYaml(updated, validBaseParsed);
  } catch (err: any) {
    threw = true;
  }
  assert.equal(threw, true, "changing an existing intent must throw");
}

// invalid intent value on a new pattern
{
  let threw = false;
  try {
    const updated = validBase + `  - id: new_one
    intent: NOT_VALID
    requires: [product_store_settings]
`;
    validateUpdatedYaml(updated, validBaseParsed);
  } catch (err: any) {
    threw = true;
    assert.match(err.message, /intent/);
  }
  assert.equal(threw, true, "invalid intent must throw");
}

// invalid required tool id on a new pattern
{
  let threw = false;
  try {
    const updated = validBase + `  - id: new_one
    intent: config_lookup
    requires: [not_a_real_tool]
`;
    validateUpdatedYaml(updated, validBaseParsed);
  } catch (err: any) {
    threw = true;
    assert.match(err.message, /requires|tool/);
  }
  assert.equal(threw, true, "invalid required tool id must throw");
}

console.log("feedbackYamlValidator tests passed");
```

- [ ] **Step 4.2 — Run test to verify it fails**

Run from `sandbox/circuit/`:

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackYamlValidator.test.ts
```

Expected: FAIL with module-not-found for `feedbackYamlValidator`.

- [ ] **Step 4.3 — Implement the validator**

Create `sandbox/circuit/src/mastra/brokering/feedback/feedbackYamlValidator.ts`:

```typescript
import { parse } from "yaml";

const VALID_INTENTS = new Set([
  "config_lookup",
  "behavior_diagnostic",
  "environmental_audit",
  "recommendation"
]);

const VALID_TOOLS = new Set([
  "facility_change_summary",
  "brokering_facility_groups",
  "product_store_settings",
  "facility_order_limits"
]);

export type FrozenPattern = {
  id: string;
  intent: string;
  requires: string[];
};

export function validateUpdatedYaml(updatedYaml: string, preEditPatterns: FrozenPattern[]): void {
  let parsed: any;
  try {
    parsed = parse(updatedYaml);
  } catch (err: any) {
    throw new Error(`Updated YAML failed to parse: ${err?.message || err}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Updated YAML root must be a map.");
  }

  const patterns = parsed.diagnosticPatterns;
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error("Updated YAML must have a non-empty diagnosticPatterns list.");
  }

  // Build a lookup of pre-edit patterns by id for the frozen-field guard.
  const preEditById = new Map<string, FrozenPattern>();
  for (const p of preEditPatterns) {
    preEditById.set(p.id, p);
  }

  for (let i = 0; i < patterns.length; i++) {
    const entry = patterns[i];
    if (!entry || typeof entry !== "object") {
      throw new Error(`diagnosticPatterns[${i}] must be a map.`);
    }
    if (typeof entry.id !== "string" || !entry.id) {
      throw new Error(`diagnosticPatterns[${i}].id must be a non-empty string.`);
    }
    if (!VALID_INTENTS.has(entry.intent)) {
      throw new Error(`diagnosticPatterns[${i}].intent='${entry.intent}' is not a valid intent.`);
    }
    if (!Array.isArray(entry.requires)) {
      throw new Error(`diagnosticPatterns[${i}].requires must be an array.`);
    }
    for (const tool of entry.requires) {
      if (typeof tool !== "string" || !VALID_TOOLS.has(tool)) {
        throw new Error(`diagnosticPatterns[${i}].requires contains invalid tool id '${tool}'.`);
      }
    }

    const preEdit = preEditById.get(entry.id);
    if (preEdit) {
      // Existing pattern — identity fields must be unchanged.
      if (preEdit.intent !== entry.intent) {
        throw new Error(`diagnosticPatterns[${i}] (id=${entry.id}): intent is frozen but changed.`);
      }
      const sameRequires =
        preEdit.requires.length === entry.requires.length &&
        preEdit.requires.every((t, idx) => entry.requires[idx] === t);
      if (!sameRequires) {
        throw new Error(`diagnosticPatterns[${i}] (id=${entry.id}): requires is frozen but changed.`);
      }
    }
  }
}
```

- [ ] **Step 4.4 — Run test to verify it passes**

Run from `sandbox/circuit/`:

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackYamlValidator.test.ts
```

Expected output: `feedbackYamlValidator tests passed`

- [ ] **Step 4.5 — Commit**

```bash
git add sandbox/circuit/src/mastra/brokering/feedback/feedbackYamlValidator.ts \
        sandbox/circuit/src/mastra/test/brokering/feedback/feedbackYamlValidator.test.ts
git commit -m "Added: knowledge feedback YAML structural + frozen-field validator"
```

---

## Task 5: Git committer

**Files:**
- Create: `sandbox/circuit/src/mastra/brokering/feedback/feedbackGitCommitter.ts`
- Create: `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts`

- [ ] **Step 5.1 — Write the failing test**

Create `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts`:

```typescript
import assert from "assert";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAndCommitKnowledgeYaml } from "../../../brokering/feedback/feedbackGitCommitter";

function makeTmpRepo() {
  const dir = mkdtempSync(join(tmpdir(), "circuit-feedback-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Circuit Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  // seed an initial commit so HEAD exists
  writeFileSync(join(dir, "README.md"), "init\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

// happy path
{
  const repoDir = makeTmpRepo();
  const yamlPath = join(repoDir, "knowledge.yaml");
  writeFileSync(yamlPath, "diagnosticPatterns: []\n");
  execFileSync("git", ["add", "knowledge.yaml"], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "-m", "seed knowledge"], { cwd: repoDir });

  const result = writeAndCommitKnowledgeYaml({
    yamlPath,
    updatedYaml: "diagnosticPatterns:\n  - id: x\n",
    summary: "add x pattern",
    rationale: "user said x was missing",
    userCorrection: "we need to handle x",
    threadExcerpt: "- user: hi\n- assistant: hi"
  });

  assert.equal(typeof result.commitSha, "string");
  assert.equal(result.commitSha.length, 40, "commitSha must be 40 hex chars");
  assert.equal(result.shortSha.length, 7, "shortSha must be 7 chars");
  assert.equal(readFileSync(yamlPath, "utf-8"), "diagnosticPatterns:\n  - id: x\n");

  const log = execFileSync("git", ["log", "-1", "--format=%s%n%b"], { cwd: repoDir }).toString();
  assert.match(log, /^add x pattern/);
  assert.match(log, /user said x was missing/);
  assert.match(log, /we need to handle x/);
  assert.match(log, /- user: hi/);
}

// commit failure: pre-commit hook fails — file must remain updated on disk, error thrown
{
  const repoDir = makeTmpRepo();
  const yamlPath = join(repoDir, "knowledge.yaml");
  writeFileSync(yamlPath, "diagnosticPatterns: []\n");
  execFileSync("git", ["add", "knowledge.yaml"], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "-m", "seed knowledge"], { cwd: repoDir });

  // install a failing pre-commit hook
  const hooksDir = join(repoDir, ".git", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, "pre-commit");
  writeFileSync(hookPath, "#!/bin/sh\necho 'blocked'\nexit 1\n");
  chmodSync(hookPath, 0o755);

  let threw = false;
  try {
    writeAndCommitKnowledgeYaml({
      yamlPath,
      updatedYaml: "diagnosticPatterns:\n  - id: y\n",
      summary: "add y",
      rationale: "rationale",
      userCorrection: "correction",
      threadExcerpt: "thread"
    });
  } catch (err: any) {
    threw = true;
    assert.match(String(err?.message || err), /commit|hook|exit/i);
  }
  assert.equal(threw, true, "commit failure must throw");

  // File should still be updated on disk
  assert.equal(readFileSync(yamlPath, "utf-8"), "diagnosticPatterns:\n  - id: y\n");
}

console.log("feedbackGitCommitter tests passed");
```

- [ ] **Step 5.2 — Run test to verify it fails**

Run from `sandbox/circuit/`:

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts
```

Expected: FAIL with module-not-found for `feedbackGitCommitter`.

- [ ] **Step 5.3 — Implement the committer**

Create `sandbox/circuit/src/mastra/brokering/feedback/feedbackGitCommitter.ts`:

```typescript
import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { dirname, basename, resolve as resolvePath } from "node:path";

export type WriteAndCommitInput = {
  yamlPath: string;
  updatedYaml: string;
  summary: string;
  rationale: string;
  userCorrection: string;
  threadExcerpt: string;
};

export type WriteAndCommitResult = {
  commitSha: string;
  shortSha: string;
};

export function writeAndCommitKnowledgeYaml(input: WriteAndCommitInput): WriteAndCommitResult {
  const absoluteYamlPath = resolvePath(input.yamlPath);
  const repoDir = dirname(absoluteYamlPath);

  // Confirm we're inside a git repo. This throws if not.
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (err: any) {
    throw new Error(
      `Knowledge YAML directory is not a git repository: ${repoDir}. ${err?.message || ""}`.trim()
    );
  }

  // Atomic write: write to tmp, then rename. Survives interrupt mid-write.
  const tmpPath = `${absoluteYamlPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, input.updatedYaml, "utf-8");
  renameSync(tmpPath, absoluteYamlPath);

  // Stage only this file (caller-scoped).
  execFileSync("git", ["add", "--", basename(absoluteYamlPath)], { cwd: repoDir });

  const commitBody = [
    input.rationale.trim(),
    "",
    "User correction:",
    input.userCorrection.trim(),
    "",
    "Thread excerpt:",
    input.threadExcerpt.trim()
  ].join("\n");

  // Commit. If a pre-commit hook fails this throws; the file remains updated.
  try {
    execFileSync("git", ["commit", "-m", input.summary, "-m", commitBody], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (err: any) {
    const stderr = err?.stderr ? err.stderr.toString() : "";
    const stdout = err?.stdout ? err.stdout.toString() : "";
    throw new Error(
      `git commit failed (exit ${err?.status ?? "?"}): ${stderr || stdout || err?.message || "unknown"}`
    );
  }

  const fullSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir }).toString().trim();
  const shortSha = fullSha.slice(0, 7);

  return { commitSha: fullSha, shortSha };
}
```

- [ ] **Step 5.4 — Run test to verify it passes**

Run from `sandbox/circuit/`:

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts
```

Expected output: `feedbackGitCommitter tests passed`

- [ ] **Step 5.5 — Commit**

```bash
git add sandbox/circuit/src/mastra/brokering/feedback/feedbackGitCommitter.ts \
        sandbox/circuit/src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts
git commit -m "Added: git committer for knowledge feedback edits"
```

---

## Task 6: Feedback agent + guidelines

**Files:**
- Create: `sandbox/circuit/src/mastra/brokering/feedback/feedbackGuidelines.ts`
- Create: `sandbox/circuit/src/mastra/brokering/feedback/feedbackAgent.ts`
- Modify: `sandbox/circuit/src/mastra/brokering/agents.ts`

- [ ] **Step 6.1 — Create the guidelines string**

Create `sandbox/circuit/src/mastra/brokering/feedback/feedbackGuidelines.ts`:

```typescript
// Instructions for the knowledge feedback agent.
// Concatenated by the route handler with the current YAML, the conversation thread,
// the user's correction, and any optional context before the call.

export const knowledgeFeedbackInstructions = [
  "You update the HotWax order-routing domain knowledge YAML based on a Circuit user's feedback about a recent conversation.",
  "You receive: (1) the full current YAML, (2) the conversation thread, (3) the user's correction text, and (4) optional context (routing group / rule IDs).",
  "You must respond with a single JSON object matching the schema: { summary: string (<=72 chars), rationale: string, edits: EditOp[] }.",
  "Each EditOp is one of: { op: 'append', path, value }, { op: 'set', path, value }, { op: 'remove', path }, { op: 'insertAt', path, index, value }.",
  "Paths are dotted/bracketed identifiers into the YAML, e.g. 'diagnosticPatterns[2].appropriateClarifyingQuestions'.",
  "STRUCTURE: The YAML's top level is a map containing diagnosticPatterns (a non-empty list). Each pattern has: id, userQuestionExamples, intent, requires, diagnosticLevers, appropriateClarifyingQuestions, inappropriateClarifyingQuestions; optional recommendationFormat, reasoningWorkflow, rejectionDiagnoses. Do not reshape this schema.",
  "FROZEN FIELDS: id, intent, and requires on every existing pattern must remain exactly as they are. These map to TypeScript enums and canonical tool IDs and changing them breaks the loader.",
  "PREFER APPEND OVER REWRITE: When the feedback clarifies behavior, use 'append' on lists (userQuestionExamples, appropriateClarifyingQuestions, diagnosticLevers, etc.) rather than 'set' on prose fields. Adding examples and clarifying-question variants is the most common correct edit.",
  "SET IS FOR NARROW CORRECTIONS ONLY: Use 'set' to fix a specific wrong value (e.g. a recommendation template string). Never 'set' an entire pattern in one op; break the correction into the smallest set of edits.",
  "REMOVE ONLY WHEN FEEDBACK SAYS SO: Only use 'remove' when the feedback explicitly identifies an entry as wrong. Silence about an entry is not permission to delete it.",
  "DOMAIN VOICE: Do not paste the user's raw correction text into the YAML. Rephrase to match the style of surrounding entries — terse, third-person, no 'I' or 'you'.",
  "SCOPE: Usually scope edits to a single diagnostic pattern matching the conversation. Multi-pattern edits are allowed but must be obviously justified by the thread.",
  "AMBIGUITY: If you cannot confidently locate where the correction belongs, return edits: [] with a summary explaining what made it ambiguous. The server treats zero-edit responses as a no-op success and tells the user to be more specific.",
  "SUMMARY FIELD: <= 72 characters, present-tense, lowercase first letter unless a proper noun. Example: \"add 'safety stock priority' to no-route diagnostic levers\". This becomes the git commit headline.",
  "RATIONALE FIELD: 2-4 lines explaining which YAML paths changed and why, citing the user's correction. This becomes the git commit body.",
  "Return only the structured output object — no surrounding prose."
].join("\n");
```

- [ ] **Step 6.2 — Create the feedback agent**

Create `sandbox/circuit/src/mastra/brokering/feedback/feedbackAgent.ts`:

```typescript
import { Agent } from "@mastra/core/agent";
import { readServerEnv } from "../env";

export const knowledgeFeedbackAgent = new Agent({
  id: "knowledge-feedback-agent",
  name: "Knowledge Feedback Agent",
  instructions: "You update the order-routing knowledge base based on user feedback.",
  model: readServerEnv("MASTRA_MODEL") || "openai/gpt-4.1-mini"
});
```

- [ ] **Step 6.3 — Register the agent in `brokeringAgents`**

Edit `sandbox/circuit/src/mastra/brokering/agents.ts`. Replace the existing `brokeringAgents` export (lines 32-37 today) with:

```typescript
import { knowledgeFeedbackAgent } from "./feedback/feedbackAgent";

// ... (existing agent declarations unchanged) ...

export const brokeringAgents = {
  brokeringRouteDraftAgent,
  brokeringRouteInquiryAgent,
  brokeringRunsListInquiryAgent,
  brokeringRouteIntentAgent,
  knowledgeFeedbackAgent
};
```

Put the new `import` line at the top of the file alongside the existing `import { Agent } ...` and `import { readServerEnv } ...` lines.

- [ ] **Step 6.4 — Verify type-check passes**

Run from `sandbox/circuit/`:

```bash
npx tsc --noEmit
```

Expected: no new errors. (If unrelated errors exist in the repo, confirm none reference the feedback files.)

- [ ] **Step 6.5 — Commit**

```bash
git add sandbox/circuit/src/mastra/brokering/feedback/feedbackGuidelines.ts \
        sandbox/circuit/src/mastra/brokering/feedback/feedbackAgent.ts \
        sandbox/circuit/src/mastra/brokering/agents.ts
git commit -m "Added: knowledge feedback agent + guidelines"
```

---

## Task 7: Knowledge feedback route

**Files:**
- Create: `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRoute.ts`
- Modify: `sandbox/circuit/src/mastra/brokering/routes.ts`

- [ ] **Step 7.1 — Create the route handler**

Create `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRoute.ts`:

```typescript
import { registerApiRoute } from "@mastra/core/server";
import { readFileSync } from "node:fs";
import { dirname, join as joinPath, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parse } from "yaml";
import { applyEditOps } from "./feedbackEditApplier";
import { validateUpdatedYaml, type FrozenPattern } from "./feedbackYamlValidator";
import { writeAndCommitKnowledgeYaml } from "./feedbackGitCommitter";
import { knowledgeFeedbackInstructions } from "./feedbackGuidelines";
import { feedbackAgentResponseSchema, type FeedbackAgentResponse } from "./feedbackEditOpsSchema";
import { readServerEnv } from "../env";

const knowledgeFeedbackMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string()
});

const knowledgeFeedbackRequestSchema = z.object({
  messages: z.array(knowledgeFeedbackMessageSchema).min(1),
  userCorrection: z.string().min(1),
  context: z
    .object({
      routingGroupId: z.string().nullish(),
      routingRuleId: z.string().nullish(),
      activeContextLabel: z.string().nullish()
    })
    .nullish()
});

const KNOWLEDGE_FILE_NAME = "hotwax_order_routing_domain_knowledge.yaml";

// Single in-process mutex for feedback writes.
let feedbackChain: Promise<unknown> = Promise.resolve();
function withFeedbackLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = feedbackChain.then(() => fn(), () => fn());
  feedbackChain = next.catch(() => undefined);
  return next;
}

function resolveKnowledgeYamlPath(): string {
  // Anchor relative to this source file. When running via mastra dev the bundle
  // lives at .mastra/output/index.mjs; in that case go up two more levels.
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const isBundle = /[/\\]\.mastra[/\\]output$/.test(moduleDir);
  const baseDir = isBundle ? joinPath(moduleDir, "..", "..") : joinPath(moduleDir, "..");
  // baseDir is now /sandbox/circuit/src/mastra (or repo root in bundle mode).
  return resolvePath(joinPath(baseDir, "brokering", "domain", "knowledge", KNOWLEDGE_FILE_NAME));
}

function extractFrozenPatterns(yamlText: string): FrozenPattern[] {
  const parsed = parse(yamlText);
  const list = Array.isArray(parsed?.diagnosticPatterns) ? parsed.diagnosticPatterns : [];
  return list
    .filter((p: any) => p && typeof p.id === "string")
    .map((p: any) => ({
      id: p.id,
      intent: String(p.intent || ""),
      requires: Array.isArray(p.requires) ? p.requires.map(String) : []
    }));
}

function buildThreadExcerpt(messages: Array<{ role: string; content: string }>): string {
  return messages
    .slice(-6)
    .map((m) => `- ${m.role}: ${m.content.replace(/\s+/g, " ").trim()}`)
    .join("\n");
}

type FeedbackStage = "llm" | "validation" | "yaml_parse" | "git";

function errorResponse(stage: FeedbackStage, message: string) {
  return { ok: false as const, error: message, stage };
}

export const knowledgeFeedbackRoute = registerApiRoute("/knowledge-feedback", {
  method: "POST",
  requiresAuth: false,
  handler: async (c) => {
    let parsedBody: z.infer<typeof knowledgeFeedbackRequestSchema>;
    try {
      const body = await c.req.json();
      parsedBody = knowledgeFeedbackRequestSchema.parse(body);
    } catch (err: any) {
      return c.json(errorResponse("validation", `Request body invalid: ${err?.message || err}`), 400);
    }

    if (!readServerEnv("OPENAI_API_KEY")) {
      return c.json(errorResponse("llm", "Feedback assistant API key is not configured."), 503);
    }

    return withFeedbackLock(async () => {
      const yamlPath = resolveKnowledgeYamlPath();
      let currentYaml: string;
      try {
        currentYaml = readFileSync(yamlPath, "utf-8");
      } catch (err: any) {
        return c.json(errorResponse("yaml_parse", `Could not read knowledge YAML: ${err?.message || err}`), 500);
      }

      const preEditPatterns = extractFrozenPatterns(currentYaml);

      const mastraInstance = c.get("mastra");
      const agent = mastraInstance.getAgent("knowledgeFeedbackAgent");

      const userMessageBody = JSON.stringify({
        currentYaml,
        thread: parsedBody.messages,
        userCorrection: parsedBody.userCorrection,
        context: parsedBody.context ?? null
      });

      let agentResult: FeedbackAgentResponse;
      try {
        const result = await agent.generate(
          [{ role: "user" as const, content: userMessageBody }],
          {
            maxSteps: 1,
            instructions: knowledgeFeedbackInstructions,
            structuredOutput: { schema: feedbackAgentResponseSchema, errorStrategy: "strict" }
          }
        );
        agentResult = result.object as FeedbackAgentResponse;
      } catch (err: any) {
        console.warn("[knowledge-feedback] agent call failed:", err?.message || err);
        return c.json(errorResponse("llm", "Circuit could not process the feedback. Try rephrasing."), 502);
      }

      // No-op success
      if (agentResult.edits.length === 0) {
        return c.json({
          ok: true as const,
          commitSha: "",
          shortSha: "",
          summary: agentResult.summary,
          editCount: 0
        });
      }

      let updatedYaml: string;
      try {
        const applied = applyEditOps(currentYaml, agentResult.edits);
        updatedYaml = applied.updatedYaml;
      } catch (err: any) {
        console.warn("[knowledge-feedback] applier rejected agent edits:", err?.message || err);
        return c.json(errorResponse("validation", "Circuit suggested invalid edits. Try rephrasing."), 422);
      }

      try {
        validateUpdatedYaml(updatedYaml, preEditPatterns);
      } catch (err: any) {
        console.warn("[knowledge-feedback] validator rejected updated YAML:", err?.message || err);
        return c.json(errorResponse("yaml_parse", "Circuit suggested invalid edits. Try rephrasing."), 422);
      }

      try {
        const { commitSha, shortSha } = writeAndCommitKnowledgeYaml({
          yamlPath,
          updatedYaml,
          summary: agentResult.summary,
          rationale: agentResult.rationale,
          userCorrection: parsedBody.userCorrection,
          threadExcerpt: buildThreadExcerpt(parsedBody.messages)
        });
        return c.json({
          ok: true as const,
          commitSha,
          shortSha,
          summary: agentResult.summary,
          editCount: agentResult.edits.length
        });
      } catch (err: any) {
        console.error("[knowledge-feedback] git commit failed:", err?.message || err);
        return c.json(
          errorResponse(
            "git",
            "Edits saved to the YAML file but not committed. Check `git status` in the circuit working tree."
          ),
          500
        );
      }
    });
  }
});
```

- [ ] **Step 7.2 — Wire the route into `brokeringApiRoutes`**

Edit `sandbox/circuit/src/mastra/brokering/routes.ts`:

Add to the imports at the top (group with the other relative imports):

```typescript
import { knowledgeFeedbackRoute } from "./feedback/knowledgeFeedbackRoute";
```

Then replace the existing `export const brokeringApiRoutes = [ ... ];` with the same array but with `knowledgeFeedbackRoute` appended as the last element:

```typescript
export const brokeringApiRoutes = [
  // ... existing three routes unchanged ...
  knowledgeFeedbackRoute
];
```

- [ ] **Step 7.3 — Type-check**

Run from `sandbox/circuit/`:

```bash
npx tsc --noEmit
```

Expected: no new errors referencing the feedback files.

- [ ] **Step 7.4 — Commit**

```bash
git add sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRoute.ts \
        sandbox/circuit/src/mastra/brokering/routes.ts
git commit -m "Added: POST /knowledge-feedback route"
```

---

## Task 8: Optional LLM smoke test (gated)

**Files:**
- Create: `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackAgentSmoke.test.ts`

- [ ] **Step 8.1 — Create the gated smoke test**

Create `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackAgentSmoke.test.ts`:

```typescript
import assert from "assert";
import { knowledgeFeedbackAgent } from "../../../brokering/feedback/feedbackAgent";
import { knowledgeFeedbackInstructions } from "../../../brokering/feedback/feedbackGuidelines";
import { feedbackAgentResponseSchema } from "../../../brokering/feedback/feedbackEditOpsSchema";

if (process.env.RUN_LLM_TESTS !== "1") {
  console.log("feedbackAgentSmoke skipped (set RUN_LLM_TESTS=1 to run)");
  process.exit(0);
}

if (!process.env.OPENAI_API_KEY) {
  console.log("feedbackAgentSmoke skipped (OPENAI_API_KEY not set)");
  process.exit(0);
}

const fixtureYaml = `diagnosticPatterns:
  - id: no_route
    intent: behavior_diagnostic
    requires: [facility_change_summary]
    userQuestionExamples:
      - "why didn't this order route?"
    appropriateClarifyingQuestions:
      - "which order id?"
    inappropriateClarifyingQuestions: []
    diagnosticLevers: []
`;

const thread = [
  { role: "user" as const, content: "why didn't order 12345 route?" },
  { role: "assistant" as const, content: "It looks like the rule had no matching facility group." }
];

const userCorrection =
  "the assistant should have also asked whether facility 1001 had inventory at the time, since that's the most common cause";

async function main() {
  const result = await knowledgeFeedbackAgent.generate(
    [
      {
        role: "user" as const,
        content: JSON.stringify({
          currentYaml: fixtureYaml,
          thread,
          userCorrection,
          context: null
        })
      }
    ],
    {
      maxSteps: 1,
      instructions: knowledgeFeedbackInstructions,
      structuredOutput: { schema: feedbackAgentResponseSchema, errorStrategy: "strict" }
    }
  );

  const parsed = feedbackAgentResponseSchema.parse(result.object);
  assert.ok(parsed.summary.length > 0, "summary must be non-empty");
  assert.ok(parsed.rationale.length > 0, "rationale must be non-empty");
  // edits may be empty (model judges ambiguous) — that is a valid response shape.
  console.log("feedbackAgentSmoke produced", parsed.edits.length, "edits");
  console.log("feedbackAgentSmoke tests passed");
}

main().catch((err) => {
  console.error("feedbackAgentSmoke failed:", err);
  process.exit(1);
});
```

- [ ] **Step 8.2 — Sanity-run it skipped (no env var)**

Run from `sandbox/circuit/`:

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackAgentSmoke.test.ts
```

Expected output: `feedbackAgentSmoke skipped (set RUN_LLM_TESTS=1 to run)`

- [ ] **Step 8.3 — Commit**

```bash
git add sandbox/circuit/src/mastra/test/brokering/feedback/feedbackAgentSmoke.test.ts
git commit -m "Added: gated LLM smoke test for knowledge feedback agent"
```

---

## Task 9: PWA service

**Files:**
- Create: `apps/order-routing/src/services/CircuitKnowledgeFeedbackService.ts`
- Create: `apps/order-routing/tests/circuitKnowledgeFeedbackService.test.ts`

- [ ] **Step 9.1 — Write the failing test**

Create `apps/order-routing/tests/circuitKnowledgeFeedbackService.test.ts`:

```typescript
import assert from "node:assert";
import { submitKnowledgeFeedback } from "../src/services/CircuitKnowledgeFeedbackService";

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string };

function withMockFetch(impl: (url: string, init: FetchInit) => Promise<Response>) {
  const original = (globalThis as any).fetch;
  (globalThis as any).fetch = (url: string, init: FetchInit) => impl(url, init);
  return () => {
    (globalThis as any).fetch = original;
  };
}

// happy path: forwards body shape and returns the parsed JSON verbatim
async function happyPath() {
  let capturedUrl = "";
  let capturedBody: any = null;
  const restore = withMockFetch(async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body || "{}");
    return new Response(
      JSON.stringify({
        ok: true,
        commitSha: "abc1234567890abc1234567890abc1234567890a",
        shortSha: "abc1234",
        summary: "add example",
        editCount: 1
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });
  try {
    const result = await submitKnowledgeFeedback({
      messages: [{ role: "user", content: "hi" }],
      userCorrection: "should have done X",
      context: { routingGroupId: "rg-1" }
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.shortSha, "abc1234");
      assert.equal(result.editCount, 1);
    }
    assert.ok(capturedUrl.endsWith("/knowledge-feedback"));
    assert.deepEqual(capturedBody.messages, [{ role: "user", content: "hi" }]);
    assert.equal(capturedBody.userCorrection, "should have done X");
    assert.equal(capturedBody.context.routingGroupId, "rg-1");
  } finally {
    restore();
  }
}

// non-2xx response with structured error body
async function structuredError() {
  const restore = withMockFetch(async () =>
    new Response(JSON.stringify({ ok: false, error: "bad request", stage: "validation" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    })
  );
  try {
    const result = await submitKnowledgeFeedback({
      messages: [{ role: "user", content: "hi" }],
      userCorrection: "x"
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "validation");
      assert.equal(result.error, "bad request");
    }
  } finally {
    restore();
  }
}

// fetch rejection -> network stage
async function networkRejection() {
  const restore = withMockFetch(async () => {
    throw new Error("ECONNREFUSED");
  });
  try {
    const result = await submitKnowledgeFeedback({
      messages: [{ role: "user", content: "hi" }],
      userCorrection: "x"
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "network");
      assert.match(result.error, /ECONNREFUSED/);
    }
  } finally {
    restore();
  }
}

// non-JSON success body -> network stage
async function malformedJson() {
  const restore = withMockFetch(async () =>
    new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } })
  );
  try {
    const result = await submitKnowledgeFeedback({
      messages: [{ role: "user", content: "hi" }],
      userCorrection: "x"
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "network");
    }
  } finally {
    restore();
  }
}

async function main() {
  await happyPath();
  await structuredError();
  await networkRejection();
  await malformedJson();
  console.log("circuitKnowledgeFeedbackService tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 9.2 — Run test to verify it fails**

Run from `apps/order-routing/`:

```bash
npx tsx tests/circuitKnowledgeFeedbackService.test.ts
```

Expected: FAIL with module-not-found for `CircuitKnowledgeFeedbackService`.

- [ ] **Step 9.3 — Implement the service**

Create `apps/order-routing/src/services/CircuitKnowledgeFeedbackService.ts`:

```typescript
export type KnowledgeFeedbackMessage = {
  role: "user" | "assistant";
  content: string;
};

export type KnowledgeFeedbackRequest = {
  messages: KnowledgeFeedbackMessage[];
  userCorrection: string;
  context?: {
    routingGroupId?: string | null;
    routingRuleId?: string | null;
    activeContextLabel?: string;
  };
};

export type KnowledgeFeedbackStage = "network" | "llm" | "validation" | "yaml_parse" | "git";

export type KnowledgeFeedbackResult =
  | {
      ok: true;
      commitSha: string;
      shortSha: string;
      summary: string;
      editCount: number;
    }
  | {
      ok: false;
      error: string;
      stage: KnowledgeFeedbackStage;
    };

const ENDPOINT = "/knowledge-feedback";

function resolveMastraUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const raw = env.VITE_VUE_APP_MASTRA_URL || "http://localhost:4111";
  return raw.replace(/\/$/, "");
}

function isValidStage(value: unknown): value is KnowledgeFeedbackStage {
  return value === "network" || value === "llm" || value === "validation" || value === "yaml_parse" || value === "git";
}

export async function submitKnowledgeFeedback(
  request: KnowledgeFeedbackRequest
): Promise<KnowledgeFeedbackResult> {
  const url = `${resolveMastraUrl()}${ENDPOINT}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
  } catch (err: any) {
    return {
      ok: false,
      stage: "network",
      error: err?.message ? `Circuit unreachable: ${err.message}` : "Circuit unreachable."
    };
  }

  let body: any;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      stage: "network",
      error: `Unexpected non-JSON response (HTTP ${response.status}).`
    };
  }

  if (!response.ok || body?.ok === false) {
    const stage = isValidStage(body?.stage) ? body.stage : "network";
    const error = typeof body?.error === "string" && body.error
      ? body.error
      : `Knowledge feedback failed with HTTP ${response.status}`;
    return { ok: false, stage, error };
  }

  return {
    ok: true,
    commitSha: String(body.commitSha || ""),
    shortSha: String(body.shortSha || ""),
    summary: String(body.summary || ""),
    editCount: Number(body.editCount || 0)
  };
}
```

- [ ] **Step 9.4 — Run test to verify it passes**

Run from `apps/order-routing/`:

```bash
npx tsx tests/circuitKnowledgeFeedbackService.test.ts
```

Expected output: `circuitKnowledgeFeedbackService tests passed`

- [ ] **Step 9.5 — Commit**

```bash
git add apps/order-routing/src/services/CircuitKnowledgeFeedbackService.ts \
        apps/order-routing/tests/circuitKnowledgeFeedbackService.test.ts
git commit -m "Added: PWA knowledge feedback service"
```

---

## Task 10: PWA feedback modal

**Files:**
- Create: `apps/order-routing/src/components/circuit/CircuitFeedbackModal.vue`

- [ ] **Step 10.1 — Create the modal component**

Create `apps/order-routing/src/components/circuit/CircuitFeedbackModal.vue`:

```vue
<template>
  <ion-modal :is-open="isOpen" @didDismiss="onDismiss">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ translate("Send feedback") }}</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="onDismiss">{{ translate("Close") }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <template v-if="phase === 'form'">
        <p class="prompt-label">
          {{ translate("What was supposed to happen? Be specific — what did Circuit get wrong, and what should the correct answer have looked like?") }}
        </p>
        <ion-textarea
          v-model="userCorrection"
          :auto-grow="true"
          :counter="true"
          :maxlength="2000"
          :placeholder="translate('Describe the correction...')"
          :disabled="isSubmitting"
          fill="outline"
        />
        <ion-button
          expand="block"
          class="ion-margin-top"
          :disabled="!canSubmit"
          @click="submit"
        >
          <template v-if="isSubmitting">
            <ion-spinner name="dots" />
          </template>
          <template v-else>
            {{ translate("Send feedback") }}
          </template>
        </ion-button>
      </template>

      <template v-else-if="phase === 'success' && successResult">
        <h2>{{ translate("Knowledge base updated") }}</h2>
        <p v-if="successResult.editCount === 0">
          {{ translate("No changes made — feedback was too ambiguous.") }}
        </p>
        <p v-else class="commit-line">
          {{ translate("Commit") }}:
          <code>{{ successResult.shortSha }}</code>
          ({{ successResult.editCount }} {{ successResult.editCount === 1 ? translate("edit") : translate("edits") }})
        </p>
        <p class="summary">{{ successResult.summary }}</p>
        <ion-button expand="block" @click="onDismiss">{{ translate("Done") }}</ion-button>
      </template>

      <template v-else-if="phase === 'error' && errorResult">
        <h2>{{ translate("Couldn't send feedback") }}</h2>
        <p class="error-line">{{ errorResult.error }}</p>
        <p class="stage-line">
          {{ translate("Stage") }}: <code>{{ errorResult.stage }}</code>
        </p>
        <ion-button expand="block" @click="returnToForm">
          {{ translate("Try again") }}
        </ion-button>
        <ion-button expand="block" fill="clear" @click="onDismiss">
          {{ translate("Close") }}
        </ion-button>
      </template>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonModal,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar
} from "@ionic/vue";
import { computed, ref, watch } from "vue";
import { translate } from "@common";
import {
  submitKnowledgeFeedback,
  type KnowledgeFeedbackMessage,
  type KnowledgeFeedbackRequest,
  type KnowledgeFeedbackResult
} from "@/services/CircuitKnowledgeFeedbackService";

type Phase = "form" | "success" | "error";

const props = defineProps<{
  isOpen: boolean;
  messages: KnowledgeFeedbackMessage[];
  context?: KnowledgeFeedbackRequest["context"];
}>();

const emit = defineEmits<{
  (e: "dismiss"): void;
}>();

const phase = ref<Phase>("form");
const userCorrection = ref("");
const isSubmitting = ref(false);
const successResult = ref<Extract<KnowledgeFeedbackResult, { ok: true }> | null>(null);
const errorResult = ref<Extract<KnowledgeFeedbackResult, { ok: false }> | null>(null);

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      phase.value = "form";
      isSubmitting.value = false;
      successResult.value = null;
      errorResult.value = null;
    }
  }
);

const canSubmit = computed(() => userCorrection.value.trim().length > 0 && !isSubmitting.value);

async function submit() {
  if (!canSubmit.value) return;
  isSubmitting.value = true;
  errorResult.value = null;
  successResult.value = null;

  const result = await submitKnowledgeFeedback({
    messages: props.messages,
    userCorrection: userCorrection.value.trim(),
    context: props.context
  });

  isSubmitting.value = false;
  if (result.ok) {
    successResult.value = result;
    phase.value = "success";
  } else {
    errorResult.value = result;
    phase.value = "error";
  }
}

function returnToForm() {
  phase.value = "form";
  errorResult.value = null;
}

function onDismiss() {
  userCorrection.value = "";
  emit("dismiss");
}
</script>

<style scoped>
.prompt-label {
  margin-bottom: 12px;
  color: var(--ion-color-medium);
}

.commit-line code,
.stage-line code {
  background: var(--ion-color-step-50, #f4f5f8);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.summary {
  margin-top: 8px;
  white-space: pre-wrap;
}

.error-line {
  color: var(--ion-color-danger, #c0392b);
}
</style>
```

- [ ] **Step 10.2 — Commit**

```bash
git add apps/order-routing/src/components/circuit/CircuitFeedbackModal.vue
git commit -m "Added: CircuitFeedbackModal for knowledge base feedback"
```

---

## Task 11: Wire feedback button into chat canvas

**Files:**
- Modify: `apps/order-routing/src/components/circuit/CircuitChatCanvas.vue`

- [ ] **Step 11.1 — Add the import and the helpers**

Edit `apps/order-routing/src/components/circuit/CircuitChatCanvas.vue`.

In the `<script setup>` imports block (around the other `ionicons/icons` import), change the icon list to add `bulbOutline`:

```typescript
import {
  addOutline,
  bulbOutline,
  chatbubblesOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  refreshOutline,
  terminalOutline,
  trashOutline
} from 'ionicons/icons';
```

Add this import alongside the other component imports:

```typescript
import CircuitFeedbackModal from '@/components/circuit/CircuitFeedbackModal.vue';
import type { KnowledgeFeedbackMessage } from '@/services/CircuitKnowledgeFeedbackService';
```

Right after the existing `const showThreadMenu = ref(false);` and `const showPromptModal = ref(false);` lines, add:

```typescript
const showFeedbackModal = ref(false);

const canSendFeedback = computed(() => messages.value.length > 0);

function buildFeedbackMessages(): KnowledgeFeedbackMessage[] {
  return messages.value
    .map((message: any) => ({
      role: message.role === 'circuit' ? 'assistant' : message.role,
      content: String(message.content || '').trim()
    }))
    .filter((message: { role: string; content: string }) =>
      (message.role === 'user' || message.role === 'assistant') && message.content
    ) as KnowledgeFeedbackMessage[];
}

const feedbackContext = computed(() => ({
  routingGroupId: selectedContext.value?.routingGroupId ?? null,
  routingRuleId: (selectedContext.value as any)?.routingRuleId ?? null,
  activeContextLabel: (selectedContext.value as any)?.label ?? undefined
}));
```

- [ ] **Step 11.2 — Add the toolbar button**

Inside the existing `<ion-buttons slot="end">` in the toolbar, add this button between the existing prompt-modal button and the threads button (place it right before the `<ion-button @click="openThreadModal">`):

```vue
<ion-button
  v-if="canSendFeedback"
  :aria-label="translate('Send feedback to improve Circuit')"
  @click="showFeedbackModal = true"
>
  <ion-icon slot="icon-only" :icon="bulbOutline" />
</ion-button>
```

- [ ] **Step 11.3 — Mount the modal**

Just before the closing `</ion-page>` tag, add:

```vue
<CircuitFeedbackModal
  :is-open="showFeedbackModal"
  :messages="buildFeedbackMessages()"
  :context="feedbackContext"
  @dismiss="showFeedbackModal = false"
/>
```

- [ ] **Step 11.4 — Type-check**

Run from `apps/order-routing/`:

```bash
npm run lint
```

Expected: no new errors in `CircuitChatCanvas.vue` or `CircuitFeedbackModal.vue`.

- [ ] **Step 11.5 — Smoke-run the PWA**

From `apps/order-routing/`:

```bash
ionic serve
```

In another terminal, start the circuit server:

```bash
cd sandbox/circuit && pnpm dev
```

Manually verify in the browser:
1. Open Circuit, send at least one prompt so a thread exists.
2. The lightbulb (`bulbOutline`) button appears in the header.
3. Click it; the feedback modal opens with the textarea.
4. Type a correction and click "Send feedback".
5. Observe success (commit short SHA + summary) or error (with a stage tag and "Try again" button).

If the circuit working tree is not a git repo or the YAML path doesn't resolve, expect `stage: git` or `stage: yaml_parse` — both are valid outcomes for this manual check.

- [ ] **Step 11.6 — Commit**

```bash
git add apps/order-routing/src/components/circuit/CircuitChatCanvas.vue
git commit -m "Added: Circuit chat header feedback button + modal binding"
```

---

## Self-review

After Task 11, do a final sweep before declaring complete:

- [ ] **Run all new circuit-side tests from `sandbox/circuit/`:**

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackEditApplier.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackYamlValidator.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackAgentSmoke.test.ts
```

Expected: each file prints its "... tests passed" line (the smoke test prints "skipped" without `RUN_LLM_TESTS=1`).

- [ ] **Run the PWA service test from `apps/order-routing/`:**

```bash
npx tsx tests/circuitKnowledgeFeedbackService.test.ts
```

Expected: `circuitKnowledgeFeedbackService tests passed`

- [ ] **Confirm acceptance criteria from the spec:**

Walk through `docs/superpowers/specs/2026-05-26-knowledge-feedback-loop-design.md`'s "Acceptance criteria" section against the implementation. Every bullet should be satisfied.

- [ ] **If anything fails, fix in a new task and re-run.** Do not declare complete with red tests.
