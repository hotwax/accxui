# Knowledge Feedback Loop — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 1's single-shot auto-commit feedback flow with a three-endpoint **propose → refine → approve** pipeline driven by a multi-phase modal that gives the user an in-app diff preview, an iterative refinement loop with the agent, and assisted-authoring scaffolding (correction-category chips + structured templates).

**Architecture:** The applier, validator, git committer, agent, and Phase 1 Zod schemas are reused unchanged. Three new circuit routes replace the single old route — each wraps a pure work function so the approve path is unit-testable end-to-end with no LLM. The PWA service swaps one function for three, and the modal gains a `review` phase between `form` and `success` that hosts the diff display and the refinement sub-loop. The server is stateless; the PWA carries the proposal between calls.

**Tech Stack:** Same as Phase 1. Circuit — TypeScript ESM, Mastra `Agent` + `structuredOutput`, Zod v4, `yaml` package, `node:assert` + `tsx` tests. PWA — Vue 3 + Ionic 8, TypeScript. New dependency: none (uses `node:crypto.randomUUID()`).

---

## File map

| Status | Path | Responsibility |
|---|---|---|
| **Modify** | `sandbox/circuit/src/mastra/brokering/feedback/feedbackGuidelines.ts` | Split into two exported strings: `knowledgeFeedbackProposalInstructions`, `knowledgeFeedbackRefinementInstructions` |
| **Create** | `sandbox/circuit/src/mastra/brokering/feedback/feedbackProposalSchema.ts` | Zod schemas for the propose / refine / approve request + response bodies |
| **Create** | `sandbox/circuit/src/mastra/brokering/feedback/feedbackOpDescriber.ts` | Pure: `describeEdits(currentYaml, edits) → EditDescription[]` |
| **Create** | `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackProposeRoute.ts` | `POST /knowledge-feedback/propose` route + pure `proposeFeedback()` |
| **Create** | `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRefineRoute.ts` | `POST /knowledge-feedback/refine` route + pure `refineFeedback()` |
| **Create** | `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackApproveRoute.ts` | `POST /knowledge-feedback/approve` route + pure `approveFeedback()` (no LLM) |
| **Delete** | `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRoute.ts` | Replaced by three new routes |
| **Modify** | `sandbox/circuit/src/mastra/brokering/routes.ts` | Swap one route entry for three |
| **Create** | `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackOpDescriber.test.ts` | Unit tests for the describer |
| **Create** | `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackApproveRoute.test.ts` | Integration test for the approve handler in a tmp git repo (no LLM) |
| **Modify** | `apps/order-routing/src/services/CircuitKnowledgeFeedbackService.ts` | Replace `submitKnowledgeFeedback` with three new functions + types |
| **Modify** | `apps/order-routing/tests/circuitKnowledgeFeedbackService.test.ts` | One happy-path test per function + retained error stages |
| **Modify** | `apps/order-routing/src/components/circuit/CircuitFeedbackModal.vue` | Add `review` phase; correction-category chips + template in `form`; refinement textarea + Approve/Discard in `review` |

---

## Repo + branch context

Two separate git repos:

- **Circuit:** `/Users/aditipatel/sandbox/circuit`, branch `feat/migrate-brokering-mastra`
- **PWA:** `/Users/aditipatel/sandbox/accxui/apps/order-routing`, branch `feat/decouple-mastra-from-pwa` (this is a NESTED git repo inside the outer `accxui` repo)

All Phase 1 commits are already on these branches. Do not switch branches. Do not commit Phase 2 files into the outer `accxui` repo — the inner repo at `apps/order-routing` is the right one for PWA changes.

---

## Task 1: Split guidelines into proposal + refinement strings

**Files:**
- Modify: `sandbox/circuit/src/mastra/brokering/feedback/feedbackGuidelines.ts`

- [ ] **Step 1.1 — Replace the file contents**

Replace the entire contents of `/Users/aditipatel/sandbox/circuit/src/mastra/brokering/feedback/feedbackGuidelines.ts` with:

```typescript
// Instructions for the knowledge feedback agent.
// Two distinct prompts: one for the initial proposal, one for refinement.
// The route handler concatenates these with the current YAML, the conversation thread,
// the user's correction, and (for refinement) the previous proposal.

const sharedRules = [
  "STRUCTURE: The YAML's top level is a map containing diagnostic_patterns (a non-empty list). Each pattern has: id, user_question_examples, intent, requires, diagnostic_levers, appropriate_clarifying_questions, inappropriate_clarifying_questions; optional recommendation_format, reasoning_workflow, rejection_diagnoses. Do not reshape this schema.",
  "FROZEN FIELDS: id, intent, and requires on every existing pattern must remain exactly as they are. These map to TypeScript enums and canonical tool IDs and changing them breaks the loader.",
  "PREFER APPEND OVER REWRITE: When the feedback clarifies behavior, use 'append' on lists (user_question_examples, appropriate_clarifying_questions, diagnostic_levers, etc.) rather than 'set' on prose fields. Adding examples and clarifying-question variants is the most common correct edit.",
  "SET IS FOR NARROW CORRECTIONS ONLY: Use 'set' to fix a specific wrong value (e.g. a recommendation template string). Never 'set' an entire pattern in one op; break the correction into the smallest set of edits.",
  "REMOVE ONLY WHEN FEEDBACK SAYS SO: Only use 'remove' when the feedback explicitly identifies an entry as wrong. Silence about an entry is not permission to delete it.",
  "DOMAIN VOICE: Do not paste the user's raw correction text into the YAML. Rephrase to match the style of surrounding entries — terse, third-person, no 'I' or 'you'.",
  "SUMMARY FIELD: <= 72 characters, present-tense, lowercase first letter unless a proper noun. Example: \"add 'safety stock priority' to no-route diagnostic levers\". This becomes the git commit headline if the proposal is approved.",
  "RATIONALE FIELD: 2-4 lines explaining which YAML paths changed and why, citing the user's correction. This becomes the git commit body if the proposal is approved.",
  "EDIT LIMIT: Bias toward 1-5 edits. If the correction is large enough to need more than 5 edits, return the highest-leverage 5 and explain the trade-off in the rationale.",
  "Return only the structured output object — no surrounding prose."
];

const categoryGuidance = [
  "CORRECTION CATEGORY: The user's message JSON includes an optional 'correctionCategory' field hinting at the kind of fix. Use it to bias edit selection but do not let it override the feedback text itself:",
  "  - 'wrong_recommendation' → prefer 'set' on the recommendation template or 'append' to rejection_diagnoses",
  "  - 'missed_clarifying_question' → prefer 'append' to appropriate_clarifying_questions",
  "  - 'misnamed_entity' → prefer 'append' to user_question_examples showing the right name, or 'set' on a specific scalar",
  "  - 'should_have_used_tool' → prefer 'append' to requires (only if the tool is in the canonical list of facility_change_summary, brokering_facility_groups, product_store_settings, facility_order_limits) or update recommendation_format to require it",
  "  - 'other' or absent → no bias"
];

export const knowledgeFeedbackProposalInstructions = [
  "You update the HotWax order-routing domain knowledge YAML based on a Circuit user's feedback about a recent conversation.",
  "You receive: (1) the full current YAML, (2) the conversation thread, (3) the user's correction text, (4) an optional correctionCategory hint, and (5) optional context (routing group / rule IDs).",
  "You must respond with a single JSON object matching the schema: { summary: string (<=72 chars), rationale: string, edits: EditOp[] }.",
  "Each EditOp is one of: { op: 'append', path, value }, { op: 'set', path, value }, { op: 'remove', path }, { op: 'insertAt', path, index, value }.",
  "Paths are dotted/bracketed identifiers into the YAML, e.g. 'diagnostic_patterns[2].appropriate_clarifying_questions'.",
  ...sharedRules,
  ...categoryGuidance,
  "SCOPE: Usually scope edits to a single diagnostic pattern matching the conversation. Multi-pattern edits are allowed but must be obviously justified by the thread.",
  "AMBIGUITY: If you cannot confidently locate where the correction belongs, return edits: [] with a summary explaining what made it ambiguous. The server treats zero-edit responses as a no-op."
].join("\n");

export const knowledgeFeedbackRefinementInstructions = [
  "You are refining a PREVIOUS proposal based on additional feedback from the user. The previous proposal's summary, rationale, and edits are included in the user message JSON under the 'previousProposal' key.",
  "Your input is: (1) the full current YAML, (2) the conversation thread, (3) the ORIGINAL user correction, (4) the previous proposal you produced, (5) the new refinement feedback, and (6) optional context + category.",
  "Treat the previous proposal as a starting point. The user accepted the GOAL of the previous proposal but wants something changed about HOW it gets there. Read the refinement feedback carefully — it tells you what to change.",
  "If the refinement asks for a smaller change (fewer edits, a different path), shrink the proposal. If it asks for a broader change, expand it. If it asks for a completely different approach, replace the proposal entirely.",
  "The new proposal must stand on its own — do NOT produce diffs against the previous proposal. Return the full set of edits you want applied.",
  "If the refinement feedback is unclear or contradicts the original correction, return zero edits with a summary explaining the conflict.",
  "Respond with the same JSON object shape as proposals: { summary, rationale, edits }.",
  ...sharedRules,
  ...categoryGuidance
].join("\n");
```

- [ ] **Step 1.2 — Confirm consumers still resolve**

Run from `/Users/aditipatel/sandbox/circuit/`:

```bash
grep -rn "knowledgeFeedbackInstructions" src
```

Expected: only the soon-to-be-replaced `knowledgeFeedbackRoute.ts` still references the OLD export name. (We'll delete that file in Task 7.) No other file imports the old name. The two new exports (`knowledgeFeedbackProposalInstructions`, `knowledgeFeedbackRefinementInstructions`) are not yet imported anywhere — that's expected; later tasks will wire them up.

- [ ] **Step 1.3 — Commit**

```bash
git -C /Users/aditipatel/sandbox/circuit add src/mastra/brokering/feedback/feedbackGuidelines.ts
git -C /Users/aditipatel/sandbox/circuit commit -m "Refactored: split feedback guidelines into proposal + refinement"
```

---

## Task 2: Proposal / refine / approve Zod schemas

**Files:**
- Create: `sandbox/circuit/src/mastra/brokering/feedback/feedbackProposalSchema.ts`

- [ ] **Step 2.1 — Create the schema file**

Create `/Users/aditipatel/sandbox/circuit/src/mastra/brokering/feedback/feedbackProposalSchema.ts` with this exact content:

```typescript
import { z } from "zod";
import { editOpSchema } from "./feedbackEditOpsSchema";

// Shared message + context shapes (mirror the PWA side).

export const knowledgeFeedbackMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string()
});

export const knowledgeFeedbackContextSchema = z
  .object({
    routingGroupId: z.string().nullish(),
    routingRuleId: z.string().nullish(),
    activeContextLabel: z.string().nullish()
  })
  .nullish();

export const correctionCategorySchema = z.enum([
  "wrong_recommendation",
  "missed_clarifying_question",
  "misnamed_entity",
  "should_have_used_tool",
  "other"
]);

export type CorrectionCategory = z.infer<typeof correctionCategorySchema>;

// Op description — human-readable text returned alongside the structured ops.

export const editDescriptionSchema = z.object({
  op: z.enum(["append", "set", "remove", "insertAt"]),
  path: z.string(),
  text: z.string()
});

export type EditDescription = z.infer<typeof editDescriptionSchema>;

// Proposal payload — what /propose and /refine return.

export const proposalPayloadSchema = z.object({
  proposalId: z.string(),
  summary: z.string().min(1).max(72),
  rationale: z.string().min(1),
  edits: z.array(editOpSchema),
  editDescriptions: z.array(editDescriptionSchema)
});

export type ProposalPayload = z.infer<typeof proposalPayloadSchema>;

// The shape clients pass back to refine/approve (no editDescriptions needed).

export const carriedProposalSchema = z.object({
  proposalId: z.string(),
  summary: z.string().min(1).max(72),
  rationale: z.string().min(1),
  edits: z.array(editOpSchema)
});

export type CarriedProposal = z.infer<typeof carriedProposalSchema>;

// Request schemas.

export const proposeRequestSchema = z.object({
  messages: z.array(knowledgeFeedbackMessageSchema).min(1),
  userCorrection: z.string().min(1),
  correctionCategory: correctionCategorySchema.optional(),
  context: knowledgeFeedbackContextSchema
});

export type ProposeRequest = z.infer<typeof proposeRequestSchema>;

export const refineRequestSchema = z.object({
  messages: z.array(knowledgeFeedbackMessageSchema).min(1),
  userCorrection: z.string().min(1),
  correctionCategory: correctionCategorySchema.optional(),
  context: knowledgeFeedbackContextSchema,
  previousProposal: carriedProposalSchema,
  refinementFeedback: z.string().min(1)
});

export type RefineRequest = z.infer<typeof refineRequestSchema>;

export const approveRequestSchema = z.object({
  proposal: carriedProposalSchema,
  userCorrection: z.string().min(1),
  refinementHistory: z.array(z.string()).optional(),
  messages: z.array(knowledgeFeedbackMessageSchema).min(1)
});

export type ApproveRequest = z.infer<typeof approveRequestSchema>;

// Response envelopes.

export type ProposalErrorStage = "validation" | "llm" | "applier_dry_run" | "network";

export type ProposalResult =
  | { ok: true; proposal: ProposalPayload }
  | { ok: false; stage: ProposalErrorStage; error: string };

export type ApproveErrorStage = "validation" | "applier" | "yaml_parse" | "git" | "network";

export type ApproveResult =
  | {
      ok: true;
      commitSha: string;
      shortSha: string;
      summary: string;
      editCount: number;
    }
  | { ok: false; stage: ApproveErrorStage; error: string };
```

- [ ] **Step 2.2 — Verify type-check passes**

Run from `/Users/aditipatel/sandbox/circuit/`:

```bash
npx tsc --noEmit
```

Expected: zero errors in the new file. (Other files may still reference the deleted-soon `knowledgeFeedbackRoute.ts` and the old guidelines export — that's fine, we clean it up in Task 7.)

- [ ] **Step 2.3 — Commit**

```bash
git -C /Users/aditipatel/sandbox/circuit add src/mastra/brokering/feedback/feedbackProposalSchema.ts
git -C /Users/aditipatel/sandbox/circuit commit -m "Added: Zod schemas for propose/refine/approve feedback flow"
```

---

## Task 3: Op describer (TDD)

**Files:**
- Create: `sandbox/circuit/src/mastra/brokering/feedback/feedbackOpDescriber.ts`
- Create: `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackOpDescriber.test.ts`

- [ ] **Step 3.1 — Write the failing test**

Create `/Users/aditipatel/sandbox/circuit/src/mastra/test/brokering/feedback/feedbackOpDescriber.test.ts` with this exact content:

```typescript
import assert from "assert";
import { describeEdits } from "../../../brokering/feedback/feedbackOpDescriber";

const fixture = `diagnostic_patterns:
  - id: no_route
    intent: behavior_diagnostic
    requires: [facility_change_summary]
    user_question_examples:
      - "why didn't this order route?"
    appropriate_clarifying_questions:
      - "which order id?"
    inappropriate_clarifying_questions: []
    diagnostic_levers: []
  - id: high_unfillable_rate
    intent: recommendation
    requires: [facility_change_summary]
    user_question_examples: []
    appropriate_clarifying_questions: []
    inappropriate_clarifying_questions: []
    diagnostic_levers: []
    recommendation_format:
      must_open_with: "Identify the rule responsible."
`;

// append user_question_examples
{
  const descs = describeEdits(fixture, [
    {
      op: "append",
      path: "diagnostic_patterns[0].user_question_examples",
      value: "why was this order queued?"
    }
  ]);
  assert.equal(descs.length, 1);
  assert.equal(descs[0].op, "append");
  assert.equal(descs[0].path, "diagnostic_patterns[0].user_question_examples");
  assert.equal(
    descs[0].text,
    'Add example question to "no_route" pattern: "why was this order queued?"'
  );
}

// append appropriate_clarifying_questions
{
  const descs = describeEdits(fixture, [
    {
      op: "append",
      path: "diagnostic_patterns[0].appropriate_clarifying_questions",
      value: "is the product store id known?"
    }
  ]);
  assert.equal(
    descs[0].text,
    'Add clarifying question to "no_route" pattern: "is the product store id known?"'
  );
}

// append inappropriate_clarifying_questions
{
  const descs = describeEdits(fixture, [
    {
      op: "append",
      path: "diagnostic_patterns[0].inappropriate_clarifying_questions",
      value: "what is productStoreId?"
    }
  ]);
  assert.equal(
    descs[0].text,
    'Mark question as inappropriate for "no_route" pattern: "what is productStoreId?"'
  );
}

// append diagnostic_levers (value is an object with a `lever` key)
{
  const descs = describeEdits(fixture, [
    {
      op: "append",
      path: "diagnostic_patterns[0].diagnostic_levers",
      value: { lever: "facility_group_breadth", explanation: "broadens inventory pool" }
    }
  ]);
  assert.equal(
    descs[0].text,
    'Add diagnostic lever to "no_route" pattern: "facility_group_breadth"'
  );
}

// set on recommendation_format.must_open_with
{
  const descs = describeEdits(fixture, [
    {
      op: "set",
      path: "diagnostic_patterns[1].recommendation_format.must_open_with",
      value: "Open with the bottleneck rule, named explicitly."
    }
  ]);
  assert.equal(descs[0].op, "set");
  assert.equal(
    descs[0].text,
    'Replace recommendation opener for "high_unfillable_rate" pattern'
  );
}

// set on an arbitrary path falls back to generic template
{
  const descs = describeEdits(fixture, [
    { op: "set", path: "ontology.domain", value: "Updated domain string" }
  ]);
  assert.equal(descs[0].text, "Replace value at ontology.domain");
}

// remove entire pattern
{
  const descs = describeEdits(fixture, [
    { op: "remove", path: "diagnostic_patterns[0]" }
  ]);
  assert.equal(descs[0].text, 'Remove "no_route" pattern entirely');
}

// remove an item inside a pattern
{
  const descs = describeEdits(fixture, [
    { op: "remove", path: "diagnostic_patterns[0].user_question_examples[0]" }
  ]);
  assert.equal(
    descs[0].text,
    'Remove item 0 from user_question_examples on "no_route" pattern'
  );
}

// insertAt
{
  const descs = describeEdits(fixture, [
    {
      op: "insertAt",
      path: "diagnostic_patterns[0].user_question_examples",
      index: 0,
      value: "why is this order stuck?"
    }
  ]);
  assert.equal(
    descs[0].text,
    'Add example question to "no_route" pattern: "why is this order stuck?" (at position 0)'
  );
}

// fallback for anything else
{
  const descs = describeEdits(fixture, [
    { op: "set", path: "diagnostic_patterns[0].requires[0]", value: "facility_change_summary" }
  ]);
  // Not a templated path — falls through to generic.
  assert.match(descs[0].text, /Replace value at/);
}

console.log("feedbackOpDescriber tests passed");
```

- [ ] **Step 3.2 — Run test to verify it fails**

Run from `/Users/aditipatel/sandbox/circuit/`:

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackOpDescriber.test.ts
```

Expected: FAIL with module-not-found for `feedbackOpDescriber`.

- [ ] **Step 3.3 — Implement the describer**

Create `/Users/aditipatel/sandbox/circuit/src/mastra/brokering/feedback/feedbackOpDescriber.ts` with this exact content:

```typescript
import { parse } from "yaml";
import type { EditOp } from "./feedbackEditOpsSchema";

export type EditDescription = {
  op: "append" | "set" | "remove" | "insertAt";
  path: string;
  text: string;
};

const PATTERN_PATH = /^diagnostic_patterns\[(\d+)\](?:\.(.+))?$/;

function getPatternId(currentYaml: string, index: number): string | undefined {
  try {
    const parsed = parse(currentYaml) as any;
    const pattern = parsed?.diagnostic_patterns?.[index];
    return typeof pattern?.id === "string" ? pattern.id : undefined;
  } catch {
    return undefined;
  }
}

function quotedString(value: unknown): string {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (value && typeof value === "object" && "lever" in (value as any) && typeof (value as any).lever === "string") {
    return `"${(value as any).lever}"`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function describeAppendOrInsert(
  op: EditOp,
  patternIndex: number,
  suffix: string,
  currentYaml: string,
  positionalSuffix: string
): string {
  const patternId = getPatternId(currentYaml, patternIndex);
  const idLabel = patternId ? `"${patternId}"` : `pattern at index ${patternIndex}`;
  const valueLabel = "value" in op ? quotedString(op.value) : "";

  if (suffix === "user_question_examples") {
    return `Add example question to ${idLabel} pattern: ${valueLabel}${positionalSuffix}`;
  }
  if (suffix === "appropriate_clarifying_questions") {
    return `Add clarifying question to ${idLabel} pattern: ${valueLabel}${positionalSuffix}`;
  }
  if (suffix === "inappropriate_clarifying_questions") {
    return `Mark question as inappropriate for ${idLabel} pattern: ${valueLabel}${positionalSuffix}`;
  }
  if (suffix === "diagnostic_levers") {
    return `Add diagnostic lever to ${idLabel} pattern: ${valueLabel}${positionalSuffix}`;
  }
  return `Update ${op.path}${positionalSuffix}`;
}

function describeSet(op: Extract<EditOp, { op: "set" }>, currentYaml: string): string {
  // Pattern-scoped recommendation opener
  const recOpener = /^diagnostic_patterns\[(\d+)\]\.recommendation_format\.must_open_with$/.exec(op.path);
  if (recOpener) {
    const idx = Number(recOpener[1]);
    const patternId = getPatternId(currentYaml, idx);
    const idLabel = patternId ? `"${patternId}"` : `pattern at index ${idx}`;
    return `Replace recommendation opener for ${idLabel} pattern`;
  }
  return `Replace value at ${op.path}`;
}

function describeRemove(op: Extract<EditOp, { op: "remove" }>, currentYaml: string): string {
  // Whole pattern
  const wholePattern = /^diagnostic_patterns\[(\d+)\]$/.exec(op.path);
  if (wholePattern) {
    const idx = Number(wholePattern[1]);
    const patternId = getPatternId(currentYaml, idx);
    const idLabel = patternId ? `"${patternId}"` : `pattern at index ${idx}`;
    return `Remove ${idLabel} pattern entirely`;
  }

  // Item inside a pattern list, e.g. diagnostic_patterns[0].user_question_examples[2]
  const itemInList = /^diagnostic_patterns\[(\d+)\]\.([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]$/.exec(op.path);
  if (itemInList) {
    const idx = Number(itemInList[1]);
    const listName = itemInList[2];
    const itemIndex = Number(itemInList[3]);
    const patternId = getPatternId(currentYaml, idx);
    const idLabel = patternId ? `"${patternId}"` : `pattern at index ${idx}`;
    return `Remove item ${itemIndex} from ${listName} on ${idLabel} pattern`;
  }

  return `Remove ${op.path}`;
}

export function describeEdits(currentYaml: string, edits: EditOp[]): EditDescription[] {
  return edits.map((op): EditDescription => {
    if (op.op === "append" || op.op === "insertAt") {
      const patternMatch = PATTERN_PATH.exec(op.path);
      const patternIndex = patternMatch ? Number(patternMatch[1]) : -1;
      const suffix = patternMatch?.[2] ?? "";
      const positionalSuffix = op.op === "insertAt" ? ` (at position ${op.index})` : "";
      return {
        op: op.op,
        path: op.path,
        text: describeAppendOrInsert(op, patternIndex, suffix, currentYaml, positionalSuffix)
      };
    }
    if (op.op === "set") {
      return { op: "set", path: op.path, text: describeSet(op, currentYaml) };
    }
    return { op: "remove", path: op.path, text: describeRemove(op, currentYaml) };
  });
}
```

- [ ] **Step 3.4 — Run test to verify it passes**

Run from `/Users/aditipatel/sandbox/circuit/`:

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackOpDescriber.test.ts
```

Expected output (final line): `feedbackOpDescriber tests passed`

- [ ] **Step 3.5 — Commit**

```bash
git -C /Users/aditipatel/sandbox/circuit add src/mastra/brokering/feedback/feedbackOpDescriber.ts \
        src/mastra/test/brokering/feedback/feedbackOpDescriber.test.ts
git -C /Users/aditipatel/sandbox/circuit commit -m "Added: human-readable edit-op descriptions for proposal review"
```

---

## Task 4: Approve route + integration test (TDD)

**Files:**
- Create: `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackApproveRoute.ts`
- Create: `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackApproveRoute.test.ts`

- [ ] **Step 4.1 — Write the failing test**

Create `/Users/aditipatel/sandbox/circuit/src/mastra/test/brokering/feedback/feedbackApproveRoute.test.ts` with this exact content:

```typescript
import assert from "assert";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveFeedback } from "../../../brokering/feedback/knowledgeFeedbackApproveRoute";

function makeTmpRepoWithKnowledge() {
  const dir = mkdtempSync(join(tmpdir(), "circuit-approve-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Circuit Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });

  const yamlPath = join(dir, "knowledge.yaml");
  writeFileSync(
    yamlPath,
    `diagnostic_patterns:
  - id: no_route
    intent: behavior_diagnostic
    requires: [facility_change_summary]
    user_question_examples:
      - "why didn't this order route?"
    appropriate_clarifying_questions:
      - "which order id?"
    inappropriate_clarifying_questions: []
    diagnostic_levers: []
`
  );
  execFileSync("git", ["add", "knowledge.yaml"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "seed knowledge"], { cwd: dir });
  return { dir, yamlPath };
}

// happy path: approve writes + commits + returns SHA
async function happyPath() {
  const { yamlPath, dir } = makeTmpRepoWithKnowledge();

  const result = await approveFeedback(
    {
      proposal: {
        proposalId: "test-1",
        summary: "add clarifying question to no_route",
        rationale: "user wanted product store id to be asked",
        edits: [
          {
            op: "append",
            path: "diagnostic_patterns[0].appropriate_clarifying_questions",
            value: "is the product store id known?"
          }
        ]
      },
      userCorrection: "we should ask about product store id",
      refinementHistory: ["actually phrase it as a yes/no"],
      messages: [
        { role: "user", content: "why didn't order 123 route?" },
        { role: "assistant", content: "could not find a matching rule" }
      ]
    },
    { yamlPath }
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.commitSha.length, 40);
    assert.equal(result.shortSha.length, 7);
    assert.equal(result.editCount, 1);
    assert.equal(result.summary, "add clarifying question to no_route");
  }

  const updated = readFileSync(yamlPath, "utf-8");
  assert.match(updated, /is the product store id known\?/);

  // verify commit body includes correction + refinement + thread excerpt
  const log = execFileSync("git", ["log", "-1", "--format=%s%n%b"], { cwd: dir }).toString();
  assert.match(log, /add clarifying question to no_route/);
  assert.match(log, /user wanted product store id/);
  assert.match(log, /we should ask about product store id/);
  assert.match(log, /Refinements:/);
  assert.match(log, /actually phrase it as a yes\/no/);
  assert.match(log, /Thread excerpt:/);
  assert.match(log, /why didn't order 123 route\?/);
}

// applier rejection: invalid path returns stage='applier'
async function applierRejection() {
  const { yamlPath } = makeTmpRepoWithKnowledge();

  const result = await approveFeedback(
    {
      proposal: {
        proposalId: "test-2",
        summary: "bad path",
        rationale: "this path does not exist",
        edits: [
          {
            op: "append",
            path: "diagnostic_patterns[99].appropriate_clarifying_questions",
            value: "won't apply"
          }
        ]
      },
      userCorrection: "x",
      messages: [{ role: "user", content: "x" }]
    },
    { yamlPath }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, "applier");
    assert.match(result.error, /index|range|path|exist/i);
  }
}

// frozen field violation: tampering with id is rejected at validator
async function frozenFieldViolation() {
  const { yamlPath } = makeTmpRepoWithKnowledge();

  const result = await approveFeedback(
    {
      proposal: {
        proposalId: "test-3",
        summary: "rename no_route",
        rationale: "wrong",
        edits: [
          { op: "set", path: "diagnostic_patterns[0].intent", value: "recommendation" }
        ]
      },
      userCorrection: "x",
      messages: [{ role: "user", content: "x" }]
    },
    { yamlPath }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, "yaml_parse");
    assert.match(result.error, /intent|frozen/i);
  }
}

async function main() {
  await happyPath();
  await applierRejection();
  await frozenFieldViolation();
  console.log("feedbackApproveRoute tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4.2 — Run test to verify it fails**

Run from `/Users/aditipatel/sandbox/circuit/`:

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackApproveRoute.test.ts
```

Expected: FAIL with module-not-found for `knowledgeFeedbackApproveRoute`.

- [ ] **Step 4.3 — Refactor the committer signature first**

The approve route needs the committer to accept a single `bodyText` field instead of composing the body from separate `rationale` / `userCorrection` / `threadExcerpt` fields. Phase 1 only has one caller of the committer (about to be deleted), so this is safe.

In `/Users/aditipatel/sandbox/circuit/src/mastra/brokering/feedback/feedbackGitCommitter.ts`, replace the input type and the body-composition block.

OLD `WriteAndCommitInput` (top of file):

```typescript
export type WriteAndCommitInput = {
  yamlPath: string;
  updatedYaml: string;
  summary: string;
  rationale: string;
  userCorrection: string;
  threadExcerpt: string;
};
```

NEW:

```typescript
export type WriteAndCommitInput = {
  yamlPath: string;
  updatedYaml: string;
  summary: string;
  bodyText: string;
};
```

OLD `commitBody` composition (mid-function):

```typescript
const commitBody = [
  input.rationale.trim(),
  "",
  "User correction:",
  input.userCorrection.trim(),
  "",
  "Thread excerpt:",
  input.threadExcerpt.trim()
].join("\n");
```

NEW:

```typescript
const commitBody = input.bodyText.trim();
```

Now update `/Users/aditipatel/sandbox/circuit/src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts` to match the new signature. Replace the happy-path call site:

OLD:

```typescript
writeAndCommitKnowledgeYaml({
  yamlPath,
  updatedYaml: "diagnosticPatterns:\n  - id: x\n",
  summary: "add x pattern",
  rationale: "user said x was missing",
  userCorrection: "we need to handle x",
  threadExcerpt: "- user: hi\n- assistant: hi"
});
```

NEW:

```typescript
writeAndCommitKnowledgeYaml({
  yamlPath,
  updatedYaml: "diagnostic_patterns:\n  - id: x\n",
  summary: "add x pattern",
  bodyText: "user said x was missing\n\nUser correction:\nwe need to handle x\n\nThread excerpt:\n- user: hi\n- assistant: hi"
});
```

Repeat the same shape change for the failure-path call site (the test that triggers a pre-commit hook failure) — replace its `rationale` / `userCorrection` / `threadExcerpt` args with a single `bodyText` arg containing equivalent text.

The log-content assertions stay the same because the substrings still appear in the body text.

Run the existing committer test to confirm:

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts
```

Expected output: `feedbackGitCommitter tests passed`

- [ ] **Step 4.4 — Implement the approve route**

Create `/Users/aditipatel/sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackApproveRoute.ts` with this exact content:

```typescript
import { registerApiRoute } from "@mastra/core/server";
import { readFileSync } from "node:fs";
import { applyEditOps } from "./feedbackEditApplier";
import { validateUpdatedYaml, type FrozenPattern } from "./feedbackYamlValidator";
import { writeAndCommitKnowledgeYaml } from "./feedbackGitCommitter";
import { resolveKnowledgePath } from "../domain/orderRoutingDomainKnowledge";
import {
  approveRequestSchema,
  type ApproveRequest,
  type ApproveResult
} from "./feedbackProposalSchema";
import { parse } from "yaml";

const KNOWLEDGE_FILE_NAME = "hotwax_order_routing_domain_knowledge.yaml";

// In-process mutex (shared across feedback writes — only the approve path mutates).
let feedbackChain: Promise<unknown> = Promise.resolve();
function withFeedbackLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = feedbackChain.then(() => fn(), () => fn());
  feedbackChain = next.catch(() => undefined);
  return next;
}

function extractFrozenPatterns(yamlText: string): FrozenPattern[] {
  const parsed = parse(yamlText);
  const list = Array.isArray(parsed?.diagnostic_patterns) ? parsed.diagnostic_patterns : [];
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

function buildCommitBody(input: ApproveRequest): string {
  const lines: string[] = [];
  lines.push(input.proposal.rationale.trim());
  lines.push("");
  lines.push("User correction:");
  lines.push(input.userCorrection.trim());
  if (input.refinementHistory && input.refinementHistory.length > 0) {
    lines.push("");
    lines.push("Refinements:");
    input.refinementHistory.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.trim()}`);
    });
  }
  lines.push("");
  lines.push("Thread excerpt:");
  lines.push(buildThreadExcerpt(input.messages));
  return lines.join("\n");
}

export type ApproveDependencies = { yamlPath?: string };

// Pure work function — separated from the Hono route for direct testing.
export async function approveFeedback(
  rawInput: unknown,
  deps: ApproveDependencies = {}
): Promise<ApproveResult> {
  let input: ApproveRequest;
  try {
    input = approveRequestSchema.parse(rawInput);
  } catch (err: any) {
    return { ok: false, stage: "validation", error: `Request invalid: ${err?.message || err}` };
  }

  const yamlPath = deps.yamlPath ?? resolveKnowledgePath(KNOWLEDGE_FILE_NAME);
  if (!yamlPath) {
    return { ok: false, stage: "yaml_parse", error: "Knowledge YAML file not found on disk." };
  }

  return withFeedbackLock(async () => {
    let currentYaml: string;
    try {
      currentYaml = readFileSync(yamlPath, "utf-8");
    } catch (err: any) {
      return {
        ok: false as const,
        stage: "yaml_parse" as const,
        error: `Could not read knowledge YAML: ${err?.message || err}`
      };
    }

    const preEditPatterns = extractFrozenPatterns(currentYaml);

    let updatedYaml: string;
    try {
      const applied = applyEditOps(currentYaml, input.proposal.edits);
      updatedYaml = applied.updatedYaml;
    } catch (err: any) {
      return {
        ok: false as const,
        stage: "applier" as const,
        error: err?.message || String(err)
      };
    }

    try {
      validateUpdatedYaml(updatedYaml, preEditPatterns);
    } catch (err: any) {
      return {
        ok: false as const,
        stage: "yaml_parse" as const,
        error: err?.message || String(err)
      };
    }

    try {
      const { commitSha, shortSha } = writeAndCommitKnowledgeYaml({
        yamlPath,
        updatedYaml,
        summary: input.proposal.summary,
        bodyText: buildCommitBody(input)
      });
      return {
        ok: true as const,
        commitSha,
        shortSha,
        summary: input.proposal.summary,
        editCount: input.proposal.edits.length
      };
    } catch (err: any) {
      console.error("[knowledge-feedback/approve] git commit failed:", err?.message || err);
      return {
        ok: false as const,
        stage: "git" as const,
        error:
          "Edits saved to the YAML file but not committed. Check `git status` in the circuit working tree."
      };
    }
  });
}

export const knowledgeFeedbackApproveRoute = registerApiRoute("/knowledge-feedback/approve", {
  method: "POST",
  requiresAuth: false,
  handler: async (c) => {
    const body = await c.req.json();
    const result = await approveFeedback(body);
    return c.json(result, result.ok ? 200 : statusCodeForStage(result.stage));
  }
});

function statusCodeForStage(stage: "validation" | "applier" | "yaml_parse" | "git" | "network"): 400 | 422 | 500 {
  if (stage === "validation") return 400;
  if (stage === "applier" || stage === "yaml_parse") return 422;
  return 500;
}
```

- [ ] **Step 4.5 — Run approve route test to verify it passes**

Run from `/Users/aditipatel/sandbox/circuit/`:

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackApproveRoute.test.ts
```

Expected output (final line): `feedbackApproveRoute tests passed`

- [ ] **Step 4.6 — Commit**

```bash
git -C /Users/aditipatel/sandbox/circuit add \
  src/mastra/brokering/feedback/feedbackGitCommitter.ts \
  src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts \
  src/mastra/brokering/feedback/knowledgeFeedbackApproveRoute.ts \
  src/mastra/test/brokering/feedback/feedbackApproveRoute.test.ts
git -C /Users/aditipatel/sandbox/circuit commit -m "Added: /knowledge-feedback/approve route + committer bodyText refactor"
```

---

## Task 5: Propose route

**Files:**
- Create: `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackProposeRoute.ts`

- [ ] **Step 5.1 — Create the propose route**

Create `/Users/aditipatel/sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackProposeRoute.ts` with this exact content:

```typescript
import { registerApiRoute } from "@mastra/core/server";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { applyEditOps } from "./feedbackEditApplier";
import { validateUpdatedYaml, type FrozenPattern } from "./feedbackYamlValidator";
import { resolveKnowledgePath } from "../domain/orderRoutingDomainKnowledge";
import { knowledgeFeedbackProposalInstructions } from "./feedbackGuidelines";
import {
  feedbackAgentResponseSchema,
  type FeedbackAgentResponse
} from "./feedbackEditOpsSchema";
import {
  proposeRequestSchema,
  type ProposalResult,
  type ProposeRequest
} from "./feedbackProposalSchema";
import { describeEdits } from "./feedbackOpDescriber";
import { parse } from "yaml";
import { readServerEnv } from "../env";

const KNOWLEDGE_FILE_NAME = "hotwax_order_routing_domain_knowledge.yaml";

function extractFrozenPatterns(yamlText: string): FrozenPattern[] {
  const parsed = parse(yamlText);
  const list = Array.isArray(parsed?.diagnostic_patterns) ? parsed.diagnostic_patterns : [];
  return list
    .filter((p: any) => p && typeof p.id === "string")
    .map((p: any) => ({
      id: p.id,
      intent: String(p.intent || ""),
      requires: Array.isArray(p.requires) ? p.requires.map(String) : []
    }));
}

export type ProposeDependencies = {
  yamlPath?: string;
  generateAgentResponse?: (userMessage: string) => Promise<FeedbackAgentResponse>;
};

export async function proposeFeedback(
  rawInput: unknown,
  agentForDefault: { generate: Function } | null,
  deps: ProposeDependencies = {}
): Promise<ProposalResult> {
  let input: ProposeRequest;
  try {
    input = proposeRequestSchema.parse(rawInput);
  } catch (err: any) {
    return { ok: false, stage: "validation", error: `Request invalid: ${err?.message || err}` };
  }

  const yamlPath = deps.yamlPath ?? resolveKnowledgePath(KNOWLEDGE_FILE_NAME);
  if (!yamlPath) {
    return { ok: false, stage: "applier_dry_run", error: "Knowledge YAML file not found on disk." };
  }

  let currentYaml: string;
  try {
    currentYaml = readFileSync(yamlPath, "utf-8");
  } catch (err: any) {
    return { ok: false, stage: "applier_dry_run", error: `Could not read knowledge YAML: ${err?.message || err}` };
  }

  const preEditPatterns = extractFrozenPatterns(currentYaml);

  const userMessageBody = JSON.stringify({
    currentYaml,
    thread: input.messages,
    userCorrection: input.userCorrection,
    correctionCategory: input.correctionCategory ?? null,
    context: input.context ?? null
  });

  let agentResult: FeedbackAgentResponse;
  try {
    if (deps.generateAgentResponse) {
      agentResult = await deps.generateAgentResponse(userMessageBody);
    } else {
      if (!agentForDefault) {
        return { ok: false, stage: "llm", error: "Feedback agent not available." };
      }
      const result = await agentForDefault.generate(
        [{ role: "user" as const, content: userMessageBody }],
        {
          maxSteps: 1,
          instructions: knowledgeFeedbackProposalInstructions,
          structuredOutput: { schema: feedbackAgentResponseSchema, errorStrategy: "strict" }
        }
      );
      agentResult = result.object as FeedbackAgentResponse;
    }
  } catch (err: any) {
    console.warn("[knowledge-feedback/propose] agent call failed:", err?.message || err);
    return { ok: false, stage: "llm", error: "Circuit could not process the feedback. Try rephrasing." };
  }

  // Dry-run: apply + validate without writing.
  if (agentResult.edits.length > 0) {
    try {
      const applied = applyEditOps(currentYaml, agentResult.edits);
      validateUpdatedYaml(applied.updatedYaml, preEditPatterns);
    } catch (err: any) {
      console.warn("[knowledge-feedback/propose] applier/validator rejected edits:", err?.message || err);
      console.warn("[knowledge-feedback/propose] agent response was:", JSON.stringify(agentResult));
      return {
        ok: false,
        stage: "applier_dry_run",
        error: "Circuit suggested invalid edits. Try rephrasing."
      };
    }
  }

  const editDescriptions = describeEdits(currentYaml, agentResult.edits);

  return {
    ok: true,
    proposal: {
      proposalId: randomUUID(),
      summary: agentResult.summary,
      rationale: agentResult.rationale,
      edits: agentResult.edits,
      editDescriptions
    }
  };
}

export const knowledgeFeedbackProposeRoute = registerApiRoute("/knowledge-feedback/propose", {
  method: "POST",
  requiresAuth: false,
  handler: async (c) => {
    if (!readServerEnv("OPENAI_API_KEY")) {
      return c.json(
        { ok: false, stage: "llm", error: "Feedback assistant API key is not configured." },
        503
      );
    }
    const body = await c.req.json();
    const mastraInstance = c.get("mastra");
    const agent = mastraInstance.getAgent("knowledgeFeedbackAgent");
    const result = await proposeFeedback(body, agent);
    const status = result.ok
      ? 200
      : result.stage === "validation"
        ? 400
        : result.stage === "llm"
          ? 502
          : 422;
    return c.json(result, status);
  }
});
```

- [ ] **Step 5.2 — Verify type-check passes**

Run from `/Users/aditipatel/sandbox/circuit/`:

```bash
npx tsc --noEmit
```

Expected: no errors in the new file. Pre-existing references to the not-yet-deleted `knowledgeFeedbackRoute.ts` are still fine.

- [ ] **Step 5.3 — Commit**

```bash
git -C /Users/aditipatel/sandbox/circuit add src/mastra/brokering/feedback/knowledgeFeedbackProposeRoute.ts
git -C /Users/aditipatel/sandbox/circuit commit -m "Added: /knowledge-feedback/propose route"
```

---

## Task 6: Refine route

**Files:**
- Create: `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRefineRoute.ts`

- [ ] **Step 6.1 — Create the refine route**

Create `/Users/aditipatel/sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRefineRoute.ts` with this exact content:

```typescript
import { registerApiRoute } from "@mastra/core/server";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { applyEditOps } from "./feedbackEditApplier";
import { validateUpdatedYaml, type FrozenPattern } from "./feedbackYamlValidator";
import { resolveKnowledgePath } from "../domain/orderRoutingDomainKnowledge";
import { knowledgeFeedbackRefinementInstructions } from "./feedbackGuidelines";
import {
  feedbackAgentResponseSchema,
  type FeedbackAgentResponse
} from "./feedbackEditOpsSchema";
import {
  refineRequestSchema,
  type ProposalResult,
  type RefineRequest
} from "./feedbackProposalSchema";
import { describeEdits } from "./feedbackOpDescriber";
import { parse } from "yaml";
import { readServerEnv } from "../env";

const KNOWLEDGE_FILE_NAME = "hotwax_order_routing_domain_knowledge.yaml";

function extractFrozenPatterns(yamlText: string): FrozenPattern[] {
  const parsed = parse(yamlText);
  const list = Array.isArray(parsed?.diagnostic_patterns) ? parsed.diagnostic_patterns : [];
  return list
    .filter((p: any) => p && typeof p.id === "string")
    .map((p: any) => ({
      id: p.id,
      intent: String(p.intent || ""),
      requires: Array.isArray(p.requires) ? p.requires.map(String) : []
    }));
}

export type RefineDependencies = {
  yamlPath?: string;
  generateAgentResponse?: (userMessage: string) => Promise<FeedbackAgentResponse>;
};

export async function refineFeedback(
  rawInput: unknown,
  agentForDefault: { generate: Function } | null,
  deps: RefineDependencies = {}
): Promise<ProposalResult> {
  let input: RefineRequest;
  try {
    input = refineRequestSchema.parse(rawInput);
  } catch (err: any) {
    return { ok: false, stage: "validation", error: `Request invalid: ${err?.message || err}` };
  }

  const yamlPath = deps.yamlPath ?? resolveKnowledgePath(KNOWLEDGE_FILE_NAME);
  if (!yamlPath) {
    return { ok: false, stage: "applier_dry_run", error: "Knowledge YAML file not found on disk." };
  }

  let currentYaml: string;
  try {
    currentYaml = readFileSync(yamlPath, "utf-8");
  } catch (err: any) {
    return { ok: false, stage: "applier_dry_run", error: `Could not read knowledge YAML: ${err?.message || err}` };
  }

  const preEditPatterns = extractFrozenPatterns(currentYaml);

  const userMessageBody = JSON.stringify({
    currentYaml,
    thread: input.messages,
    userCorrection: input.userCorrection,
    correctionCategory: input.correctionCategory ?? null,
    context: input.context ?? null,
    previousProposal: input.previousProposal,
    refinementFeedback: input.refinementFeedback
  });

  let agentResult: FeedbackAgentResponse;
  try {
    if (deps.generateAgentResponse) {
      agentResult = await deps.generateAgentResponse(userMessageBody);
    } else {
      if (!agentForDefault) {
        return { ok: false, stage: "llm", error: "Feedback agent not available." };
      }
      const result = await agentForDefault.generate(
        [{ role: "user" as const, content: userMessageBody }],
        {
          maxSteps: 1,
          instructions: knowledgeFeedbackRefinementInstructions,
          structuredOutput: { schema: feedbackAgentResponseSchema, errorStrategy: "strict" }
        }
      );
      agentResult = result.object as FeedbackAgentResponse;
    }
  } catch (err: any) {
    console.warn("[knowledge-feedback/refine] agent call failed:", err?.message || err);
    return { ok: false, stage: "llm", error: "Circuit could not process the feedback. Try rephrasing." };
  }

  if (agentResult.edits.length > 0) {
    try {
      const applied = applyEditOps(currentYaml, agentResult.edits);
      validateUpdatedYaml(applied.updatedYaml, preEditPatterns);
    } catch (err: any) {
      console.warn("[knowledge-feedback/refine] applier/validator rejected edits:", err?.message || err);
      console.warn("[knowledge-feedback/refine] agent response was:", JSON.stringify(agentResult));
      return {
        ok: false,
        stage: "applier_dry_run",
        error: "Circuit suggested invalid edits. Try rephrasing."
      };
    }
  }

  const editDescriptions = describeEdits(currentYaml, agentResult.edits);

  return {
    ok: true,
    proposal: {
      proposalId: randomUUID(),
      summary: agentResult.summary,
      rationale: agentResult.rationale,
      edits: agentResult.edits,
      editDescriptions
    }
  };
}

export const knowledgeFeedbackRefineRoute = registerApiRoute("/knowledge-feedback/refine", {
  method: "POST",
  requiresAuth: false,
  handler: async (c) => {
    if (!readServerEnv("OPENAI_API_KEY")) {
      return c.json(
        { ok: false, stage: "llm", error: "Feedback assistant API key is not configured." },
        503
      );
    }
    const body = await c.req.json();
    const mastraInstance = c.get("mastra");
    const agent = mastraInstance.getAgent("knowledgeFeedbackAgent");
    const result = await refineFeedback(body, agent);
    const status = result.ok
      ? 200
      : result.stage === "validation"
        ? 400
        : result.stage === "llm"
          ? 502
          : 422;
    return c.json(result, status);
  }
});
```

- [ ] **Step 6.2 — Verify type-check passes**

Run from `/Users/aditipatel/sandbox/circuit/`:

```bash
npx tsc --noEmit
```

Expected: no errors in the new file.

- [ ] **Step 6.3 — Commit**

```bash
git -C /Users/aditipatel/sandbox/circuit add src/mastra/brokering/feedback/knowledgeFeedbackRefineRoute.ts
git -C /Users/aditipatel/sandbox/circuit commit -m "Added: /knowledge-feedback/refine route"
```

---

## Task 7: Delete old route, wire the three new routes

**Files:**
- Delete: `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRoute.ts`
- Modify: `sandbox/circuit/src/mastra/brokering/routes.ts`

- [ ] **Step 7.1 — Delete the old route file**

```bash
rm /Users/aditipatel/sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRoute.ts
```

- [ ] **Step 7.2 — Update routes.ts imports**

Edit `/Users/aditipatel/sandbox/circuit/src/mastra/brokering/routes.ts`:

Find the existing line:

```typescript
import { knowledgeFeedbackRoute } from "./feedback/knowledgeFeedbackRoute";
```

Replace it with:

```typescript
import { knowledgeFeedbackProposeRoute } from "./feedback/knowledgeFeedbackProposeRoute";
import { knowledgeFeedbackRefineRoute } from "./feedback/knowledgeFeedbackRefineRoute";
import { knowledgeFeedbackApproveRoute } from "./feedback/knowledgeFeedbackApproveRoute";
```

- [ ] **Step 7.3 — Update brokeringApiRoutes array**

In the same file, find the `brokeringApiRoutes` export. The last entry is currently:

```typescript
  knowledgeFeedbackRoute
];
```

Replace that entry with:

```typescript
  knowledgeFeedbackProposeRoute,
  knowledgeFeedbackRefineRoute,
  knowledgeFeedbackApproveRoute
];
```

Do not modify the other route entries above.

- [ ] **Step 7.4 — Type-check**

Run from `/Users/aditipatel/sandbox/circuit/`:

```bash
npx tsc --noEmit
```

Expected: zero errors. (The `knowledgeFeedbackInstructions` export no longer exists from feedbackGuidelines.ts — confirm nothing still references that name with `grep -rn "knowledgeFeedbackInstructions" src` and the result is empty.)

- [ ] **Step 7.5 — Run all circuit feedback tests**

```bash
npx tsx src/mastra/test/brokering/feedback/feedbackEditApplier.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackYamlValidator.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackOpDescriber.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackApproveRoute.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackAgentSmoke.test.ts
```

Expected: every script prints its "tests passed" line (smoke test prints "skipped"). If any fails, fix before committing.

- [ ] **Step 7.6 — Commit**

```bash
git -C /Users/aditipatel/sandbox/circuit add src/mastra/brokering/routes.ts \
        src/mastra/brokering/feedback/knowledgeFeedbackRoute.ts
git -C /Users/aditipatel/sandbox/circuit commit -m "Removed: legacy /knowledge-feedback route in favor of propose/refine/approve"
```

(The `git add` here picks up the file deletion as well.)

---

## Task 8: PWA service rewrite (TDD)

**Files:**
- Modify: `apps/order-routing/src/services/CircuitKnowledgeFeedbackService.ts`
- Modify: `apps/order-routing/tests/circuitKnowledgeFeedbackService.test.ts`

- [ ] **Step 8.1 — Write the failing tests**

Replace the entire contents of `/Users/aditipatel/sandbox/accxui/apps/order-routing/tests/circuitKnowledgeFeedbackService.test.ts` with:

```typescript
import assert from "node:assert";
import {
  proposeKnowledgeFeedback,
  refineKnowledgeFeedback,
  approveKnowledgeFeedback
} from "../src/services/CircuitKnowledgeFeedbackService";

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string };

function withMockFetch(impl: (url: string, init: FetchInit) => Promise<Response>) {
  const original = (globalThis as any).fetch;
  (globalThis as any).fetch = (url: string, init: FetchInit) => impl(url, init);
  return () => {
    (globalThis as any).fetch = original;
  };
}

const sampleProposal = {
  proposalId: "p-1",
  summary: "add example to no_route",
  rationale: "user said an example was missing",
  edits: [
    {
      op: "append" as const,
      path: "diagnostic_patterns[0].user_question_examples",
      value: "why didn't this order route?"
    }
  ],
  editDescriptions: [
    {
      op: "append" as const,
      path: "diagnostic_patterns[0].user_question_examples",
      text: 'Add example question to "no_route" pattern: "why didn\'t this order route?"'
    }
  ]
};

// proposeKnowledgeFeedback happy path
async function proposeHappy() {
  let capturedUrl = "";
  let capturedBody: any = null;
  const restore = withMockFetch(async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body || "{}");
    return new Response(JSON.stringify({ ok: true, proposal: sampleProposal }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  try {
    const result = await proposeKnowledgeFeedback({
      messages: [{ role: "user", content: "hi" }],
      userCorrection: "should have done X",
      correctionCategory: "missed_clarifying_question",
      context: { routingGroupId: "rg-1" }
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.proposal.proposalId, "p-1");
      assert.equal(result.proposal.edits.length, 1);
      assert.equal(result.proposal.editDescriptions.length, 1);
    }
    assert.ok(capturedUrl.endsWith("/knowledge-feedback/propose"));
    assert.equal(capturedBody.userCorrection, "should have done X");
    assert.equal(capturedBody.correctionCategory, "missed_clarifying_question");
  } finally {
    restore();
  }
}

// refineKnowledgeFeedback happy path
async function refineHappy() {
  let capturedUrl = "";
  let capturedBody: any = null;
  const restore = withMockFetch(async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body || "{}");
    return new Response(JSON.stringify({ ok: true, proposal: sampleProposal }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  try {
    const result = await refineKnowledgeFeedback({
      messages: [{ role: "user", content: "hi" }],
      userCorrection: "original feedback",
      previousProposal: {
        proposalId: "p-0",
        summary: "old",
        rationale: "old rationale",
        edits: []
      },
      refinementFeedback: "make it shorter"
    });
    assert.equal(result.ok, true);
    assert.ok(capturedUrl.endsWith("/knowledge-feedback/refine"));
    assert.equal(capturedBody.refinementFeedback, "make it shorter");
    assert.equal(capturedBody.previousProposal.proposalId, "p-0");
  } finally {
    restore();
  }
}

// approveKnowledgeFeedback happy path
async function approveHappy() {
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
    const result = await approveKnowledgeFeedback({
      proposal: {
        proposalId: "p-1",
        summary: "add example",
        rationale: "user wanted it",
        edits: sampleProposal.edits
      },
      userCorrection: "original feedback",
      refinementHistory: ["make it shorter"],
      messages: [{ role: "user", content: "hi" }]
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.shortSha, "abc1234");
      assert.equal(result.editCount, 1);
    }
    assert.ok(capturedUrl.endsWith("/knowledge-feedback/approve"));
    assert.equal(capturedBody.userCorrection, "original feedback");
    assert.deepEqual(capturedBody.refinementHistory, ["make it shorter"]);
  } finally {
    restore();
  }
}

// network rejection on propose
async function proposeNetworkRejection() {
  const restore = withMockFetch(async () => {
    throw new Error("ECONNREFUSED");
  });
  try {
    const result = await proposeKnowledgeFeedback({
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

// non-2xx with stage from server on approve
async function approveValidationFailure() {
  const restore = withMockFetch(async () =>
    new Response(JSON.stringify({ ok: false, stage: "applier", error: "yaml changed" }), {
      status: 422,
      headers: { "content-type": "application/json" }
    })
  );
  try {
    const result = await approveKnowledgeFeedback({
      proposal: {
        proposalId: "p-1",
        summary: "x",
        rationale: "x",
        edits: []
      },
      userCorrection: "x",
      messages: [{ role: "user", content: "hi" }]
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "applier");
      assert.equal(result.error, "yaml changed");
    }
  } finally {
    restore();
  }
}

async function main() {
  await proposeHappy();
  await refineHappy();
  await approveHappy();
  await proposeNetworkRejection();
  await approveValidationFailure();
  console.log("circuitKnowledgeFeedbackService tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 8.2 — Run test to verify it fails**

Run from `/Users/aditipatel/sandbox/accxui/apps/order-routing/`:

```bash
npx tsx tests/circuitKnowledgeFeedbackService.test.ts
```

Expected: FAIL on the imports (the new function names don't exist yet).

- [ ] **Step 8.3 — Rewrite the service**

Replace the entire contents of `/Users/aditipatel/sandbox/accxui/apps/order-routing/src/services/CircuitKnowledgeFeedbackService.ts` with:

```typescript
export type KnowledgeFeedbackMessage = {
  role: "user" | "assistant";
  content: string;
};

export type KnowledgeFeedbackContext = {
  routingGroupId?: string | null;
  routingRuleId?: string | null;
  activeContextLabel?: string;
};

export type CorrectionCategory =
  | "wrong_recommendation"
  | "missed_clarifying_question"
  | "misnamed_entity"
  | "should_have_used_tool"
  | "other";

export type EditOp =
  | { op: "append"; path: string; value: unknown }
  | { op: "set"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "insertAt"; path: string; index: number; value: unknown };

export type EditDescription = {
  op: "append" | "set" | "remove" | "insertAt";
  path: string;
  text: string;
};

export type ProposalPayload = {
  proposalId: string;
  summary: string;
  rationale: string;
  edits: EditOp[];
  editDescriptions: EditDescription[];
};

export type CarriedProposal = {
  proposalId: string;
  summary: string;
  rationale: string;
  edits: EditOp[];
};

export type ProposalErrorStage = "validation" | "llm" | "applier_dry_run" | "network";

export type ProposalResult =
  | { ok: true; proposal: ProposalPayload }
  | { ok: false; stage: ProposalErrorStage; error: string };

export type ApproveErrorStage = "validation" | "applier" | "yaml_parse" | "git" | "network";

export type ApproveResult =
  | {
      ok: true;
      commitSha: string;
      shortSha: string;
      summary: string;
      editCount: number;
    }
  | { ok: false; stage: ApproveErrorStage; error: string };

export type ProposeRequest = {
  messages: KnowledgeFeedbackMessage[];
  userCorrection: string;
  correctionCategory?: CorrectionCategory;
  context?: KnowledgeFeedbackContext;
};

export type RefineRequest = ProposeRequest & {
  previousProposal: CarriedProposal;
  refinementFeedback: string;
};

export type ApproveRequest = {
  proposal: CarriedProposal;
  userCorrection: string;
  refinementHistory?: string[];
  messages: KnowledgeFeedbackMessage[];
};

const ENDPOINT_PROPOSE = "/knowledge-feedback/propose";
const ENDPOINT_REFINE = "/knowledge-feedback/refine";
const ENDPOINT_APPROVE = "/knowledge-feedback/approve";

function resolveMastraUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const raw = env.VITE_VUE_APP_MASTRA_URL || "http://localhost:4111";
  return raw.replace(/\/$/, "");
}

const VALID_PROPOSAL_STAGES = new Set<ProposalErrorStage>([
  "validation",
  "llm",
  "applier_dry_run",
  "network"
]);

const VALID_APPROVE_STAGES = new Set<ApproveErrorStage>([
  "validation",
  "applier",
  "yaml_parse",
  "git",
  "network"
]);

async function postProposal(
  endpoint: string,
  body: unknown
): Promise<ProposalResult> {
  const url = `${resolveMastraUrl()}${endpoint}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (err: any) {
    return {
      ok: false,
      stage: "network",
      error: err?.message ? `Circuit unreachable: ${err.message}` : "Circuit unreachable."
    };
  }

  let parsed: any;
  try {
    parsed = await response.json();
  } catch {
    return {
      ok: false,
      stage: "network",
      error: `Unexpected non-JSON response (HTTP ${response.status}).`
    };
  }

  if (!response.ok || parsed?.ok === false) {
    const stage: ProposalErrorStage = VALID_PROPOSAL_STAGES.has(parsed?.stage)
      ? parsed.stage
      : "network";
    return {
      ok: false,
      stage,
      error:
        typeof parsed?.error === "string" && parsed.error
          ? parsed.error
          : `Feedback proposal failed with HTTP ${response.status}`
    };
  }

  return { ok: true, proposal: parsed.proposal as ProposalPayload };
}

export async function proposeKnowledgeFeedback(
  request: ProposeRequest
): Promise<ProposalResult> {
  return postProposal(ENDPOINT_PROPOSE, request);
}

export async function refineKnowledgeFeedback(
  request: RefineRequest
): Promise<ProposalResult> {
  return postProposal(ENDPOINT_REFINE, request);
}

export async function approveKnowledgeFeedback(
  request: ApproveRequest
): Promise<ApproveResult> {
  const url = `${resolveMastraUrl()}${ENDPOINT_APPROVE}`;
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

  let parsed: any;
  try {
    parsed = await response.json();
  } catch {
    return {
      ok: false,
      stage: "network",
      error: `Unexpected non-JSON response (HTTP ${response.status}).`
    };
  }

  if (!response.ok || parsed?.ok === false) {
    const stage: ApproveErrorStage = VALID_APPROVE_STAGES.has(parsed?.stage)
      ? parsed.stage
      : "network";
    return {
      ok: false,
      stage,
      error:
        typeof parsed?.error === "string" && parsed.error
          ? parsed.error
          : `Feedback approval failed with HTTP ${response.status}`
    };
  }

  return {
    ok: true,
    commitSha: String(parsed.commitSha || ""),
    shortSha: String(parsed.shortSha || ""),
    summary: String(parsed.summary || ""),
    editCount: Number(parsed.editCount || 0)
  };
}
```

- [ ] **Step 8.4 — Run test to verify it passes**

Run from `/Users/aditipatel/sandbox/accxui/apps/order-routing/`:

```bash
npx tsx tests/circuitKnowledgeFeedbackService.test.ts
```

Expected output: `circuitKnowledgeFeedbackService tests passed`

- [ ] **Step 8.5 — Commit (inner repo)**

```bash
git -C /Users/aditipatel/sandbox/accxui/apps/order-routing add \
  src/services/CircuitKnowledgeFeedbackService.ts \
  tests/circuitKnowledgeFeedbackService.test.ts
git -C /Users/aditipatel/sandbox/accxui/apps/order-routing commit -m "Refactored: PWA service split into propose/refine/approve"
```

---

## Task 9: PWA modal — review phase, chips, template, refinement loop

**Files:**
- Modify: `apps/order-routing/src/components/circuit/CircuitFeedbackModal.vue`

This is the largest UI change. Replace the whole file.

- [ ] **Step 9.1 — Replace the modal contents**

Replace the entire contents of `/Users/aditipatel/sandbox/accxui/apps/order-routing/src/components/circuit/CircuitFeedbackModal.vue` with:

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
          {{ translate("Pick a category that best describes what went wrong, then fill in the template.") }}
        </p>

        <div class="category-chips">
          <ion-chip
            v-for="cat in categories"
            :key="cat.value"
            :outline="category !== cat.value"
            :color="category === cat.value ? 'primary' : 'medium'"
            @click="selectCategory(cat.value)"
          >
            {{ translate(cat.label) }}
          </ion-chip>
        </div>

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
          :disabled="!canSubmitForm"
          @click="submitProposal"
        >
          <template v-if="isSubmitting">
            <ion-spinner name="dots" />
          </template>
          <template v-else>
            {{ translate("Propose changes") }}
          </template>
        </ion-button>
      </template>

      <template v-else-if="phase === 'review' && proposal">
        <h2 class="review-summary">{{ proposal.summary }}</h2>
        <p class="review-rationale">{{ proposal.rationale }}</p>

        <ion-list class="edit-list" lines="full">
          <ion-item v-for="(desc, i) in proposal.editDescriptions" :key="i">
            <ion-label>
              <p class="edit-text">{{ desc.text }}</p>
              <p class="edit-path"><code>{{ desc.path }}</code></p>
            </ion-label>
          </ion-item>
          <ion-item v-if="proposal.editDescriptions.length === 0">
            <ion-label color="medium">
              {{ translate("Circuit did not propose any edits. Refine or discard.") }}
            </ion-label>
          </ion-item>
        </ion-list>

        <ion-button
          expand="block"
          class="ion-margin-top"
          :disabled="!canApprove"
          @click="submitApprove"
        >
          <template v-if="isSubmitting">
            <ion-spinner name="dots" />
          </template>
          <template v-else>
            {{ translate("Approve and commit") }}
          </template>
        </ion-button>

        <ion-textarea
          v-model="refinementText"
          :auto-grow="true"
          :counter="true"
          :maxlength="1000"
          :placeholder="translate('What still needs to change?')"
          :disabled="isSubmitting"
          fill="outline"
          class="refinement-input"
        />

        <ion-button
          expand="block"
          fill="outline"
          :disabled="!canRefine"
          @click="submitRefine"
        >
          {{ translate("Refine") }}
        </ion-button>

        <ion-button
          expand="block"
          fill="clear"
          color="medium"
          :disabled="isSubmitting"
          @click="discardProposal"
        >
          {{ translate("Discard and start over") }}
        </ion-button>
      </template>

      <template v-else-if="phase === 'success' && successResult">
        <h2>{{ translate("Knowledge base updated") }}</h2>
        <p class="commit-line">
          {{ translate("Commit") }}:
          <code>{{ successResult.shortSha }}</code>
          ({{ successResult.editCount }}
          {{ successResult.editCount === 1 ? translate("edit") : translate("edits") }})
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
        <ion-button expand="block" @click="returnFromError">
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
  IonChip,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar
} from "@ionic/vue";
import { computed, ref, watch } from "vue";
import { translate } from "@common";
import {
  proposeKnowledgeFeedback,
  refineKnowledgeFeedback,
  approveKnowledgeFeedback,
  type ApproveResult,
  type CorrectionCategory,
  type KnowledgeFeedbackContext,
  type KnowledgeFeedbackMessage,
  type ProposalPayload,
  type ProposalResult
} from "@/services/CircuitKnowledgeFeedbackService";

type Phase = "form" | "review" | "success" | "error";

const props = defineProps<{
  isOpen: boolean;
  messages: KnowledgeFeedbackMessage[];
  context?: KnowledgeFeedbackContext;
}>();

const emit = defineEmits<{
  (e: "dismiss"): void;
}>();

const categories: Array<{ value: CorrectionCategory; label: string; template: string }> = [
  {
    value: "wrong_recommendation",
    label: "Wrong recommendation",
    template:
      "Circuit recommended ___. The correct recommendation would have been ___ because ___."
  },
  {
    value: "missed_clarifying_question",
    label: "Missed clarifying question",
    template:
      "Circuit should have asked ___ before answering. The right next question is ___."
  },
  {
    value: "misnamed_entity",
    label: "Misnamed entity",
    template:
      "Circuit referred to ___ as ___. The correct name/id is ___."
  },
  {
    value: "should_have_used_tool",
    label: "Should have used a tool",
    template:
      "Circuit answered from memory but should have called the ___ tool, which would have told it ___."
  },
  { value: "other", label: "Other", template: "" }
];

const phase = ref<Phase>("form");
const category = ref<CorrectionCategory | null>(null);
const userCorrection = ref("");
const proposal = ref<ProposalPayload | null>(null);
const refinementText = ref("");
const refinementHistory = ref<string[]>([]);
const isSubmitting = ref(false);
const successResult = ref<Extract<ApproveResult, { ok: true }> | null>(null);
const errorResult = ref<
  Extract<ProposalResult, { ok: false }> | Extract<ApproveResult, { ok: false }> | null
>(null);
const errorReturnPhase = ref<Phase>("form");

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      resetAll();
    }
  }
);

function resetAll() {
  phase.value = "form";
  category.value = null;
  userCorrection.value = "";
  proposal.value = null;
  refinementText.value = "";
  refinementHistory.value = [];
  isSubmitting.value = false;
  successResult.value = null;
  errorResult.value = null;
  errorReturnPhase.value = "form";
}

function selectCategory(value: CorrectionCategory) {
  category.value = value;
  const tmpl = categories.find((c) => c.value === value)?.template ?? "";
  if (tmpl && !userCorrection.value.trim()) {
    userCorrection.value = tmpl;
  }
}

const canSubmitForm = computed(
  () => userCorrection.value.trim().length > 0 && !isSubmitting.value
);

const canApprove = computed(
  () => !!proposal.value && proposal.value.edits.length > 0 && !isSubmitting.value
);

const canRefine = computed(
  () => !!proposal.value && refinementText.value.trim().length > 0 && !isSubmitting.value
);

async function submitProposal() {
  if (!canSubmitForm.value) return;
  isSubmitting.value = true;
  errorResult.value = null;
  const result = await proposeKnowledgeFeedback({
    messages: props.messages,
    userCorrection: userCorrection.value.trim(),
    correctionCategory: category.value ?? undefined,
    context: props.context
  });
  isSubmitting.value = false;

  if (result.ok) {
    proposal.value = result.proposal;
    phase.value = "review";
  } else {
    errorResult.value = result;
    errorReturnPhase.value = "form";
    phase.value = "error";
  }
}

async function submitRefine() {
  if (!canRefine.value || !proposal.value) return;
  isSubmitting.value = true;
  errorResult.value = null;
  const result = await refineKnowledgeFeedback({
    messages: props.messages,
    userCorrection: userCorrection.value.trim(),
    correctionCategory: category.value ?? undefined,
    context: props.context,
    previousProposal: {
      proposalId: proposal.value.proposalId,
      summary: proposal.value.summary,
      rationale: proposal.value.rationale,
      edits: proposal.value.edits
    },
    refinementFeedback: refinementText.value.trim()
  });
  isSubmitting.value = false;

  if (result.ok) {
    refinementHistory.value.push(refinementText.value.trim());
    refinementText.value = "";
    proposal.value = result.proposal;
    // stay in review
  } else {
    errorResult.value = result;
    errorReturnPhase.value = "review";
    phase.value = "error";
  }
}

async function submitApprove() {
  if (!canApprove.value || !proposal.value) return;
  isSubmitting.value = true;
  errorResult.value = null;
  const result = await approveKnowledgeFeedback({
    proposal: {
      proposalId: proposal.value.proposalId,
      summary: proposal.value.summary,
      rationale: proposal.value.rationale,
      edits: proposal.value.edits
    },
    userCorrection: userCorrection.value.trim(),
    refinementHistory: refinementHistory.value.length ? refinementHistory.value : undefined,
    messages: props.messages
  });
  isSubmitting.value = false;

  if (result.ok) {
    successResult.value = result;
    phase.value = "success";
  } else {
    errorResult.value = result;
    // applier / yaml_parse on approve mean the YAML changed under us — go back to form
    errorReturnPhase.value =
      result.stage === "applier" || result.stage === "yaml_parse" ? "form" : "review";
    phase.value = "error";
  }
}

function discardProposal() {
  proposal.value = null;
  refinementText.value = "";
  refinementHistory.value = [];
  phase.value = "form";
}

function returnFromError() {
  if (errorReturnPhase.value === "form") {
    proposal.value = null;
    refinementHistory.value = [];
  }
  phase.value = errorReturnPhase.value;
  errorResult.value = null;
}

function onDismiss() {
  resetAll();
  emit("dismiss");
}
</script>

<style scoped>
.prompt-label {
  margin-bottom: 12px;
  color: var(--ion-color-medium);
}

.category-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.review-summary {
  margin: 0 0 4px;
}

.review-rationale {
  margin: 0 0 12px;
  color: var(--ion-color-medium);
  white-space: pre-wrap;
}

.edit-list {
  margin-bottom: 12px;
}

.edit-text {
  margin: 0;
  white-space: pre-wrap;
}

.edit-path {
  margin: 4px 0 0;
  font-size: 12px;
}

.edit-path code,
.commit-line code,
.stage-line code {
  background: var(--ion-color-step-50, #f4f5f8);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.refinement-input {
  margin-top: 16px;
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

- [ ] **Step 9.2 — Lint check**

Run from `/Users/aditipatel/sandbox/accxui/apps/order-routing/`:

```bash
npm run lint -- src/components/circuit/CircuitFeedbackModal.vue
```

Expected: no NEW errors. The same `vue/valid-define-props` / `vue/valid-define-emits` warnings that exist on other components in the codebase are expected and acceptable.

- [ ] **Step 9.3 — Manual browser check (deferred — implementer SKIPS, human verifies)**

A subagent implementer should NOT start dev servers or open a browser. After committing, the human will manually verify:

1. Start circuit: `cd /Users/aditipatel/sandbox/circuit && pnpm dev`
2. Start PWA: `cd /Users/aditipatel/sandbox/accxui/apps/order-routing && ionic serve`
3. Open Circuit tab, send a prompt, click the lightbulb (Feedback) header button.
4. Pick a category → see the template appear in the textarea.
5. Type something specific, click "Propose changes" → see the review phase with per-op descriptions.
6. Click "Refine" with a follow-up correction → stay in review with new content.
7. Click "Approve and commit" → see the commit short SHA.
8. Verify `git log -1` in `sandbox/circuit/` shows the new commit with the rationale + correction + refinement history in the body.

- [ ] **Step 9.4 — Commit (inner repo)**

```bash
git -C /Users/aditipatel/sandbox/accxui/apps/order-routing add \
  src/components/circuit/CircuitFeedbackModal.vue
git -C /Users/aditipatel/sandbox/accxui/apps/order-routing commit -m "Updated: CircuitFeedbackModal with review phase + refinement loop"
```

---

## Self-review (do after Task 9 commits)

- [ ] **Run all circuit feedback tests:**

```bash
cd /Users/aditipatel/sandbox/circuit && \
npx tsx src/mastra/test/brokering/feedback/feedbackEditApplier.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackYamlValidator.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackOpDescriber.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackApproveRoute.test.ts && \
npx tsx src/mastra/test/brokering/feedback/feedbackAgentSmoke.test.ts
```

Expected: every script prints its "tests passed" line (smoke test prints "skipped").

- [ ] **Run PWA service test:**

```bash
cd /Users/aditipatel/sandbox/accxui/apps/order-routing && \
npx tsx tests/circuitKnowledgeFeedbackService.test.ts
```

Expected: `circuitKnowledgeFeedbackService tests passed`

- [ ] **Final tsc on circuit:**

```bash
cd /Users/aditipatel/sandbox/circuit && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Confirm acceptance criteria from the spec.** Walk through `docs/superpowers/specs/2026-05-26-knowledge-feedback-loop-phase-2-design.md`'s acceptance criteria list against the implementation. Every bullet should be satisfied.

- [ ] **If anything fails, fix in a new task and re-run.** Do not declare complete with red tests.
