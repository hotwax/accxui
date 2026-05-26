# Knowledge Feedback Loop — Design Spec

**Date:** 2026-05-26
**Author:** toaditi
**Status:** Approved — ready for implementation

---

## Context

Circuit's brokering agents lean on a single YAML knowledge base — `sandbox/circuit/src/mastra/brokering/domain/knowledge/hotwax_order_routing_domain_knowledge.yaml` — loaded as advisory context by `orderRoutingDomainKnowledge.ts`. The YAML drives diagnostic patterns, clarifying questions, reasoning workflows, and recommendation formats for the inquiry and draft agents.

Today there is **no path** for end users to teach the system when it gets something wrong. A per-proposal feedback record (`CircuitDraftFeedbackService` + IndexedDB `draftFeedback` store) is captured when a draft is discarded, but nothing reads it back and nothing affects the YAML. Improving the knowledge base requires an engineer to manually edit YAML and ship a new circuit build.

This spec adds a **conversation-level feedback loop**: a button in the Circuit chat that lets a user describe what should have happened, attaches the current thread automatically, and dispatches both to a feedback agent on the circuit server. The agent proposes structured edits to the YAML; the server applies them, validates the result, and git-commits the change. The PWA gets back a confirmation with the commit hash.

This is distinct from the existing draft-proposal feedback loop and does not replace it.

---

## Goals

- One-click conversation-level feedback from Circuit users.
- Automated edits to the YAML knowledge base, gated by structural validation and guideline-driven LLM behavior.
- Every accepted edit is a separate git commit, with a descriptive message, so the YAML's history is itself an audit log.
- Safe-by-default: bad LLM output, broken YAML, or git failures must not silently corrupt the knowledge base or leave the PWA in an ambiguous state.

## Non-goals

- A human review/PR step before YAML edits land. (Out of scope — the user explicitly chose auto-commit.)
- A queue / batch / merge UI for feedback. Feedback is processed synchronously, one at a time, per server process.
- Editing anything outside `hotwax_order_routing_domain_knowledge.yaml`. The agent does not touch code, schemas, or other domain assets.
- Replacing or migrating the existing `CircuitDraftFeedbackService` per-proposal feedback. That stays as-is.
- Production-grade deployment of the feedback endpoint. Circuit currently runs locally only; this design assumes the server has filesystem write access and git available in its working tree.

---

## Architecture overview

Two new surfaces, both small additions to existing structure.

### PWA (`apps/order-routing/src/`)

- **`CircuitChatCanvas.vue`** — adds one header button (icon + tooltip) visible whenever `messages.length > 0`. Click opens the feedback modal.
- **`CircuitFeedbackModal.vue`** *(new)* — single-textarea modal. Captures the user's "what should have happened" text and submits.
- **`CircuitKnowledgeFeedbackService.ts`** *(new)* — POSTs `{ messages, userCorrection, context }` to circuit and returns a typed result.

### Circuit server (`sandbox/circuit/src/mastra/brokering/`)

New parallel folder `feedback/`, mirroring `domain/`, `intent/`, `generation/`:

- **`feedbackAgent.ts`** — Mastra agent config and the `callStructured` wrapper for the feedback agent.
- **`feedbackGuidelines.ts`** — exported system-prompt string with the editing rules (see Guidelines section).
- **`feedbackEditOpsSchema.ts`** — Zod schema for `FeedbackAgentResponse` (summary + rationale + edits).
- **`feedbackEditApplier.ts`** — applies `EditOp[]` to a YAML document using the `yaml` package's AST, preserving comments and formatting.
- **`feedbackYamlValidator.ts`** — after edits are applied, re-parses the YAML and confirms the structural invariants (top-level `diagnosticPatterns` list; each entry has `id`, `intent`, etc.).
- **`feedbackGitCommitter.ts`** — writes the new YAML and runs `git add` + `git commit` for that single file.
- **`knowledgeFeedbackRoute.ts`** — orchestrates the whole flow. Registered in `routes.ts` as `POST /knowledge-feedback`.

---

## Data flow

```
PWA chat: user clicks Feedback button
  ↓
CircuitFeedbackModal opens — user types correction
  ↓
PWA POSTs { messages[], userCorrection, context? } → VUE_APP_MASTRA_URL/knowledge-feedback
  ↓
knowledgeFeedbackRoute:
  - acquire in-process mutex
  - read currentYaml from disk
  - build prompt: guidelines + currentYaml + thread + userCorrection + context
  - call feedbackAgent.callStructured() → FeedbackAgentResponse (Zod-validated)
  - if edits == []: return ok with editCount=0 and summary explaining why
  - else: feedbackEditApplier.apply(currentYamlAst, edits) → newYamlString
  - feedbackYamlValidator.check(newYamlString) → throw if invalid
  - feedbackGitCommitter.writeAndCommit(newYamlString, summary, rationale, thread, userCorrection)
    → { commitSha, shortSha } or throw with stage='git'
  - release mutex
  - return { ok: true, commitSha, shortSha, summary, editCount }
  ↓
Modal shows commit short hash + summary, or error with stage tag
```

---

## PWA contracts

### `CircuitKnowledgeFeedbackService.ts`

```typescript
export type KnowledgeFeedbackMessage = {
  role: 'user' | 'assistant';
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

export type KnowledgeFeedbackStage =
  | 'network'
  | 'llm'
  | 'validation'
  | 'yaml_parse'
  | 'git';

export type KnowledgeFeedbackResult =
  | {
      ok: true;
      commitSha: string;   // empty string when editCount === 0 (no-op)
      shortSha: string;
      summary: string;
      editCount: number;
    }
  | {
      ok: false;
      error: string;
      stage: KnowledgeFeedbackStage;
    };

export function submitKnowledgeFeedback(
  request: KnowledgeFeedbackRequest
): Promise<KnowledgeFeedbackResult>;
```

Implementation hits `${process.env.VUE_APP_MASTRA_URL}/knowledge-feedback`. Maps `fetch` rejections / non-2xx responses to `{ ok: false, stage: 'network', error }`. Otherwise returns the parsed JSON body unchanged.

### `CircuitFeedbackModal.vue`

Props:
- `isOpen: boolean`
- `messages: KnowledgeFeedbackMessage[]` — already-mapped thread excerpt to send
- `context: KnowledgeFeedbackRequest['context']`

Emits:
- `dismiss` — user closed/cancelled

Internal state and behavior:
- One `ion-textarea` bound to `userCorrection`, placeholder "What was supposed to happen? Be specific — what did Circuit get wrong, and what should the correct answer have looked like?"
- "Send feedback" button — disabled while `userCorrection.trim()` is empty or `isSubmitting` is true.
- On submit: set `isSubmitting`, call `submitKnowledgeFeedback`, switch to result view.
- Result view (success): "Knowledge base updated." + `shortSha` + `summary` + Close button. If `editCount === 0`: "No changes made — feedback was too ambiguous." + `summary` + Close.
- Result view (failure): friendly error scoped to `stage` (see Error handling table), plus "Try again" (returns to the form, preserving the typed text) and Close.

### `CircuitChatCanvas.vue` changes

Additions only — no existing behavior is modified.

1. New ref `showFeedbackModal = ref(false)`.
2. New computed `canSendFeedback = computed(() => messages.value.length > 0)`.
3. New helper `buildFeedbackMessages()` — same shape as `buildConversationHistory()` but without the 12-message slice cap (we send the full thread; circuit decides what to use).
4. New header `<ion-button v-if="canSendFeedback" @click="showFeedbackModal = true">` with `bulbOutline` icon and `aria-label="Send feedback to improve Circuit"`. Placed between the existing prompt-modal and threads buttons in the toolbar.
5. New `<CircuitFeedbackModal :is-open="showFeedbackModal" :messages="buildFeedbackMessages()" :context="feedbackContext" @dismiss="showFeedbackModal = false" />` near the existing modals.
6. `feedbackContext` computed from `selectedContext` — passes `routingGroupId`, optional `routingRuleId`, and a human-readable `activeContextLabel` if available.

---

## Circuit server contracts

### Route

`POST /knowledge-feedback`

Request body: `KnowledgeFeedbackRequest` (same shape as PWA type).
Response body: `KnowledgeFeedbackResult` (same shape as PWA type).
Content-Type: `application/json` both directions.

Registered in `routes.ts` next to the existing brokering routes. Uses the same auth/CORS posture as `/brokering-route-assistant`.

### Edit ops schema (Zod)

```typescript
const EditPath = z.string().min(1);
// dotted/bracketed path, e.g. "diagnosticPatterns[2].appropriateClarifyingQuestions"

const EditOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('append'),   path: EditPath, value: z.unknown() }),
  z.object({ op: z.literal('set'),      path: EditPath, value: z.unknown() }),
  z.object({ op: z.literal('remove'),   path: EditPath }),
  z.object({ op: z.literal('insertAt'), path: EditPath, index: z.number().int().min(0), value: z.unknown() }),
]);

const FeedbackAgentResponse = z.object({
  summary: z.string().min(1).max(72),
  rationale: z.string().min(1),
  edits: z.array(EditOp),
});
```

Enforced via Mastra `structuredOutput` with `errorStrategy: "strict"` (same pattern as the existing draft agents in `agents.ts`).

### Applier behavior (`feedbackEditApplier.ts`)

Uses the `yaml` npm package's `Document`/CST API so comments and formatting are preserved across edits.

For each op, walk the path; the path grammar is the small subset already shown above: identifiers, dots, and bracketed integer indices (`foo.bar[3].baz`). The applier exposes a single function:

```typescript
function applyEditOps(yamlSource: string, ops: EditOp[]): {
  updatedYaml: string;
  appliedOps: number;
};
```

Op semantics:

- `append`: target must resolve to a YAML sequence. The value is pushed.
- `set`: target may or may not exist; if missing, the parent must exist. The value replaces the node at that path.
- `remove`: target must exist. For a map key, deletes the key. For a list index, splices the item out.
- `insertAt`: target must resolve to a sequence; `index` may equal `sequence.length` (append-at-end). Out-of-range throws.

Any path-resolution failure throws — the applier never partially mutates the document. The route handler treats applier throws as `stage: 'validation'`.

### Validator behavior (`feedbackYamlValidator.ts`)

After the applier runs, re-parse the updated YAML string from scratch using `yaml.parse()`, then check structural invariants:

1. Root is a map.
2. `diagnosticPatterns` exists and is a non-empty array.
3. Each entry has `id` (string), `intent` (one of the four valid values), `requires` (array of valid `CanonicalToolId`s).
4. Identity fields (`id`, `intent`, `requires`) for every pattern that already existed before the edit still match their pre-edit values. (Catches an agent that bypassed the "frozen fields" guideline.) Adding a brand-new pattern is allowed as long as its `intent` is a valid `DiagnosticPatternIntent` and its `requires` entries are all valid `CanonicalToolId`s.

If any check fails, throw with `stage: 'yaml_parse'`. No write to disk.

### Git committer behavior (`feedbackGitCommitter.ts`)

Uses `simple-git` (small dependency) or raw `child_process.execFile('git', ...)`. Implementation choice deferred to plan; either works. Steps:

1. Confirm the YAML file path is inside a git repository (`rev-parse --is-inside-work-tree`). If not: throw `stage: 'git'` with a clear "not a git repo" message.
2. Write `updatedYaml` to the YAML file via atomic rename (write to `${path}.tmp`, then `rename` to `path`). This is the "stash-style" approach: if step 3 fails, the file has changed on disk but the change is recoverable via `git status` / `git checkout`.
3. `git add <yaml path>` (just this file).
4. `git commit -m "<summary>" -m "<commitBody>"` where `<commitBody>` is built as below.
5. `git rev-parse HEAD` for the full SHA; first 7 chars for short SHA.

Commit body format:

```
<rationale>

User correction:
<userCorrection>

Thread excerpt (last 6 messages):
- user: <content...>
- assistant: <content...>
...
```

No `Co-Authored-By` trailer, no "generated by" marker, no emoji. Commit messages are human-readable history.

### Concurrency

A single in-process `Mutex` (or a simple promise-chain lock) wraps the entire route handler. Justification: the circuit server is local, single-process, and feedback is rare. If a second request arrives mid-flight, it waits for the first to finish.

If the server is restarted between write and commit, the YAML file may have an uncommitted change. That's recoverable by hand (`git status`/`git checkout` in the circuit working tree); no automated recovery is in scope.

---

## Feedback agent guidelines

These rules live in `feedbackGuidelines.ts` as a single exported string used as the system prompt. The agent receives `guidelines + currentYaml + thread + userCorrection + context` and must respond with `FeedbackAgentResponse`.

1. **Preserve structure.** The YAML's top-level is a map containing `diagnosticPatterns` (required). Each pattern has `id`, `userQuestionExamples`, `intent`, `requires`, `diagnosticLevers`, `appropriateClarifyingQuestions`, `inappropriateClarifyingQuestions`, optional `recommendationFormat`, `reasoningWorkflow`, `rejectionDiagnoses`. Do not reshape the schema.
2. **Never edit identity fields.** `id`, `intent`, and `requires` are frozen — they map to TypeScript enums and tool IDs in `orderRoutingDomainKnowledge.ts`.
3. **Prefer adding over rewriting.** When the feedback clarifies behavior, prefer `append` to lists (`userQuestionExamples`, `appropriateClarifyingQuestions`, `diagnosticLevers`, etc.) rather than `set` on prose fields.
4. **`set` is allowed for narrow corrections.** If the feedback says a specific recommendation template is wrong, you may `set` that specific path. Never `set` a whole pattern at once — break it into minimal edits.
5. **`remove` only when the feedback explicitly says an entry is wrong.** Never remove because the feedback is silent about something.
6. **Match the user's words but in domain voice.** Don't paste the user's raw correction text into the YAML. Rephrase to the surrounding style (terse, third-person, no "I"/"you").
7. **One pattern at a time, usually.** Scope edits to the pattern that the conversation was about. If the feedback touches multiple patterns, that's allowed but should be obvious from the thread.
8. **If you can't confidently locate where the correction belongs, return zero edits.** Provide a `summary` explaining why. The server reports this as a no-op success and the user is told to be more specific.
9. **`summary` is the commit headline.** ≤72 chars, present tense, lowercase first letter unless it's a proper noun. Example: `"add 'safety stock priority' to no-route diagnostic levers"`.
10. **`rationale` is the commit body.** 2-4 lines explaining which paths changed and why, citing the user's correction.

---

## Error handling

Failures are classified by `stage` in the response. The PWA modal maps stage to user-facing text.

| Stage | When it triggers | YAML state after failure | PWA message |
|---|---|---|---|
| `network` | `fetch` rejects or non-2xx response | Unchanged | "Couldn't reach Circuit. Try again." |
| `llm` | Agent call throws, or response fails Zod parse | Unchanged | "Circuit couldn't process the feedback. Try rephrasing." |
| `validation` | Applier throws on a bad path / wrong node type | Unchanged | "Circuit suggested invalid edits. Try rephrasing." |
| `yaml_parse` | Validator rejects the post-edit YAML (broken structure, frozen field changed) | Unchanged | Same as `validation` |
| `git` | `git add`/`git commit` fails (not a repo, pre-commit hook fails, working tree blocked) | **File was written.** Server reports the path so the user can recover. | "Edits saved to the YAML file but not committed. Check `git status` in the circuit working tree." |

`llm`, `validation`, and `yaml_parse` failures are logged server-side with the raw agent response so an engineer can inspect what the agent attempted. Errors are not surfaced in detail to the PWA (just the friendly message + stage).

### No-op success

If the agent returns `edits: []` with a `summary`, the route handler returns:

```json
{
  "ok": true,
  "commitSha": "",
  "shortSha": "",
  "summary": "<agent's explanation>",
  "editCount": 0
}
```

Modal shows: "No changes made — feedback was too ambiguous." + the `summary`. No commit is created.

---

## Testing

Follows the existing `node:assert` + `tsx`-runnable script convention. No new test runner is introduced.

### Circuit server tests (`sandbox/circuit/src/mastra/test/brokering/feedback/`)

1. **`feedbackEditApplier.test.ts`** — pure unit tests on the applier with a fixture YAML.
   - Each op type happy path (`append`, `set`, `remove`, `insertAt`).
   - Path-resolution failures throw cleanly (`append` to a missing parent; `set` with a missing intermediate key; `remove` of a non-existent path; `insertAt` with out-of-range index).
   - Comments and trailing whitespace in the fixture are preserved across a no-op-equivalent edit.
2. **`feedbackYamlValidator.test.ts`** — apply ops that produce structurally bad YAML and assert rejection.
   - Removing all `diagnosticPatterns` entries.
   - Changing a pattern's `id` (frozen-field guard).
   - Changing a pattern's `intent` to an invalid value.
3. **`feedbackGitCommitter.test.ts`** — in a tmp git repo created in `before`.
   - Happy path: write + commit + verify the returned SHA matches `git rev-parse HEAD`.
   - Commit-failure path: install a failing pre-commit hook and assert the committer throws with `stage: 'git'` and that the file is still updated on disk.
4. **`feedbackAgentSmoke.test.ts`** *(gated by `RUN_LLM_TESTS=1`)* — calls the real feedback agent with a fixture thread + correction and asserts the response parses against the Zod schema. Skipped by default so CI doesn't burn tokens.

### PWA tests (`apps/order-routing/tests/`)

1. **`circuitKnowledgeFeedbackService.test.ts`** — mocks `fetch`, asserts:
   - Request body shape matches the contract.
   - Success response is returned verbatim.
   - Non-2xx and rejected `fetch` map to `{ ok: false, stage: 'network' }`.
   - Malformed JSON in the response maps to `{ ok: false, stage: 'network' }` as well.

No Vue component tests (the PWA has none today; consistent with existing posture).

---

## Acceptance criteria

- Clicking the new header button in `CircuitChatCanvas.vue` when at least one message exists opens `CircuitFeedbackModal.vue`.
- Submitting the modal with a non-empty correction POSTs to `${VUE_APP_MASTRA_URL}/knowledge-feedback` with the full thread, correction, and context.
- On success with `editCount > 0`, the YAML on disk has been updated, a new git commit exists with the agent's `summary` as the headline, and the modal shows the short SHA + summary.
- On success with `editCount === 0`, the YAML is unchanged, no commit is created, and the modal shows "No changes made" + the agent's summary.
- For each error stage (`network`, `llm`, `validation`, `yaml_parse`, `git`), the modal shows the corresponding friendly message and offers "Try again" without losing the user's typed correction.
- The YAML's identity fields (`id`, `intent`, `requires`) are unchanged across every accepted edit (enforced by the validator, not just by the guidelines).
- All listed tests pass.

---

## Files to create

### PWA
- `apps/order-routing/src/services/CircuitKnowledgeFeedbackService.ts`
- `apps/order-routing/src/components/circuit/CircuitFeedbackModal.vue`
- `apps/order-routing/tests/circuitKnowledgeFeedbackService.test.ts`

### Circuit
- `sandbox/circuit/src/mastra/brokering/feedback/feedbackAgent.ts`
- `sandbox/circuit/src/mastra/brokering/feedback/feedbackGuidelines.ts`
- `sandbox/circuit/src/mastra/brokering/feedback/feedbackEditOpsSchema.ts`
- `sandbox/circuit/src/mastra/brokering/feedback/feedbackEditApplier.ts`
- `sandbox/circuit/src/mastra/brokering/feedback/feedbackYamlValidator.ts`
- `sandbox/circuit/src/mastra/brokering/feedback/feedbackGitCommitter.ts`
- `sandbox/circuit/src/mastra/brokering/feedback/knowledgeFeedbackRoute.ts`
- `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackEditApplier.test.ts`
- `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackYamlValidator.test.ts`
- `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackGitCommitter.test.ts`
- `sandbox/circuit/src/mastra/test/brokering/feedback/feedbackAgentSmoke.test.ts`

## Files to modify

- `apps/order-routing/src/components/circuit/CircuitChatCanvas.vue` — add header button, modal binding, helpers.
- `sandbox/circuit/src/mastra/brokering/routes.ts` — register `POST /knowledge-feedback`.
- `sandbox/circuit/package.json` — add `yaml` and (optionally) `simple-git` dependencies if not already present.
