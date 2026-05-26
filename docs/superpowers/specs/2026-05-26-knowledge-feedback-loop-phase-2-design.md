# Knowledge Feedback Loop — Phase 2 (Approval + Assisted Authoring) Design Spec

**Date:** 2026-05-26
**Author:** toaditi
**Status:** Approved — ready for implementation
**Supersedes (parts of):** `2026-05-26-knowledge-feedback-loop-design.md`

---

## Context

Phase 1 shipped the conversation-level feedback loop end-to-end: a chat header button opens a modal, the user types "what should have happened", and the server's feedback agent proposes structured edits to `hotwax_order_routing_domain_knowledge.yaml`, applies them, validates, and **auto-commits** the change.

Phase 1's auto-commit was a deliberate choice to keep the MVP simple, but it's the wrong long-term default. The system writes to a shared knowledge file that affects every Circuit user's behavior. We want a human-in-the-loop check before any edit lands.

This spec covers three changes:

1. **Approval flow** — the agent proposes edits, the modal shows the proposal, the user approves (or asks for refinement) before anything is committed.
2. **Refinement-in-the-loop** — while reviewing a proposal, the user can send additional feedback to the agent to refine it. This is iterative within the same modal session.
3. **Assisted authoring** — the modal scaffolds the user's input with a structured prompt template and quick-pick correction categories so feedback arrives in a more useful shape.

Auth gating ("HotWax users only") is **deferred** — it will be handled via Moqui permissions on the OMS side and is out of scope here.

---

## Goals

- Replace Phase 1's single-shot auto-commit with a propose → review (refine?)* → approve workflow, all inside the existing feedback modal.
- Make refinement first-class: the user can iterate with the agent multiple times before approving.
- Reduce the cognitive load of writing useful feedback by scaffolding the form with a template + correction categories.
- Preserve every safety property from Phase 1 (frozen-field guard, structural validator, AST-preserving applier, atomic write, git commit).
- Keep the server stateless — the PWA carries the proposal between propose/refine/approve calls; no server-side draft storage.

## Non-goals

- Auth / permission checks. Handled later via Moqui.
- A standalone inbox or review queue for submitted proposals. Approval is in-modal-only.
- Server-side rate limiting, audit logs beyond the git commit history, or multi-user collaboration on a single proposal.
- Backwards compatibility with the Phase 1 `POST /knowledge-feedback` endpoint. It is removed.
- Diff rendering beyond a human-readable per-op description list (no inline YAML diff viewer, no syntax highlighting).
- Pre-approval persistence of in-flight proposals (refresh the modal = start over).

---

## Architecture overview

### Endpoint split (circuit server)

The current `POST /knowledge-feedback` route is replaced by three new routes that share most of their machinery:

| Endpoint | Reads YAML | Calls agent | Mutates YAML | Git commits |
|---|---|---|---|---|
| `POST /knowledge-feedback/propose` | yes | yes | no | no |
| `POST /knowledge-feedback/refine` | yes | yes | no | no |
| `POST /knowledge-feedback/approve` | yes | no | yes | yes |

The applier, validator, and git committer modules from Phase 1 are reused unchanged. The agent module (`feedbackAgent`) is reused; the guidelines (`feedbackGuidelines`) are extended with a refinement prompt section.

### Modal flow (PWA)

```
[opens]
   │
   ▼
┌──────────────────────────────────────────────────────────┐
│  Phase: form                                              │
│                                                          │
│  - Correction-category chips (single-select)             │
│  - Pre-filled structured template in the textarea        │
│  - "Submit for proposal" button                          │
└──────────────────────────────────────────────────────────┘
   │ POST /propose
   ▼
┌──────────────────────────────────────────────────────────┐
│  Phase: review                                            │
│                                                          │
│  - Headline: agent's summary                             │
│  - Per-op descriptions (1 line each)                     │
│  - Approve button   → POST /approve  → phase: success    │
│  - Refinement textarea                                   │
│  - "Refine" button  → POST /refine   → phase: review *   │
│                                       (loops with new    │
│                                        proposal)         │
│  - Discard button   → phase: form (preserves user text)  │
└──────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────┐
│  Phase: success                                           │
│                                                          │
│  - "Knowledge base updated" + short SHA + summary        │
│  - "Done" → emit dismiss                                 │
└──────────────────────────────────────────────────────────┘

(error phase: stage-tagged message + "Try again" → form, preserving text)
```

### Stateless server, PWA carries proposal

The server never persists a draft proposal. The propose and refine endpoints each return the full proposal payload; the PWA holds it in component state and includes it in the next request. This avoids server-side cleanup, locks, and TTL machinery — at the cost of a slightly larger request body. Proposals are small (typically 3-10 edits), so the cost is negligible.

---

## File map

### Circuit server (`/Users/aditipatel/sandbox/circuit`)

| Status | Path | Responsibility |
|---|---|---|
| **Modify** | `src/mastra/brokering/feedback/feedbackGuidelines.ts` | Split into two exported instruction strings: `knowledgeFeedbackProposalInstructions` and `knowledgeFeedbackRefinementInstructions` |
| **Create** | `src/mastra/brokering/feedback/feedbackProposalSchema.ts` | Zod schemas for propose/refine/approve request + response bodies (built on the existing `editOpSchema`) |
| **Create** | `src/mastra/brokering/feedback/feedbackOpDescriber.ts` | Pure function: given `EditOp[]` and the current YAML, return per-op human-readable descriptions |
| **Create** | `src/mastra/brokering/feedback/knowledgeFeedbackProposeRoute.ts` | `POST /knowledge-feedback/propose` |
| **Create** | `src/mastra/brokering/feedback/knowledgeFeedbackRefineRoute.ts` | `POST /knowledge-feedback/refine` |
| **Create** | `src/mastra/brokering/feedback/knowledgeFeedbackApproveRoute.ts` | `POST /knowledge-feedback/approve` |
| **Delete** | `src/mastra/brokering/feedback/knowledgeFeedbackRoute.ts` | Replaced by the three new routes |
| **Modify** | `src/mastra/brokering/routes.ts` | Replace `knowledgeFeedbackRoute` import + export entry with the three new routes |
| **Create** | `src/mastra/test/brokering/feedback/feedbackOpDescriber.test.ts` | Unit tests for the describer |
| **Create** | `src/mastra/test/brokering/feedback/feedbackApproveRoute.test.ts` | Tmp-repo integration test that calls the approve handler with a fixture `EditOp[]` and verifies write + commit + response (no LLM involved) |

### PWA (`/Users/aditipatel/sandbox/accxui/apps/order-routing`)

| Status | Path | Responsibility |
|---|---|---|
| **Modify** | `src/services/CircuitKnowledgeFeedbackService.ts` | Replace `submitKnowledgeFeedback` with three functions: `proposeKnowledgeFeedback`, `refineKnowledgeFeedback`, `approveKnowledgeFeedback`. Add new types for proposal payload. |
| **Modify** | `src/components/circuit/CircuitFeedbackModal.vue` | Add `review` phase; chips + template in `form`; refinement textarea + Approve/Discard buttons in `review`. |
| **Modify** | `tests/circuitKnowledgeFeedbackService.test.ts` | Replace the single happy-path test with one per new function; keep the error-stage assertions. |

---

## Server contracts

All three endpoints share the same `KnowledgeFeedbackMessage` and `KnowledgeFeedbackContext` shapes from Phase 1.

### `POST /knowledge-feedback/propose`

Request:

```typescript
{
  messages: KnowledgeFeedbackMessage[];        // full chat thread
  userCorrection: string;                       // assembled from template + chips + free text
  correctionCategory?: CorrectionCategory;      // one of the chip values, if selected
  context?: KnowledgeFeedbackContext;
}
```

Response (success):

```typescript
{
  ok: true;
  proposalId: string;                           // uuid; opaque to PWA, echoed by refine/approve
  summary: string;                              // agent's <=72 char headline (will be commit subject if approved)
  rationale: string;                            // agent's prose explanation
  edits: EditOp[];                              // structured ops (Zod-validated, applier-validated)
  editDescriptions: EditDescription[];          // human-readable per-op summaries
}
```

Where:

```typescript
type EditDescription = {
  op: "append" | "set" | "remove" | "insertAt";
  path: string;
  // A short sentence describing the change in domain terms, e.g.
  //   "Append clarifying question 'is the product store id known?' to no_route pattern"
  //   "Replace recommendation template on high_unfillable_rate"
  //   "Remove example question from no_route pattern (was: 'why didn't order X route?')"
  text: string;
};
```

Response (failure): `{ ok: false, stage, error }` with stages: `validation`, `llm`, `applier_dry_run`. (See "Error handling" below.)

Behavior:
1. Validate request body (Zod).
2. Read the YAML from disk via the shared resolver.
3. Build the LLM prompt: proposal instructions + current YAML + thread + user correction + category + context.
4. Call the agent with `feedbackAgentResponseSchema` (same Zod schema as Phase 1; `summary`, `rationale`, `edits`).
5. **Dry-run apply** the edits against the YAML in memory (no write) and run the validator. If either fails, return `stage: applier_dry_run`. This catches invalid edits **before** showing them to the user.
6. Compute `editDescriptions` from the edits + current YAML.
7. Generate a fresh `proposalId` (uuid). Echo it in the response.
8. Return the full proposal payload.

The `proposalId` is purely for client-side tracking and logging. The server does **not** store it.

### `POST /knowledge-feedback/refine`

Request:

```typescript
{
  messages: KnowledgeFeedbackMessage[];
  userCorrection: string;                       // the ORIGINAL feedback (carried from form)
  correctionCategory?: CorrectionCategory;
  context?: KnowledgeFeedbackContext;
  previousProposal: {
    proposalId: string;
    summary: string;
    rationale: string;
    edits: EditOp[];
  };
  refinementFeedback: string;                   // the user's follow-up correction
}
```

Response: same shape as `/propose` success response (new `proposalId`).

Behavior:
1. Validate request body.
2. Read the YAML.
3. Build the LLM prompt: refinement instructions + current YAML + thread + original correction + previous proposal (summary + rationale + edits) + refinement feedback.
4. Call the agent. The agent's task: produce a NEW proposal that addresses both the original correction and the refinement feedback, treating the previous proposal as context for what was tried and what the user wanted changed.
5. Dry-run apply + validate as in propose. Same failure handling.
6. Return a fresh `proposalId` and the new proposal payload.

There is no soft cap on refinement turns. If a user wants to refine 10 times, that's allowed. (The agent's structured output schema enforces brevity per op; runaway proposals are not realistic.)

### `POST /knowledge-feedback/approve`

Request:

```typescript
{
  proposal: {
    proposalId: string;
    summary: string;
    rationale: string;
    edits: EditOp[];
  };
  userCorrection: string;                       // for the commit body
  refinementHistory?: string[];                 // optional, for the commit body — each refinement-feedback string in order
  messages: KnowledgeFeedbackMessage[];         // for the commit body's thread excerpt
}
```

Response (success):

```typescript
{
  ok: true;
  commitSha: string;
  shortSha: string;
  summary: string;
  editCount: number;
}
```

Response (failure): `{ ok: false, stage, error }` with stages: `validation`, `applier`, `yaml_parse`, `git`.

Behavior:
1. Validate request body.
2. Acquire the **shared mutex** (the same per-process lock from Phase 1, reused so propose-dry-run-and-approve cycles cannot race two approves into a half-applied YAML).
3. Read the current YAML.
4. Re-run the applier and validator against the current YAML (do not trust the client). The proposal's edits must still apply cleanly to the current on-disk YAML and pass the frozen-field guard. If anything fails, return the appropriate stage error.
5. Build the commit body:
   ```
   <rationale>

   User correction:
   <userCorrection>

   [if refinementHistory non-empty:]
   Refinements:
   1. <refinementHistory[0]>
   2. <refinementHistory[1]>
   ...

   Thread excerpt:
   - user: ...
   - assistant: ...
   ```
6. Hand off to `writeAndCommitKnowledgeYaml`. If the commit fails, return `stage: git` (same semantics as Phase 1 — file is updated, no commit).

### Why re-validate inside `/approve`?

The proposed edits were valid at propose time. But the YAML on disk could have changed in between (another user landed a proposal, or an operator hand-edited the file). The re-validation guarantees the approval lands against the YAML state it was actually computed against; if it doesn't, the user gets a clear `stage: validation` error and can re-propose.

This is the single point where stateless multi-step coordination meets the shared mutable resource. The mutex serializes `/approve` calls, but doesn't help across propose-and-approve windows — that's what re-validation is for.

### Correction categories

Defined as a small enum on the server, shared with the PWA via the response:

```typescript
type CorrectionCategory =
  | "wrong_recommendation"        // "Circuit recommended X but should have recommended Y"
  | "missed_clarifying_question"  // "Circuit should have asked about Z first"
  | "misnamed_entity"             // "Circuit referred to rule/group/facility by wrong name"
  | "should_have_used_tool"       // "Circuit answered from memory instead of calling a tool"
  | "other";                      // free-form
```

The category is included in the LLM prompt as a hint (the agent's guidelines explain how each category should shape its proposal) but is not used to switch model behavior — it's an advisory signal.

---

## PWA contracts

### Updated service

`apps/order-routing/src/services/CircuitKnowledgeFeedbackService.ts` exposes three functions (replacing `submitKnowledgeFeedback`):

```typescript
export async function proposeKnowledgeFeedback(
  request: ProposeRequest
): Promise<ProposalResult>;

export async function refineKnowledgeFeedback(
  request: RefineRequest
): Promise<ProposalResult>;

export async function approveKnowledgeFeedback(
  request: ApproveRequest
): Promise<ApprovalResult>;
```

Types mirror the server contracts above. `ProposalResult` is either `{ ok: true; proposal: ProposalPayload }` or `{ ok: false; stage; error }`. `ApprovalResult` is either `{ ok: true; commitSha; shortSha; summary; editCount }` or `{ ok: false; stage; error }`.

Network and JSON-parse failures still map to `{ ok: false, stage: "network", ... }` as in Phase 1.

### Updated modal

`apps/order-routing/src/components/circuit/CircuitFeedbackModal.vue` gains:

**Form phase additions:**

- A row of correction-category chips (`<ion-chip>` with `selectable`). Single-select. Selection updates a `category` ref and pre-fills the textarea with a category-specific template:
  - `wrong_recommendation` → `"Circuit recommended ___. The correct recommendation would have been ___ because ___."`
  - `missed_clarifying_question` → `"Circuit should have asked ___ before answering. The right next question is ___."`
  - `misnamed_entity` → `"Circuit referred to ___ as ___. The correct name/id is ___."`
  - `should_have_used_tool` → `"Circuit answered from memory but should have called the ___ tool, which would have told it ___."`
  - `other` → empty textarea (no template).
- The "Send feedback" button is renamed to "Propose changes". On click, calls `proposeKnowledgeFeedback` and transitions to `review` on success.

**Review phase (new):**

- Headline: the proposal's `summary` (one line).
- Sub-headline: `rationale` (collapsible if >3 lines).
- A list of `editDescriptions` rendered as `<ion-item>` rows, one per op. The full path is shown in monospace as a hint, the human-readable `text` is the primary label.
- An "Approve" button (calls `approveKnowledgeFeedback`).
- A textarea labelled "What still needs to change?" and a "Refine" button (calls `refineKnowledgeFeedback`). On a successful refine, the modal stays in `review` with the new proposal contents; the refinement textarea is cleared and ready for further input.
- A "Discard and start over" button. Returns to `form` with the user's original correction text restored, the category preserved, and the proposal cleared.

**State carried in the modal:**

```typescript
const phase = ref<"form" | "review" | "success" | "error">("form");
const category = ref<CorrectionCategory | null>(null);
const userCorrection = ref("");
const proposal = ref<ProposalPayload | null>(null);
const refinementText = ref("");
const refinementHistory = ref<string[]>([]);  // strings of accepted refinements, in order
const successResult = ref<...>(null);
const errorResult = ref<...>(null);
```

`refinementHistory` is appended each time a refinement succeeds (before swapping in the new proposal) so the eventual approve call can include the full history in the commit body.

**Success phase:** unchanged from Phase 1.

**Error phase:** unchanged from Phase 1 except the "Try again" button returns to whichever phase the user was in when the error happened (form or review). If the error stage is `validation`/`applier`/`yaml_parse`/`git`, the user is bounced back to `review` if a proposal exists, otherwise `form`. `network`/`llm` errors during propose go back to `form`.

---

## Guidelines: split into proposal + refinement

`feedbackGuidelines.ts` currently exports `knowledgeFeedbackInstructions`. Replace with two exports:

### `knowledgeFeedbackProposalInstructions`

Identical to the current `knowledgeFeedbackInstructions` plus two new lines:

- A new line near the top explaining the `correctionCategory` field and how each category should bias edit selection:
  - `wrong_recommendation` → prefer `set` on the recommendation template or `append` to `rejection_diagnoses`
  - `missed_clarifying_question` → prefer `append` to `appropriate_clarifying_questions`
  - `misnamed_entity` → prefer `append` to `user_question_examples` showing the right name, or `set` on a specific scalar
  - `should_have_used_tool` → prefer `append` to `requires` (only if the tool is in the canonical list) or update the `recommendation_format` to require the tool
  - `other` → no bias
- Add a line: "Bias toward 1-5 edits. If the correction is large enough to need more than 5 edits, return the highest-leverage 5 and explain the trade-off in the rationale."

### `knowledgeFeedbackRefinementInstructions`

A new instruction set used by `/refine`. Includes the same structural / frozen-field / domain-voice rules as proposal, plus:

- "You are refining a PREVIOUS proposal based on additional feedback from the user. The previous proposal's summary, rationale, and edits are included in the user message JSON."
- "Treat the previous proposal as a starting point. The user accepted the GOAL of the previous proposal but wants something changed about HOW it gets there. Read the refinement feedback carefully — it tells you what to change."
- "If the refinement asks for a smaller change (fewer edits, a different path), shrink the proposal. If it asks for a broader change, expand it. If it asks for a completely different approach, replace the proposal."
- "The new proposal must stand on its own — do not produce diffs against the previous proposal. Return the full set of edits you want applied."
- "If the refinement feedback is unclear or contradicts the original correction, return zero edits with a summary explaining the conflict."

---

## Op describer

`feedbackOpDescriber.ts` exports a single function:

```typescript
export function describeEdits(currentYaml: string, edits: EditOp[]): EditDescription[];
```

For each op, build a short sentence by parsing the path, locating the surrounding context in the YAML (the pattern's `id` if the path is inside `diagnostic_patterns[N]`), and templating a description.

Patterns to cover:

| Op + path shape | Description template |
|---|---|
| `append` to `diagnostic_patterns[N].user_question_examples` | `Add example question to "{id}" pattern: "{value}"` |
| `append` to `diagnostic_patterns[N].appropriate_clarifying_questions` | `Add clarifying question to "{id}" pattern: "{value}"` |
| `append` to `diagnostic_patterns[N].inappropriate_clarifying_questions` | `Mark question as inappropriate for "{id}" pattern: "{value}"` |
| `append` to `diagnostic_patterns[N].diagnostic_levers` | `Add diagnostic lever to "{id}" pattern: "{value.lever}"` |
| `set` on `diagnostic_patterns[N].recommendation_format.must_open_with` | `Replace recommendation opener for "{id}" pattern` |
| `set` on any other path | `Replace value at {path}` |
| `remove` of `diagnostic_patterns[N]` | `Remove "{id}" pattern entirely` |
| `remove` of `diagnostic_patterns[N].something[M]` | `Remove item M from {something} on "{id}" pattern` |
| `insertAt` to any path | Same as `append` template with `(at position N)` suffix |
| Anything else | `Update {path}` (fallback) |

The describer is best-effort — its output is purely for human display. Tests cover the common cases and the fallback.

---

## Error handling

| Stage | Endpoint | When it fires | What the modal does |
|---|---|---|---|
| `network` | any | fetch / JSON parse failure | "Couldn't reach Circuit. Try again." → button returns to current phase |
| `validation` | propose / refine / approve | request body fails Zod, or proposal carried from PWA fails Zod on approve | "Circuit rejected the request. Try again." → returns to form |
| `llm` | propose / refine | agent throws or returns malformed structured output | "Circuit couldn't process the feedback. Try rephrasing." → returns to form (propose) or stays in review (refine) |
| `applier_dry_run` | propose / refine | dry-run of the agent's edits fails the applier or validator | "Circuit suggested invalid edits. Try rephrasing." → returns to form / stays in review |
| `applier` | approve | re-applying the (previously valid) proposal fails because the YAML on disk changed since propose | "The knowledge base changed since you saw this proposal. Start over to see the latest." → returns to form (clears proposal) |
| `yaml_parse` | approve | post-apply YAML fails the validator on re-check | same as `applier` |
| `git` | approve | git commit failed; file IS on disk | "Edits saved but not committed. Check `git status` in the circuit working tree." → success phase with empty short SHA (so the user knows something happened) |

The agent's raw response is logged (`console.warn("[knowledge-feedback] agent response was:", ...)`) on every non-`ok` path that involved an agent call, mirroring the Phase 1 logging fix.

---

## Testing

Same convention as Phase 1: `node:assert` + `tsx`-runnable scripts.

### New tests

- `feedbackOpDescriber.test.ts` — fixture YAML + 6-8 sample `EditOp[]` covering each describer template + the fallback. Asserts exact strings.
- `feedbackApproveRoute.test.ts` — in-process integration test (no LLM): builds a tmp git repo with a copy of the real `hotwax_order_routing_domain_knowledge.yaml`, hand-crafts an `EditOp[]` that should apply cleanly, invokes the approve handler (calling its exported handler function directly, not through Hono), and asserts the YAML was updated and a commit landed.

### Updated tests

- `circuitKnowledgeFeedbackService.test.ts` (PWA) — replace the single happy-path test with three (one per new function). Keep the network / non-2xx / malformed-JSON cases for at least `proposeKnowledgeFeedback` (the test surface is the same for all three).

### Reused tests (no change)

- `feedbackEditApplier.test.ts` — passes unchanged.
- `feedbackYamlValidator.test.ts` — passes unchanged.
- `feedbackGitCommitter.test.ts` — passes unchanged.
- `feedbackAgentSmoke.test.ts` — passes unchanged (still gated by `RUN_LLM_TESTS=1`).

---

## Migration from Phase 1

Phase 1's `POST /knowledge-feedback` route + `knowledgeFeedbackRoute.ts` file are deleted entirely. The `brokeringApiRoutes` array swaps one entry for three. The `submitKnowledgeFeedback` function and its types are renamed/replaced in the service file. The modal is restructured.

Phase 1's underlying machinery — applier, validator, git committer, agent, Zod schemas, guidelines — is reused unchanged or extended (guidelines split into two).

No data migration is required (Phase 1 left no persisted state beyond YAML edits in git, which stand on their own).

---

## Acceptance criteria

- Clicking the Feedback header button in `CircuitChatCanvas.vue` when at least one message exists opens the modal in `form` phase.
- The form shows correction-category chips and a pre-filled template that updates when a chip is selected.
- Clicking "Propose changes" with a non-empty textarea calls `POST /knowledge-feedback/propose` with `{ messages, userCorrection, correctionCategory?, context? }` and transitions to `review` on a `{ ok: true }` response.
- The review phase displays the proposal's summary, rationale, and the per-op descriptions. The YAML on disk is unchanged at this point — verifiable by inspecting `git status` in the circuit working tree.
- Clicking "Refine" with non-empty refinement text calls `POST /knowledge-feedback/refine` with `{ messages, userCorrection, correctionCategory, context, previousProposal, refinementFeedback }` and replaces the displayed proposal with the new one on success. The original `userCorrection` and `category` are preserved across refinements.
- Clicking "Approve" calls `POST /knowledge-feedback/approve`. On success the YAML on disk is updated, a git commit exists with the agent's summary as the headline, and the modal shows the short SHA. The commit body includes the original correction and the full refinement history.
- For each error stage (`network`, `llm`, `validation`, `applier_dry_run`, `applier`, `yaml_parse`, `git`), the modal displays the corresponding friendly message and routes the user back to the appropriate phase (per the table above) without losing the user's typed correction or refinement.
- The YAML's identity fields (`id`, `intent`, `requires`) for every existing pattern are unchanged across every accepted edit (enforced by the validator inside both propose's dry-run and approve's re-check).
- `feedbackOpDescriber.test.ts`, `feedbackApproveRoute.test.ts`, and the updated PWA service test all pass. The reused Phase 1 tests continue to pass.

---

## Files to create

### Circuit
- `sandbox/circuit/src/mastra/brokering/feedback/feedbackProposalSchema.ts`
- `sandbox/circuit/src/mastra/brokering/feedback/feedbackOpDescriber.ts`
- `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackProposeRoute.ts`
- `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRefineRoute.ts`
- `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackApproveRoute.ts`
- `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackOpDescriber.test.ts`
- `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackApproveRoute.test.ts`

## Files to modify

### Circuit
- `sandbox/circuit/src/mastra/brokering/feedback/feedbackGuidelines.ts` — split into two exported instruction strings
- `sandbox/circuit/src/mastra/brokering/routes.ts` — replace one route import + export with three

### PWA
- `apps/order-routing/src/services/CircuitKnowledgeFeedbackService.ts` — replace one function with three; update types
- `apps/order-routing/src/components/circuit/CircuitFeedbackModal.vue` — add review phase, chips, template, refinement loop
- `apps/order-routing/tests/circuitKnowledgeFeedbackService.test.ts` — split tests by function

## Files to delete

### Circuit
- `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRoute.ts`
