# SIH_2026 — Privacy-preserving On-device Visual Browser Agent

A working prototype for the **SIH 2026** problem statement **"On-device Visual Perception for Light-weight Browser Agents"**.

A Chrome **MV3 extension** (called *PrivacyGuard*) inspects the currently open web page, detects and redacts personal data **entirely on the device**, builds a **sanitized** description of the page that contains *typed tokens instead of raw values*, asks a local **planner server** for a plan of actions, and then executes that plan **only after local consent and safety checks**.

> The single most important invariant of this project:
> **raw PII values (`matchText`, `rawValue`, `tokenMap`) never leave the device.** The wire contract is a *typed-token transport model*.

This README is written so that **anyone — including a complete beginner — can understand the whole repository** just by reading it. It explains the concepts, the architecture, how the pieces talk to each other, and **every single file** in the repo.

## Table of contents

1. [Part 1 — What is this project?](#part-1--what-is-this-project)
2. [Part 2 — Concepts you need first](#part-2--concepts-you-need-first)
3. [Part 3 — High-level architecture & data flow](#part-3--high-level-architecture--data-flow)
4. [Part 4 — The shared package (@sih/shared)](#part-4--the-shared-package-sihshared)
5. [Part 5 — The planner server (@sih/server)](#part-5--the-planner-server-sihserver)
6. [Part 6 — The extension (@sih/extension)](#part-6--the-extension-sihextension)
7. [Part 7 — How everything is built](#part-7--how-everything-is-built)
8. [Part 8 — Extension message protocol](#part-8--extension-message-protocol)
9. [Part 9 — Tests](#part-9--tests)
10. [Part 10 — Benchmarks](#part-10--benchmarks)
11. [Part 11 — CI](#part-11--ci)
12. [Part 12 — Configuration reference](#part-12--configuration-reference)
13. [Part 13 — Design decisions & fail-safe behavior](#part-13--design-decisions--fail-safe-behavior)
14. [Part 14 — Common gotchas](#part-14--common-gotchas)
15. [Part 15 — Quick file reference (path -> one-line purpose)](#part-15--quick-file-reference-path--one-line-purpose)
16. [Part 16 — Deployment](#part-16--deployment)
17. [Part 17 — End-to-end tests (Playwright)](#part-17--end-to-end-tests-playwright)

---

## Part 1 — What is this project?

An "AI browser agent" is software that can look at a web page, understand it, decide what to do (click a button, fill a form...), and do it — kind of a small robot that drives your browser.

The problem with normal browser agents is **privacy**: to understand the page, the agent usually has to read tons of personal data (your Aadhaar, PAN, passwords, bank account numbers...) and often sends it to a cloud server to decide what to do.

This project builds a browser agent that:

1. reads a page **on your machine**,
2. finds every piece of personal data using regexes, DOM structure, and on-device computer vision (captured screenshots, pixel analysis, face/OCR detection),
3. replaces raw values with **tokens** like `<AADHAAR_1>` **before anything leaves the device**,
4. sends only the sanitized page + your goal to a small **local planner server** (Express) that returns a plan of actions,
5. asks **you for consent** before doing anything risky,
6. only then executes clicks/typing on the real page — resolving tokens back to real values **locally inside the extension**, never on the network.

Everything runs on a single machine: the extension in Chrome, the planner server on `localhost:8080`. No cloud is required (an optional LLM planner can be plugged in via an OpenAI-compatible endpoint, but it only ever sees tokens).

---

## Part 2 — Concepts you need first

### The three "worlds" of the codebase (npm workspaces / monorepo)

The repository is a single npm project that contains **three separate packages** (workspaces) that depend on each other. This is called a *monorepo*:

```text
SIH_2026/
├── apps/
│   ├── extension/   -> "@sih/extension"  (the Chrome extension; runs inside the browser)
│   └── server/      -> "@sih/server"     (Express planner server; runs on Node.js at localhost)
└── packages/
    └── shared/      -> "@sih/shared"     (shared TypeScript types + privacy logic used by both)
```

- `packages/shared` is the foundation: type definitions (contracts), the PII regex patterns, and the **transport policy** that guarantees nothing raw ever goes out. Both other workspaces import it as `@sih/shared` (via TypeScript path alias `@sih/shared -> packages/shared/src/index.ts`).
- `apps/server` only knows how to receive a sanitized context and produce an action plan.
- `apps/extension` knows how to look at a page, sanitize it, call the server, and execute actions.

The root `package.json` defines the workspaces (`apps/*`, `packages/*`) and the top-level scripts (`test`, `bench`, `build`, `lint`) that run the corresponding script in every workspace.

### TypeScript source with `.js` imports

The source is TypeScript but import statements end in `.js` (e.g. `import { detectPii } from "../privacy/piiDetector.js"`). This is the `NodeNext` module mode (set in `tsconfig.base.json`), which requires explicit file extensions so the emitted JavaScript can be executed directly by Node.

### Anatomy of a Chrome extension (Manifest V3 — MV3)

A Chrome extension has several independent pieces that run in different "worlds" and talk via messages:

| Piece | Files | Where it runs | What it does |
| --- | --- | --- | --- |
| **Content script** | `src/content/contentScript.ts` | Injected into the actual web page (has the real DOM) | The "eyes and hands": extracts the DOM, runs the whole agent cycle, executes clicks/typing, shows the consent overlay |
| **Background service worker** | `src/background/serviceWorker.ts` | Chrome's background context | Relays messages; performs privileged actions like screenshotting the tab |
| **Popup** | `src/popup/*` | The toolbar popup when you click the extension icon | A small UI to enter a goal and see the last run's stats |
| **Injected UI** | `src/ui/*` | Inside the page | Shadow-DOM widgets (consent overlay, floating launcher button) |

Scripts in different contexts cannot access each other's variables, so they communicate with `chrome.runtime.sendMessage(...)` and `chrome.runtime.onMessage.addListener(...)` (see Part 8 for the exact message types). `manifest.json` tells Chrome what the extension is, what permissions it needs, and where each entry point lives.

### PII, tokens, and the two flavours of an "entity"

`SensitiveEntityType` (in `packages/shared/src/contracts.ts`) is the set of personal-data categories the agent knows:

```text
AADHAAR | PAN | UPI | GSTIN | PHONE_IN | EMAIL | PASSWORD | FACE | NAME | ADDRESS | ACCOUNT | IFSC | DOB | CARD_NUMBER
```

The detector produces `SensitiveEntity` objects. Each carries `matchText` (the literal matched value, e.g. `"2345 6789 0123"`) and `rawValue` — **these two fields are explicitly documented in the code as "never serialized to the network"**. Each entity also gets a stable **token** like `<AADHAAR_1>` (format: `<TYPE_N>`).

Important: two different shapes exist:

- `SensitiveEntity` — the **local** full version; may carry `matchText`, `rawValue`, `reasons`, `bounds`.
- `SanitizedSensitiveEntity` — the **wire** version; carries only `id, elementId, type, confidence, source, token`.

`enforceTransportPolicy()` maps one to the other when building the payload, and the firewall *re-scans the finished payload* and throws if anything raw survived.

### The privacy invariant (how the "leak" is structurally prevented)

The outbound payload is a `TransportContext`. Comparing `SanitizedContext` (local) to `TransportContext` (wire):

- **Present on the wire:** elements (with redacted text), sensitive entities (as `SanitizedSensitiveEntity` only), redacted regions, page URL/title (sanitized), privacy score, metrics, vision info, security signals, policy decisions, runtime profile, timestamps.
- **Never on the wire:** `tokenMap`, `matchText`, `rawValue`, element `valueHint`, element `attributes`.

There are **four independent layers** that enforce this (defense in depth):

1. **Policy** (`packages/shared/src/policy.ts`) — builds a `TransportContext` that structurally *cannot* contain the private fields.
2. **Firewall** (`apps/extension/src/privacy/networkFirewall.ts`) — inspects the outbound object for smuggled fields and re-runs the regex scan on the serialized JSON; throws on any hit.
3. **Server schema** (`apps/server/src/schema.ts`) — every schema is `z.strictObject(...)` (rejects unknown keys), and the server additionally greps the serialized `sensitiveEntities` for `matchText|rawValue|tokenMap`, returning HTTP 400 if found.
4. **Server-side consent forcing** — high-confidence security signals or a low privacy score force the plan to require user consent.

---

## Part 3 — High-level architecture & data flow

### Component diagram

```text
+------------------------------ Chrome browser ------------------------------------------+
|                                                                                        |
|  Toolbar popup (src/popup)                 Content script (src/content/contentScript)  |
|  user types a goal --sendMessage-->        onMessage: RUN_TASK / TM_TAB_SUMMARY        |
|                                          -> runAgentCycleOnPage(goal)                  |
|                                                                                        |
|  Background SW (src/background)            agentCycle.ts (the orchestrator):           |
|  PING / CAPTURE_VISIBLE_TAB                step observe:                              |
|  (chrome.tabs.captureVisibleTab)              extractVisibleDom() + detectDomBlindSpots|
|  RUN_TASK -> relay to tab                    step vision: selectVisionModel()          |
|                                                -> captureViewport()                    |
|                                                -> backends + pixelAnalysis (Worker)    |
|  Shadow-DOM UI (src/ui)                      step detect: detectPii()                  |
|  consentOverlay / pageLauncher               step redact: redactElements()             |
|  ledger / dashboard (console logs)           step scan: promptInjectionGuard()         |
|                                              step plan: firewalled fetch -> server     |
|                                              step guard: validatePlan() (local)        |
|                                              step consent: requestConsent()            |
|                                              step execute: executePlan()               |
+------------------------------ Chrome browser ------------------------------------------+
         |
         |  fetch http://localhost:8080/api/plan   (sanitized TransportContext only)
         v
+--------------------------------- Node.js --------------------------------------------+
|  Express server (apps/server/src/app.ts)                                                |
|    -> zod planRequestSchema (strict)  -> rejects smuggled fields with 400               |
|    -> raw-field probe (matchText|rawValue|tokenMap)  -> 400 if present                  |
|    -> shouldForceConsent(payload)  (server-side consent forcing)                        |
|    -> buildPlanWithLlm(payload) or buildPlan(payload)   (LLM or deterministic planner)  |
|    -> PlanResponse { plan, serverNotes }                                                |
+--------------------------------- Node.js --------------------------------------------+
```

### The agent lifecycle, step by step

Everything flows through `runAgentCycle()` in `apps/extension/src/pipeline/agentCycle.ts`. Telemetry records each stage (stage name in parentheses).

1. **`agent-cycle`** begins; a `Telemetry` instance is created.
2. **`observe`** -> `buildContext()`:
   - `detectRuntimeProfile()` — reads GPU availability / CPU cores / device memory to choose an execution mode (WebGPU / WASM / CPU) and a tier (`lite`, `balanced`, `performance`).
   - **`dom-extraction`** — `extractVisibleDom()` walks the visible DOM and produces up to 250 `UiElement` objects (role, text, bounds, DOM path, accessible name...), giving each a stable `agentId` (a UUID stored in `data-agent-id`). `detectDomBlindSpots()` also records every `<canvas>`, `<video>`, `<iframe>` region — the browser cannot read inside those via the DOM, so they are flagged for vision.
   - **`vision-inference`** — `selectVisionModel()` scores 4 model descriptors against the runtime profile + dominant blind spot; `loadSelectedModel()` warms up the backend (Shape Detection API check + a 16x16-pixel worker warmup); `runVisionInWorkerLikeMode()` captures the viewport, crops each blind-spot region, and runs the hybrid vision backend (Shape Detection API + a pixel-analysis Web Worker) to find faces/OCR text. OCR text is scanned with the same PII regexes. Findings become `SensitiveEntity`s of type `FACE` / `ADDRESS` / `ACCOUNT` / etc.
   - **`pii-detection`** — `detectPii()` runs the three-channel detector (regex, structural, heuristic-NER) over every element. Raw values stay local.
   - **`redaction`** — `redactElements()` merges DOM-detected + vision entities and replaces every raw match with its token, computing `redactedText`, sensitivity, `redactedRegions` (pixel bounds) and the local `tokenMap` (raw-value lookup).
   - **`security-scan`** — `detectPromptInjectionSignals()` looks for malicious phrases ("ignore previous instructions", "send all data", ...), and every low-confidence entity detection becomes an `UNKNOWN_AUTOMATION_TRAP` signal.
   - Rubric metrics are computed (`computeRubricMetrics`) and a `privacyScore` is derived: `clamp01(redactionPrecision * piiRecallPrecision)`.
   - A `SanitizedContext` is assembled (with `tokenMap` kept local), metrics attached, and the console gets `[privacy-ledger]` + `[rubric-dashboard]`.
3. **`plan`** — `requestActionPlan(serverUrl, userGoal, context)`:
   - `assertTransportIsSafe()` -> firewall strips/validates -> `TransportContext`. **This is the privacy boundary; after this point raw values cannot exist.**
   - `minimizePayload()` trims sizes.
   - `postPlan()` POSTs to `{serverUrl}/api/plan` with headers `X-Request-Id` + `X-Client-Version`, a 4.5 s timeout and up to 2 retries. An HTTP 400 means the remote *schema* rejected a smuggled field.
   - If the server is unreachable and `allowOfflinePlan` is set, `buildLocalFallbackPlan()` produces a conservative local plan (otherwise `PlannerUnavailableError` is thrown).
4. **`guard`** — `validatePlan()` drops any action that is high-risk, references a missing target, targets an element that moved since observation, or has too-low confidence for its risk level.
5. **`consent`** — `requestConsent()` decides (mode `strict`/`balanced`/`demo`) whether the run may auto-approve or must show the shadow-DOM consent overlay. The overlay lists every action with a risk pill plus the privacy-scan summary. If the user rejects, the cycle ends here with zero executed actions.
6. **`execute`** — `executePlan()` walks the plan: `WAIT`/`SCROLL` are acknowledged, `CONFIRM_REQUIRED` is skipped in autonomous mode, `CLICK` clicks a re-verified target, `TYPE` re-verifies the target and resolves `<TOKEN>`s against the **local** raw-value map before typing. Unresolvable tokens cause a refusal (never a raw type).
7. `AgentCycleResult` is returned; `logAgentExecution()` prints `[agent-execution]` (consent, plan, per-action results, telemetry breakdown).

### What crosses the wire (and what never does)

**Crosses the wire (to `POST /api/plan`):** the `TransportContext` — page URL/title sanitized, element text redacted (or `[REDACTED]`/tokens), entities token-only, plus security signals, policy decisions, metrics, vision traces.

**Never crosses the wire:** `matchText`, `rawValue`, `tokenMap`, `valueHint`, `attributes`. Captured screenshots never leave the extension either — pixel data is processed in a local Web Worker and discarded.

## Part 4 — The shared package (`@sih/shared`)

Location: `packages/shared/`. Package name `@sih/shared`. This workspace has **no runtime dependencies** and exposes contracts + pure privacy logic used by both the server and the extension. It compiles with `tsc` to `packages/shared/dist`; the other workspaces import it through the TS path alias and through the vitest configs->`src/index.ts` alias so they always run against the source.

### `src/index.ts`
The barrel export: three lines that re-export everything from `contracts.ts`, `patterns.ts`, and `policy.ts`. This is the package's single public entry point (`exports: "." -> ./dist/index.js` in `package.json`).

### `src/contracts.ts`
The **vocabulary of the whole system** — every shared TypeScript type lives here. The DOM extractor builds DTOs that implement these interfaces, and the server's zod schemas mirror them 1:1. Key types:

| Type | Purpose |
| --- | --- |
| `DataSensitivity` | `"public" \| "sensitive" \| "restricted"` — how private a page element is |
| `SensitiveEntityType` | the 14 PII categories (Aadhaar, PAN, UPI, GSTIN, phone, email, password, face, name, address, account, IFSC, DOB, card) |
| `BoundingBox` | `{x, y, width, height, confidence}` in page CSS coordinates |
| `UiElement` | one DOM element the agent understands: id, agentId, nodeName, role, text, placeholder, valueHint, domPath, bounds, sensitivity, redactedText, attributes, accessibleName, enabled, checked |
| `SensitiveEntity` | a detected PII instance — the **local** full version incl. `matchText`, `rawValue`, `bounds`, `reasons` (all marked "never serialized") |
| `SanitizedSensitiveEntity` | the **wire** version: `id, elementId, type, confidence, source, token` only |
| `DetectionSummary` | recall/precision estimates + `uncertainCount` |
| `VisionObservation` | a DOM-blind region (`canvas`/`video`/`iframe`) with bounds + sensitivity guess |
| `RuntimeProfile` | execution mode (`webgpu\|wasm\|cpu`), tier (`lite\|balanced\|performance`), cores, memory |
| `ModelMetricFit` + `VisionModelDescriptor` | rubric subscores + a full catalog entry for a vision model |
| `SelectedVisionModel` + `ModelSelectionTrace` | the chosen model with score/reasons, plus the selection trace for the server |
| `SecuritySignal` | `PROMPT_INJECTION \| MALICIOUS_INSTRUCTION \| UNKNOWN_AUTOMATION_TRAP` + confidence/message |
| `PolicyDecision` | `pass\|warn\|block` decision with reason (audit trail) |
| `RubricMetrics` | five rubric subscores + `weightedOverall` |
| `SanitizedContext` | the **local** full-page digest (incl. `tokenMap` + full entities) |
| `TransportContext` | the **wire** digest (no `tokenMap`, sanitized entities/title/url) |
| `AgentActionType` / `AgentAction` / `ActionPlan` | the plan model; actions are `CLICK\|TYPE\|SCROLL\|WAIT\|CONFIRM_REQUIRED` with a `riskLevel` |
| `PlanRequest` / `PlanResponse` | the API contract (`userGoal` + `TransportContext` -> plan + `serverNotes`) |
| `ConsentDecision` | user decision with reasons + approved action ids |
| `RedactionResult` / `ExecutionResult` | redactor output / per-action execution outcome |

### `src/patterns.ts`
The **PII regex library** and the final-safety-net scanner.

- `PII_PATTERNS` — 9 patterns, each `{ type, regex, confidence, reason }`:

| Type | Regex | Notes |
| --- | --- | --- |
| `AADHAAR` | `(?<![\d][ -]?)\b\d{4}[ -]?\d{4}[ -]?\d{4}\b(?![ -]?[\d])` | The lookbehind + lookahead stop the pattern from also matching the first/last 12 digits of a 16-digit card number. |
| `PAN` | `\b[A-Z]{5}[0-9]{4}[A-Z]\b` | Standard PAN format. |
| `GSTIN` | `\b\d{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b` | 15-char GSTIN. |
| `UPI` | `\b[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,10}\b(?!\.[A-Za-z])` | The `(?!\.[A-Za-z])` lookahead prevents `name@domain` (an email) from also being flagged as a UPI handle. |
| `PHONE_IN` | `\b(?:\+91[-\s]?)?[6-9]\d{4}[-\s]?\d{5}\b` | Indian mobile incl. optional `+91`, spaced/dashed digits. |
| `IFSC` | `\b[A-Z]{4}0[A-Z0-9]{6}\b` | Bank IFSC code. |
| `EMAIL` | `\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b` | Requires a TLD. |
| `CARD_NUMBER` | `\b(?:\d[ -]*?){13,19}\b` | Card-like digit runs. |
| `DOB` | `\b(?:0?[1-9]|[12][0-9]|3[01])[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:19|20)\d{2}\b` | Date-of-birth style dates (separators `/`, `-`, `.`). |

- `findSensitiveValuesInText(text)` -> `{type, matchText, confidence}[]`. Runs every pattern and **resets `regex.lastIndex` after each pass** (a common `g`-flag reuse bug, handled here).
- `assertNoRawSensitiveValues(payload)` — serializes the payload to JSON, re-scans it, and throws `PrivacyFirewallError` listing up to 5 unique `TYPE:value` hits. This fail-closed last line of defense is what both the client and server firewalls rely on.

### `src/policy.ts`
The **outbound transport policy** — the code that actually makes the privacy invariant true.

- `POLICY_VERSION = "v3.0.0"` — version stamp sent in every payload so the server knows which policy produced it.
- `sanitizePageUrl(url)` — keeps only origin + parameterized keys: every path segment -> `<seg>`, every query value -> `<value>` (`https://bank.example.com/<seg>/<seg>?email=<value>`). Malformed URLs -> `<unsafe-url>`.
- `sanitizePageTitle(title)` — trims to 120 chars, redacts any PII found by `findSensitiveValuesInText` and honorific names (`Mr/Mrs/Ms/Dr/Shri/Smt ...`) to `<TYPE>` / `<NAME_1>`. Empty -> `<untitled>`. (Regression fixed: titles used to only be truncated — now they are actually *redacted*, so "Mr. Rahul Sharma" can never leak via the title.)
- `sanitizeSensitiveEntity(entity)` — maps a full `SensitiveEntity` down to the wire shape (drops `matchText`, `rawValue`, `reasons`, `bounds`).
- `rebuildRedactedText(text, entities, elementId)` — if an element's stored `redactedText` is missing, re-derive it by replacing each `matchText` with its token (a "backstop" for elements whose redaction wasn't recorded).
- `enforceTransportPolicy(context)` — `SanitizedContext -> TransportContext`. Per element:
  - Force-redact when the element is **not public**, **already has a redactedText**, **or has any matching entity** (`hasEntityRedaction`).
  - Outbound text = `redactedText ?? rebuildRedactedText(...) ?? "[REDACTED]"`, truncated to 180 chars.
  - `placeholder` survives only for public elements (60-char cap); `valueHint`, `attributes`, `enabled`, and `checked` are removed (the strict server `uiElementSchema` rejects unknown keys, so these UI-only fields never cross the wire).
  - High-confidence security signals append a `warn` policy decision; `tokenMap` is structurally omitted; entities are sanitized; the decision `no-raw-sensitive-values-over-network` is recorded.

Note the subtle fix baked in: previously only non-public or already-redacted elements were redacted on the wire — now **any element that has a matching entity is redacted** (closes the leak where a `public`-labelled element still contained a raw value).

---

## Part 5 — The planner server (`@sih/server`)

Location: `apps/server/`. Package name `@sih/server`. An **Express 5** app using **zod 4** for validation. Dependencies: `express`, `cors`, `zod`, `@sih/shared`. Compiled with `tsc` to `apps/server/dist`; started with `node dist/index.js`.

The server's job is narrow and defensive: **validate the incoming sanitized context strictly, reject any attempt to smuggle private fields, force consent when worried, and produce an `ActionPlan`** — deterministically, or via an optional LLM.

### `src/index.ts`
Bootstrap: reads `PORT` (default `8080`), calls `createApp().listen(...)`, logs the URL. Everything else lives in `app.ts` so tests can import `createApp()` directly without binding a socket.

### `src/app.ts`
The whole HTTP surface. `createApp()`:

- `app.use(cors({ origin: CORS_ORIGIN }))` — `CORS_ORIGIN` env, default `*`.
- `app.use(express.json({ limit: "1mb" }))` — JSON bodies up to 1 MB.
- `app.use(createRateLimiter())` — a simple in-memory per-IP sliding 60-second window; default max 120 requests (`RATE_LIMIT_MAX`); returns 429 on overflow.
- `app.disable("x-powered-by")` — don't advertise Express.
- **`GET /health`** -> `{ ok: true, service: "sih-privacy-planner-v3" }`.
- **`POST /api/plan`**:
  1. `planRequestSchema.safeParse(req.body)` — zod strict validation. Invalid -> 400 with `parsed.error.flatten()`.
  2. **Raw-field probe**: `JSON.stringify(payload.context.sensitiveEntities)` is scanned for `matchText|rawValue|tokenMap`. This is the server's *own* independent check (the extension should already have stripped them; if they arrive anyway, refuse) -> 400.
  3. `shouldForceConsent(payload)` — high-confidence security signal or `privacyScore < 0.75` forces user consent.
  4. Planning: `buildPlanWithLlm(payload)` first (if an LLM key is configured and the call succeeds), else deterministic `buildPlan(payload, force)`.
  5. Returns `PlanResponse { plan, serverNotes }` — `serverNotes` echoes probe result, planner source (LLM vs deterministic), consent decision, element/token counts, vision model.

### `src/schema.ts`
Every zod schema in the system (mirrors `shared/contracts.ts`). **All are `z.strictObject(...)`** — unknown extra keys are rejected. Highlights:

- `boundingBoxSchema`, `uiElementSchema` (id, agentId?, nodeName?, role, text, placeholder?, domPath, bounds, sensitivity, redactedText?, accessibleName?).
- `sanitizedSensitiveEntitySchema` — enforces the token format `^<[A-Z_]+_\d+>$` and the 14 entity types; has **no** `matchText`/`rawValue`/`reasons`/`bounds` fields, so smuggling one fails the strict schema.
- `visionObservationSchema`, `securitySignalSchema`, `policyDecisionSchema`, `selectedVisionModelSchema`, `modelSelectionTraceSchema`, `runtimeProfileSchema`, `metricsSchema`.
- `transportContextSchema` — caps array sizes (<=250 elements, <=220 entities, <=220 regions, <=80 observations, <=80 signals, <=40 decisions).
- `agentActionSchema` — `value` capped at 200 chars and **must match `^[A-Za-z0-9 _<>\-./@]*$`**: static text or local `<TOKEN>` references only — never URLs, selectors, or JS.
- `actionPlanSchema`, `planRequestSchema` (`userGoal` length 3–500).

### `src/planner/buildPlan.ts`
The **deterministic fallback planner** (always works, no network needed):

- `findLikelyTarget(payload)` — among *public* elements, scores each by role (button=4, link=3) + has-text (1); returns the top one.
- Builds a `WAIT` action (high confidence), then a `CLICK` on the target (medium risk) — or a `CONFIRM_REQUIRED` action if no target exists.
- `requiresUserConsent = force || any action not low-risk`.
- `guardrailNotes` records "Planner received sanitized-only context." and that non-low-risk actions are gated locally.

### `src/planner/llmPlanner.ts`
The **optional LLM planner**:

- `llmConfigured()` — true if `PLANNER_API_KEY` or `OPENAI_API_KEY` is set.
- `compactContext(payload)` — shrinks the context given to the LLM: per element it sends `id, role, label (accessibleName), text (public -> text, else -> redactedText), sensitivity`; entities are sent **token + type + confidence only**; security-signal *types*; the privacy score. The LLM never sees raw values.
- `SYSTEM_PROMPT` — instructs the model to return only a JSON plan matching the schema, reference only supplied element ids, never invent URLs/selectors/JS, and TYPE using only `<TOKEN>` placeholders.
- `buildPlanWithLlm(payload)`:
  - 10 s `AbortController` timeout (`LLM_TIMEOUT_MS`).
  - Calls `${baseUrl}/chat/completions` (OpenAI-compatible), `temperature: 0`, model `PLANNER_MODEL` (default `gpt-4o-mini`).
  - `extractJson()` — unwraps fenced code blocks or slices from the first `{`.
  - Validates with `actionPlanSchema`, then **filters actions to known element ids** (an LLM can't hallucinate targets that don't exist). Returns `null` on *any* failure so the caller falls back to the deterministic planner.

### `src/security/serverPolicy.ts`
The **server-side consent forcing** policy: `shouldForceConsent(payload)` returns `{ force, reason }` with `force: true` when any security signal has `confidence >= 0.8` (e.g. a prompt injection was detected on the page) **or** `privacyScore < 0.75`; otherwise no forced consent.

## Part 6 — The extension (`@sih/extension`)

Location: `apps/extension/`. Package name `@sih/extension`. The heart of the product. Source is TypeScript compiled both for emitting and for bundling (see Part 7), and tested under `happy-dom`.

### Entry points and manifest

#### `manifest.json`
MV3 declaration:

- `manifest_version: 3`, name "PrivacyGuard — On-device Visual Browser Agent", version `1.0.0`, `minimum_chrome_version: 111`.
- `permissions: ["activeTab", "scripting", "storage", "tabs"]`; `host_permissions: ["<all_urls>"]`.
- `background.service_worker: "dist/background/serviceWorker.js"` (module type).
- `action.default_popup: "dist/popup/popup.html"` + icons 16/48/128.
- `content_scripts`: matches `<all_urls>`, `js: ["dist/content/contentScript.js"]`, `run_at: "document_idle"`, `all_frames: false`.
- `web_accessible_resources`: `dist/icons/*.png`.

#### `src/popup/popup.html`
The popup's markup: header (PG logo + "PrivacyGuard"), a status row with a colored dot (`statusDot`) and text, a goal `textarea`, the **"Run agent on this tab"** button, a privacy-summary card (**PII found / Regions redacted / Privacy score**, populated from the last summary message) and a footer restating that only typed tokens leave the device. Loads `./popup.css` and `./popup.js`.

#### `src/popup/popup.css`
Popup styling: 320px app, gradient logo tile, status dot colors (green `online` / amber `busy` / red `error`), the green run button (grey when disabled), white privacy-card rows.

#### `src/popup/popup.ts`
Popup behavior:

- `queryActiveTab()` -> `chrome.tabs.query({ active: true, currentWindow: true })`.
- `loadSummary()` -> sends `{ type: "TM_TAB_SUMMARY" }` to the tab; on success updates the three counters and enables the run button; on failure shows "Reload this tab, then retry." and disables it.
- `runTask()` -> sends `{ type: "RUN_TASK", tabId, goal }` to the **background worker** (which relays it to the content script); sets status to `busy` while working, then reloads the summary.
- Calls `loadSummary()` on open.

#### `src/background/serviceWorker.ts`
The MV3 service worker (kept deliberately small):

- On `chrome.runtime.onMessage` handles:
  - **`PING`** -> `{ ok: true, source: "privacyguard-background" }`.
  - **`CAPTURE_VISIBLE_TAB`** -> uses `sender.tab.id` + `chrome.tabs.captureVisibleTab(tabId, { format: "png" })` and returns the `dataUrl`. Returns `true` to keep the message channel open for the async reply. (Screenshots become pixels *inside the extension*; they never leave it.)
  - **`RUN_TASK`** -> relays `{ type: "TM_RUN_TASK", goal }` to the target tab via `chrome.tabs.sendMessage` and forwards the response back.
- `onInstalled` logs a reminder that the agent only ships typed tokens to the planner.

#### `src/content/contentScript.ts`
The page-side entry point of the agent:

- Runs `runAgentCycleOnPage(goal)` when it receives **`TM_RUN_TASK`** (relayed from the popup via the background worker), then replies with a **`TM_TAB_SUMMARY`** containing `{ piiCount, redactedCount, privacyScore }` derived from the returned `AgentCycleResult`.
- Answers **`TM_TAB_SUMMARY`** requests from the popup.
- Calls `attachPageLauncher({ onRun })` to float the shield button; `onRun` runs a full cycle and returns a short human summary.
- Exposes `window.__removePrivacyGuardLauncher = remove` for easy teardown from the page console.

### `src/index.ts`
The package's public API surface (used by tests/scripts):

- `DEFAULT_SERVER_URL = "http://localhost:8080"` — where the agent looks for the planner (change here if your server is elsewhere).
- `createAgentCycleOptions(overrides)` — defaults: `serverUrl`, `consentMode: "balanced"`, `consentUi: consentOverlayUi`, `maxReplanAttempts: 2`, `allowOfflinePlan: true`.
- `runAgentCycleOnPage(userGoal)` — runs a full cycle with defaults and logs `[agent-execution]`.
- Re-exports `runAgentCycle` + types.

### Pipeline directory (`src/pipeline/`)

#### `src/pipeline/agentCycle.ts`
The **orchestrator** (see Part 3 for the end-to-end walk-through). Notable internals:

- `mergeSignals(...chunks)` — dedupes security signals by `type:elementId:message`.
- `buildContext(telemetry)` — DOM -> vision -> PII -> redaction -> security-scan -> metrics, producing the `SanitizedContext`. Privacy score = `clamp01(redactionPrecision * piiRecallPrecision)`.
- The `policyDecisions` array starts with `adaptive-vision-model-selection` (pass/warn depending on whether a real ML backend loaded).
- `runAgentCycle` sequence: observe -> plan (offline fallback + replan when the plan is empty, up to `maxReplanAttempts`) -> guard -> consent -> (maybe) execute -> return `AgentCycleResult` (with `replanAttempts`).

#### `src/pipeline/domExtractor.ts`
Converts the visible DOM into `UiElement[]` (the agent's "eyes"):

- `getDomPath(element)` — builds `div:nth-child(2) > button:nth-child(1)`-style selectors by walking up the tree.
- `getAccessibleName(node)` — `aria-label` > `aria-labelledby` > associated `<label>` > `title`.
- `pickAttributes(node)` — name/id/aria-label/autocomplete/type/title (the transport policy later removes these from the wire).
- `isControl` / `isVisible` — visibility = bounding rect + computed style (visibility/display/opacity).
- `extractVisibleDom(maxElements = 250)` — selects interactive/representative elements (buttons, inputs, textareas, links, selects, imgs, figures, video, canvas, iframe, dialog, tables, forms, `[role]`, contenteditable, labels, aria-annotated), keeps visible ones, annotates each with a stable `agentId` (UUID stored in `dataset.agentId` via `resolveAgentId`), lowercased `nodeName`, truncated text, placeholder, `valueHint` (input value, or `"password"` for password fields), domPath, bounds, attributes, sensitivity (defaults `public`), accessibleName, `enabled`, `checked`.
- `resolveDomTarget(element)` — resolves an agent id back to a live node: first `[data-agent-id='...']`, else the recorded `domPath` — but **refuses `body`/`html`** targets (`isExecutableTarget` guard, so a plan can't target the document root).
- `signatureMatches(node, signature)` — re-verifies a live node against the recorded `role`/`accessibleName`/`bounds` (position must be within `max(240, width * 1.5)` px). Used by the executor + guardian to catch page changes.

### Privacy directory (`src/privacy/`)

#### `src/privacy/piiDetector.ts`
The on-device PII detector (three channels):

- `detectPiiInText(text)` — regex-only scan of free text (used for OCR lines). Produces `text-<TYPE>-N` ids, `elementId: "text-region"`.
- `extractTextCandidates(element)` — normalizes `text`, `placeholder`, `valueHint` into scan candidates.
- `detectByRegex(element, entities)` — runs every `PII_PATTERNS` rule over each candidate; `pushEntity` creates `elementId-TYPE-N` ids and builds the `<TYPE_N>` token.
- `detectByStructure(element, entities)` — semantic hints: password inputs -> `PASSWORD` (0.99); account hints (`account`, `a/c`, `iban`, `bank`, ...) -> `ACCOUNT` (0.78); address hints (`address`, `city`, `district`, `pincode`, ...) -> `ADDRESS` (0.74).
- `detectByHeuristicNer(element, entities)` — honorific names (`Mr/Mrs/Ms/Dr/Shri/Smt...`) or name-context labels (`name`, `full name`, `applicant`, `beneficiary`, `customer`) -> `NAME` (0.69–0.83).
- `dedupeAndCalibrate(entities)` — merges duplicates on `elementId:type:matchText`, bumping confidence by +0.02 (capped at 0.99) and unioning reasons.
- `buildSummary(entities)` — estimates recall/precision from the high-confidence / uncertain counts.
- `detectPii(elements)` — runs regex + structural + heuristic-NER over every element, then dedupes and summarizes. Returns `{ entities, summary }`. Raw values only exist here, locally.

#### `src/privacy/redactor.ts`
Replaces raw values with tokens (the "editing" step):

- `tokenizeText(text, entity)` — if the entity has a `matchText`, replace it (escaped, case-insensitive) with the token; otherwise replace every token of text with the token.
- `redactElements(elements, entities)` — groups entities by element id, rebuilds each element's `redactedText`, marks sensitivity (`sensitive`, or `restricted` for `PASSWORD` or confidence < 0.7), records `redactedRegions` (entity bounds when present, otherwise the element bounds), builds the local `tokenMap` (`<TOKEN> -> TYPE`), and estimates `precisionEstimate`. Elements with no related entities stay `public` with their text intact.

#### `src/privacy/networkFirewall.ts`
The client-side fail-closed firewall:

- `runNetworkFirewall(outbound)` — four checks:
  1. `sensitive-entities-are-token-only` — no `matchText`/`rawValue`/`reasons` on wired entities;
  2. `no-token-map` — `tokenMap` absent;
  3. `sanitized-url` — query part contains only `key=<value>` pairs;
  4. `regex-pii-scan` — `assertNoRawSensitiveValues(outbound)` over the serialized payload.
  Returns `{ pass, checks }`; `pass` is true only if every check passes.
- `assertTransportIsSafe(context)` — calls `enforceTransportPolicy(context)`, then `runNetworkFirewall`; throws `NetworkFirewallError` if anything failed, else returns the safe `TransportContext`. **The extension never leaves this function without a guaranteed-safe payload.**

### Runtime directory (`src/runtime/`)

#### `src/runtime/actionExecutor.ts`
Actually performs the plan's actions ("the hands"):

- `findElementById` + `resolveTarget` — locate the `UiElement` in the context, resolve it to a live node (`resolveDomTarget`) and re-verify it with `signatureMatches` (role + accessibleName + bounds). Anything mismatched -> target treated as missing.
- `setNativeValue(element, value)` — writes to inputs/textarea using the **native prototype value setter** (bypasses React synthetic-event traps), then dispatches a bubbling `InputEvent("input")` and an `"change"` `Event`. The `typeof InputEvent !== "undefined"` guard keeps it working where `InputEvent` is unavailable (e.g. older/edge environments).
- `resolveTypeValue(value, context)` — resolves every `<TOKEN>` in a TYPE value against the **local** `SensitiveEntity.rawValue` map. Any token not found in the local map -> `missingTokens`, which makes the action **fail with a refusal** (never types unresolved secrets).
- `executePlan(plan, context)` — walks actions: `WAIT` acknowledged; `SCROLL` scrolls down 250px smoothly; `CONFIRM_REQUIRED` skipped in autonomous mode; `CLICK`/`TYPE` run through the target resolution above. Every action returns an `ExecutionResult` with status, message, and latency.

#### `src/runtime/actionGuardian.ts`
Local (client-side) re-validation of every server plan:

- `confidenceFloor(action)` — high risk needs >=0.95, medium >=0.7, low >=0.5.
- `canExecute(action, context)` — false if: high risk; target id doesn't exist in context; the live DOM node can't be resolved or its signature no longer matches (moved/removed); or confidence < floor.
- `validatePlan(plan, context)` — filters the plan by `canExecute`, sets `requiresUserConsent` (original flag, any non-low-risk action, or any security signal present), and appends a guardrail note telling how many actions were dropped.

#### `src/runtime/consentManager.ts`
Decides when to show the human the door:

- `ConsentMode = "strict" | "balanced" | "demo"`.
- `ConsentUi` interface — any UI that can `prompt(plan, context) -> Promise<ConsentDecision>` (the overlay implements it).
- `evalConsentFlow(context, plan, mode)` triggers a prompt when:
  1. any security signal has `confidence >= 0.75`;
  2. the plan's worst risk is `high`;
  3. `uncertainCount > 0`;
  4. `strict` mode and (`requiresUserConsent` or risk != low);
  5. `balanced` mode and (risk == `medium` or `requiresUserConsent`).
  Otherwise it auto-approves (`promptRequired: false`).
- `requestConsent(plan, context, ui, mode)` — returns the auto-decision when no prompt is needed, else calls the UI.
- `buildRejectDecision(reason)` — helper used when the user (or a policy) rejects.

#### `src/runtime/runtimeProfile.ts`
Probes the device to pick the best execution strategy:

- `hasWebGpu()` — `"gpu" in navigator`.
- `detectRuntimeProfile()` — tier: `performance` when WebGPU + >=8 cores, `balanced` when >=4 cores, else `lite`; mode: `webgpu` if available, else `wasm` when `deviceMemory >= 4GB`, else `cpu`.

### Transport directory (`src/transport/`)

#### `src/transport/client.ts`
The server client:

- `PlannerUnavailableError` — the error thrown when the planner can't be reached.
- `buildLocalFallbackPlan(context)` — offline plan when the server is unreachable and `allowOfflinePlan` is true: click the first `public` role-containing-a-button element, or return an empty action list; `requiresUserConsent: true`.
- `postPlan(serverUrl, payload, requestId)` — POST `{serverUrl}/api/plan` with `Content-Type: application/json`, `X-Request-Id`, `X-Client-Version: 1.0.0`; 4.5 s abort timeout; HTTP 400 -> throw `"Planner rejected payload: <body>"`; non-OK -> status error; else parsed `PlanResponse`.
- `requestActionPlan(serverUrl, userGoal, context)` — `assertTransportIsSafe(context)` -> `minimizePayload(...)` -> payload = `{ userGoal, context }`; retries up to `MAX_RETRIES = 2` (abort short-circuits); after exhausting retries throws `PlannerUnavailableError`.

#### `src/transport/payloadMinimizer.ts`
Reduces the wire size before transmission: elements capped at 200 (text/redactedText 150 chars), entities 150, redacted regions 150, vision observations 60. Preserves the rest of the `TransportContext` unchanged.

### Security directory (`src/security/`)

#### `src/security/promptInjectionGuard.ts`
Scans UI text + placeholders for five malicious-instruction patterns ("ignore previous instructions", "send all data/information", "disable privacy", "developer mode override", "copy otp and share") and emits `PROMPT_INJECTION` signals (confidence 0.88) with the offending element id. These signals are what force consent everywhere downstream.

### Metrics directory (`src/metrics/`)

#### `src/metrics/telemetry.ts`
Tiny stage timing: `Telemetry` records `start(name)` / `end(name)` marks, exposes `getStages()`, `totalMs()`, and `toJSON()` (a flat `{ <stage>: ms, totalMs }` object used in the execution-log output). Stage names in an agent run: `agent-cycle`, `observe`, `context-build`, `dom-extraction`, `vision-inference`, `pii-detection`, `redaction`, `security-scan`, `plan`, `guard`, `consent`, `execute`.

#### `src/metrics/metricsEngine.ts`
Computes the **rubric metrics** used for the privacy score and the dashboard:

- `latencyScore(durationMs)` — 1.0 at <=700ms, 0.3 at >=5000ms, linear between.
- `resourceScore(profile, totalElements)` — WebGPU 0.95 / WASM 0.85 / CPU 0.75 base, minus a load penalty (capped at 0.25).
- `visualScore(totalElements, blindSpots)` — DOM coverage (`min(1, elements/100)`) minus a blind-spot penalty, +0.25.
- `computeRubricMetrics(input)` — five subscores; `weightedOverall = visualContextAccuracy*0.25 + piiRecallPrecision*0.2 + redactionPrecision*0.2 + resourceUtilization*0.2 + endToEndLatency*0.15`, where `piiRecallPrecision = (detectionRecall + detectionPrecision)/2`.
- `attachMetrics(context, metrics)` — returns a copy of the context with `metrics` attached.

### Capture directory (`src/capture/`)

#### `src/capture/screenshot.ts`
Screenshot plumbing used by the vision pipeline:

- `requestCaptureFromBackground()` — sends `{ type: "CAPTURE_VISIBLE_TAB" }` via `chrome.runtime.sendMessage`; returns the `dataUrl` or an error (gracefully fails when not running as an extension).
- `loadImage(dataUrl)` / `drawToCanvas(image)` — decode the PNG into an `<img>` and draw it onto an offscreen `<canvas>` (with `willReadFrequently` for CPU access).
- `captureViewport()` — combines the above into a `CaptureResult` with the canvas + pixel dimensions.
- `cropRegion(canvas, bounds)` — `getImageData()` for a clamped, rounded region; returns `ImageData` or `null`.

### Vision directory (`src/vision/`)

This is the "on-device visual perception" subsystem. It is deliberately layered so every stage can degrade gracefully.

#### `src/vision/domBlindSpotDetector.ts`
Finds the DOM-blind regions: every `<canvas>`, `<video>`, `<iframe>` becomes a `VisionObservation` (`kind`, bounding box, `sensitivityGuess: "sensitive"`, confidence 0.65) so the vision stage knows exactly where to look.

#### `src/vision/modelCatalog.ts`
The `MODEL_CATALOG` — four `VisionModelDescriptor`s with size, per-mode latency, a 5-axis rubric (`metricFit`), and recommended tiers: MediaPipe BlazeFace short-range (1.2 MB, face_detection), PaddleOCR Mobile ONNX (18 MB, ocr), YOLOv8n layout ONNX (6.2 MB, layout_detection), TrOCR small Transformers.js (73 MB, ocr). This is declarative "model metadata", not model weights.

#### `src/vision/modelSelector.ts`
Chooses the best model for the current run:

- `dominantBlindSpot(observations)` — most frequent kind (`video`/`canvas`/`iframe`/`none`).
- `taskRelevanceBonus(model, dominant)` — face model boosts on `video`, OCR/layout boost on `canvas`/`iframe`.
- `runtimeBonus(model, profile)` — +/-0.06 for tier recommendation, latency-based bonus, size-based bonus.
- `scoreModel(...)` — rubric-weighted score (0.25/0.2/0.2/0.2/0.15) + bonuses, clamped to [0, 1].
- `selectVisionModel(profile, observations)` — sorts the catalog by score, returns `{ selected, trace }` where `trace.shortlist` is the top 3.

#### `src/vision/modelLoader.ts`
Warms up the chosen backend before inference:

- `loadSelectedModel(selected, profile)` — checks `shapeDetectionAvailable()` (Chrome Shape Detection API), warms the pixel-analysis Web Worker with a synthetic 16x16 image (falling back to inline `analyzeImageBlock`), and reports `{ loaded, backend, warmupMs, notes }`. `loaded` is true if the Shape API or the worker is available.

#### `src/vision/workerAdapter.ts`
Glues inference together with worker availability:

- `runVisionInWorkerLikeMode(observations, elements, selectedModel)` — checks whether `createAnalysisWorker()` returns a worker, delegates the real work to `runVisionFallback` (inferenceAdapter), and stamps the result with `workerAvailable` + a `VisionRunReport` (captured flag, regions analyzed, detections, backend used, `workerOffloaded`).

#### `src/vision/inferenceAdapter.ts`
The actual frame-by-frame analysis:

- `runVisionFallback(observations, elements, selectedModel)`:
  - Empty observations or no `window` -> empty output + report.
  - `captureViewport()` (a screenshot via the background worker); on failure -> empty output + `report.error`.
  - Computes a page<-canvas scale, then for each blind spot with enough area (>= 2500 px^2) crops via `cropRegion` and runs the backend's `detect(imageData)`.
  - `guessEntityFromDetection(...)` maps detections to entities: `face` -> `FACE` entity with page-space bounds; `text`/`barcode` with `rawText` -> `detectPiiInText(rawText)` results promoted to entities (elementId = observation id, bounds in page space); otherwise a low-confidence `ADDRESS`/`ACCOUNT` ("region") entity flagged for user review.
  - Re-calibrates each observation's confidence and appends notes.

#### `src/vision/backends.ts`
The inference backends:

- `DetectionKind = "face" | "text" | "barcode" | "region"`; `VisionInference` interface (`name` + `detect(imageData)`).
- `shapeDetectionBackend()` — wraps the native Chrome **Shape Detection API** (`BarcodeDetector`, `FaceDetector`, `TextDetector`) into normalized `VisionDetection[]` (bounds converted to relative coordinates). Returns `null` when unavailable. Catches detector failures per frame type.
- `pixelAnalysisBackend()` — runs `analyzeImageBlock` through the Web Worker (`runPixelAnalysisInWorker`), falling back to the inline function; maps labels (`blank`/`face-like`/`text-like`) to detections.
- `selectInferenceBackend(task)` — for vision tasks returns a **hybrid backend** that runs shape detection AND pixel analysis, then merges results; otherwise pixel-analysis only.
- `shapeDetectionAvailable()` — advertised for model loading.

#### `src/vision/pixelAnalysis.ts`
The hand-rolled computer-vision core (no external ML):

- `sampleGrid(block)` — downsamples the image to a 64x64 grid of `{ luminance, isSkin }` samples.
- `isSkinTone(r,g,b)` — heuristic RGB inequality test.
- `analyzeImageBlock(block)` — computes mean luminance, variance, gradient density (adjacent-sample luminance jumps >28), and skin-tone ratio, then labels the region `blank` (low variance), `face-like` (skin ratio >0.35), `text-like` (gradient density >0.32), `texture` (high contrast), or `barcode-like` — each with a confidence and human-readable notes. Runs identically inline and inside the Worker.

#### `src/vision/workerHost.ts`
Real Web-Worker plumbing so pixel analysis runs off the main thread:

- `createAnalysisWorker()` — lazily creates one shared `Worker` from a Blob of the **embedded** `VISION_WORKER_SOURCE` (so the worker code needs no separate network/file, MV3-friendly). Returns `null` if `Worker`/`Blob`/`URL` are missing or instantiation throws.
- `runPixelAnalysisInWorker(block)` — posts `{ id, data, width, height }` and resolves on the matching `id` message (or the worker error event).
- `terminateAnalysisWorker()` — cleanup.

#### `src/vision/workerEntry.ts`
The worker-side script: `onmessage` validates the pixel payload, calls `analyzeImageBlock`, and posts back `{ id, ok, result }` (or `{ id, ok: false, error }`). This file only ships inside the embedded source string.

### UI directory (`src/ui/`)

These are in-page widgets, all built with **shadow DOM** so page CSS can never interfere.

#### `src/ui/consentOverlay.ts`
The consent modal. `consentOverlayUi` implements `ConsentUi`:

- Injects a shadow root into a full-screen backdrop and renders: title bar, "Agent wants to" action list (each with a colored risk pill: low/medium/high), a "Privacy scan" section (PII count, redacted regions, privacy score, uncertain count), a note that raw values never leave the device, and **Allow once / Reject** buttons.
- Secret fields are annotated `(secret field)`.
- Resolves the promise with the `ConsentDecision` on click; `removeConsentOverlay()` removes the root.

#### `src/ui/pageLauncher.ts`
The floating "PrivacyGuard" button (bottom-right). Opens a small panel with a goal `textarea` + "Run agent" button. `attachPageLauncher({ onRun })` wires it to a callback (contentScript passes a full agent cycle) and returns a cleanup function.

#### `src/ui/executionLog.ts`
`logAgentExecution(result)` — prints a structured `[agent-execution]` console payload: consent verdict, replan attempts, plan actions, per-action execution results (status + latency), and the telemetry breakdown.

#### `src/ui/dashboard.ts`
`logMetricsDashboard(metrics, selectedModel)` — prints `[rubric-dashboard]` with the five rubric subscores, weighted overall, and the selected vision model + its score.

#### `src/ui/privacyLedger.ts`
`logPrivacyLedger(context)` — prints `[privacy-ledger]` with timestamp, page URL, entity/uncertain/redacted counts, privacy score, and policy decisions. This is the audit trail every cycle writes.

### Generated directory (`src/generated/`)

#### `src/generated/visionWorkerSource.d.ts`
Type declarations for the embedded worker source: `export declare const VISION_WORKER_SOURCE: string`.

#### `src/generated/visionWorkerSource.js`
**Generated** by `scripts/embed-worker.mjs` — contains the bundled `workerEntry.ts` (iife) as a single JavaScript string constant. Do not edit by hand; regenerate with `npm --workspace @sih/extension run bundle`.

## Part 7 — How everything is built

### TypeScript config (`tsconfig.base.json` + per-workspace `tsconfig.json`)
The shared base sets `target ES2022`, `module/moduleResolution NodeNext`, strict mode, declarations, source maps, `outDir dist`, and the path alias `@sih/shared -> packages/shared/src/index.ts`. Each workspace extends it, sets `rootDir: src`, `composite: true`, and a project reference to `packages/shared`. Type emitting (`tsc`) is used both for "linting" (`--noEmit`) and, in `shared`/`server`, for producing runnable `dist` JS.

### Root scripts (`package.json`)
- `npm test` -> `npm run test --workspaces --if-present` (vitest in all three workspaces).
- `npm run bench` -> same pattern with the bench configs.
- `npm run build` -> builds shared, then server, then extension (order matters: server/extension depend on shared).
- `npm run lint` -> `tsc --noEmit` in all three workspaces.

### `packages/shared/package.json`
`build: tsc -p tsconfig.json`; `lint: tsc -p tsconfig.json --noEmit`; `test: vitest run`; `bench: vitest run --config vitest.bench.config.ts --reporter=verbose`. `type: module`, exports `./dist/index.js`, types `dist/index.d.ts`. No runtime dependencies.

### `apps/server/package.json`
Same as shared plus `start: node dist/index.js` and runtime deps `express`, `cors`, `zod`, `@sih/shared`.

### `apps/extension/package.json`
`build: tsc -p tsconfig.json && npm run bundle`, where `bundle` = `node scripts/embed-worker.mjs && node scripts/generate-icons.mjs && node build.mjs`. Only runtime dep is `@sih/shared`.

### `apps/extension/build.mjs`
The bundling step turning TypeScript into a loadable MV3 folder (`esbuild`):

- Defines `sharedOptions`: browser platform, `chrome111` target, tree-shaking, and an alias `@sih/shared -> packages/shared/src/index.ts` so the bundle inlines shared code (no external file needed at runtime).
- Wipes and re-creates `apps/extension/dist`.
- Bundles three entry points:
  - `src/content/contentScript.ts` -> `dist/content/contentScript.js` as **iife** (content scripts can't use ESM imports).
  - `src/background/serviceWorker.ts` -> `dist/background/serviceWorker.js` as **esm** (MV3 workers support modules).
  - `src/popup/popup.ts` -> `dist/popup/popup.js` as **iife**.
- Reads `manifest.json` and rewrites every `dist/...` prefix to `./...`, writing the result into `dist/manifest.json` (Chrome resolves paths relative to the unzipped root).
- Copies `popup.html`, `popup.css`, and the generated icons into `dist`.
- Prints the loadable-path hint. This is what you point Chrome at via `chrome://extensions -> Load unpacked`.

### `apps/extension/scripts/embed-worker.mjs`
Builds `src/vision/workerEntry.ts` with esbuild (bundle, iife) **without writing a file** (`write: false`), then serializes the code into the string constant `VISION_WORKER_SOURCE` written to `src/generated/visionWorkerSource.js`. Enables `new Worker(URL.createObjectURL(new Blob([VISION_WORKER_SOURCE])))` — an MV3-friendly way to run a Web Worker with no extra resources/network.

### `apps/extension/scripts/generate-icons.mjs`
Generates the extension icons (`16`, `48`, `128`) **without any image library** — a hand-rolled PNG encoder:

- CRC32 table + `chunk()` build the PNG chunks; `encodePng()` writes `IHDR`/`IDAT`/`IEND` using `zlib.deflateSync`.
- `drawIcon(size)` draws a rounded-rect blue tile (vertical gradient `#1d4ed8 -> #4338ca`) with a white shield polygon, using 3x3 supersampling and a point-in-polygon test.
- Writes `scripts/icons/icon{16,48,128}.png`. `npm --workspace @sih/extension run icons` regenerates them.

### What `dist/` contains (gitignored)
`apps/extension/dist/` = `manifest.json`, `background/serviceWorker.js`, `content/contentScript.js`, `popup/popup.html|js|css`, `icons/*.png`. `apps/server/dist/` and `packages/shared/dist/` = compiled JS + `.d.ts` (+ source maps). `.gitignore` excludes `dist/`, `node_modules/`, `.DS_Store`, `*.tsbuildinfo`.

---

## Part 8 — Extension message protocol

| From -> To | Message `{type,...}` | Response |
| --- | --- | --- |
| Popup -> Background | `RUN_TASK` (`tabId`, `goal`) | forwards the content script's `TM_TAB_SUMMARY` |
| Background -> Content | `TM_RUN_TASK` (`goal`) | `{ type: "TM_TAB_SUMMARY", ok, summary: { piiCount, redactedCount, privacyScore } }` |
| Popup -> Content | `TM_TAB_SUMMARY` | the same summary shape |
| Content -> Background | `CAPTURE_VISIBLE_TAB` | `{ ok, dataUrl }` (PNG screenshot) |
| Any -> Background | `PING` | `{ ok: true, source: "privacyguard-background" }` |

Injected UI never talks to Chrome APIs directly; everything goes through the content script (which owns the agent cycle), and the background worker owns the privileged APIs (`captureVisibleTab`, tab messaging).

## Part 9 — Tests

**61 unit tests** in total (shared 15, server 8, extension 38), run with **vitest 5**. The extension tests run under **happy-dom** (a DOM implementation for Node) with the setup file, because they touch `document`, `window`, and they polyfill `crypto`/`performance`/layout APIs. A separate **Playwright end-to-end** suite runs the whole system in real Chrome — see [Part 17](#part-17--end-to-end-tests-playwright).

### Test configs
- `apps/extension/vitest.config.ts` — `environment: "happy-dom"`, include `test/**/*.test.ts`, `setupFiles: ["./test/setup.ts"]`, aliases `@sih/shared -> shared/src/index.ts`.
- `apps/extension/vitest.bench.config.ts` — same, but include `bench/**/*.bench.ts`.
- `apps/server/vitest.config.ts` / `vitest.bench.config.ts` — `environment: "node"`, test/bench includes, same alias.
- `packages/shared/vitest.config.ts` / `vitest.bench.config.ts` — same as server.
- `apps/extension/test/setup.ts` — polyfills `globalThis.crypto` (from `node:crypto`), `globalThis.performance` (from `node:perf_hooks`), a default `getBoundingClientRect()` on `HTMLElement.prototype`, a stub `window.getComputedStyle`, and a no-op `window.scrollBy` (happy-dom lacks these layout APIs).

### `packages/shared/test/policy.test.ts` (15 tests)
The privacy-policy contract tests:
- `sanitizePageUrl` — parameterizes path segments + query values, handles origin-only URLs, falls back to `<unsafe-url>`.
- `sanitizePageTitle` — truncates to 120 chars, handles empty titles.
- `enforceTransportPolicy` — **the critical tests**: strips `matchText`/`rawValue`/`valueHint`/`attributes`/`tokenMap` and `agentId`/`enabled`/`checked`; replaces UUID `sessionId` with a domestic `sess_…` id; restricts the vision model `descriptor` to the wire-safe subset (`id`/`name`/`family`/`task`, no `approxSizeMB`/`metricFit`/etc.); asserts the serialized JSON contains no raw Aadhaar/email/name; marks sensitive element text with the token.
- `findSensitiveValuesInText` — detects Aadhaar + PAN, returns nothing for benign text.
- `assertNoRawSensitiveValues` — passes clean payloads, throws `PrivacyFirewallError` on a raw PAN; a decimal float artifact (e.g. `0.7833333333333333`) produces no CARD_NUMBER match while a genuine 16-digit card still does.

### `apps/server/test/api.test.ts` (8 tests)
Runs the real Express app in-process via **supertest**:
- `GET /health` returns `{ ok, service: "sih-privacy-planner-v3" }`.
- `POST /api/plan` returns a deterministic plan with guardrail notes and a consent flag.
- Server notes echo "Private field probe: clean".
- **Rejection tests**: 400 when `matchText` is smuggled into entities; 400 when `rawValue` is smuggled; 400 when an untyped `tokenMap` appears on the wire; 400 + flattened `error` for malformed requests.
- **Error handler**: when a route throws, the centralized handler returns `{ error: "Internal server error." }` with a JSON error log and never leaks the exception message.

### Extension tests (`apps/extension/test/`)
- `piiDetector.test.ts` (7) — regex channel (Aadhaar, PAN+email, `+91` mobile, benign); structural channel (password inputs -> PASSWORD >=0.9 confidence); dedupe/calibration (a card number found in both `text` and `placeholder` yields exactly one entity); `detectPiiInText` for the OCR path.
- `redactor.test.ts` (4) — tokenizes `matchText` and never keeps raw values in `redactedText`; marks password/low-confidence as `restricted`; keeps unrelated elements `public`; uses entity-level bounds when present.
- `networkFirewall.test.ts` (4) — a sanitized payload passes all checks; a tampered payload with `rawValue`/`matchText` smuggled back in is caught; a raw PAN leaked into `pageTitle` fails the regex scan; `assertTransportIsSafe` returns a tokenMap-free payload.
- `consentManager.test.ts` (8) — auto-approves low-risk in balanced mode; prompts for medium + server consent flag; prompts on high risk; prompts on high-confidence security signal; prompts when detections are uncertain; strict vs demo modes; `requestConsent` returns the auto-decision without calling the UI, and calls the UI when a prompt is required.
- `actionExecutor.test.ts` (6) — CLICK on a resolved target fires the handler; CLICK fails when the target is missing; TYPE resolves `<PASSWORD_1>` from the local raw-value map (and fires input + change); TYPE refuses unresolved tokens; WAIT acknowledged; CONFIRM_REQUIRED skipped.
- `domExtractor.test.ts` (5) — extracts interactive elements with agent ids; excludes hidden standalone text; resolves by agent id; falls back to selectors and returns null for ghosts; extracts a context that survives JSON transport.
- `pixelAnalysis.test.ts` (4) — 64x64 grid sampling; blank labelling of uniform blocks; `text-like` for high-contrast checkerboards; `face-like` for a skin-tone-dominant region.

Run any/all with `npm test` (root) or per-workspace `npm --workspace <name> run test`.

---

## Part 10 — Benchmarks

Benches are **self-timed tests**: each one times a warm loop with `performance.now()` inside a normal vitest `test()`, asserts a sane floor, and prints an `[bench]` line. The `--reporter=verbose` flag is essential — otherwise vitest hides `console.log` output. (Note: vitest 5 no longer exposes a top-level `bench()`; the earlier `vitest bench` attempt was replaced with this self-timed approach.)

Files and what they measure (representative numbers from a MacBook-class machine — treat as indicative, they vary run to run):

- `packages/shared/bench/privacy.bench.ts`
  - Ground-truth quality of the regex detector over a 12-sample corpus (Aadhaar, PAN, email, phone, UPI, IFSC, GSTIN, DOB, card + 3 benign): **precision 1.0 / recall 1.0 / accuracy 1.0** (asserted: precision >0.9, recall >0.85, accuracy >0.9).
  - `enforceTransportPolicy`: ~37–39k ops/sec (asserted >100).
  - Leak-proof serialization (enforce + `assertNoRawSensitiveValues` + JSON): ~9k ops/sec (asserted >50).
- `apps/extension/bench/onDevice.bench.ts`
  - `analyzeImageBlock` on random 64x64 blocks: ~3.5–3.6k ops/sec (asserted >50).
  - `detectPii` on a mixed DOM: ~68–69k ops/sec (asserted >100).
  - `detectPiiInText` over OCR lines: ~127k ops/sec (asserted >200).
- `apps/server/bench/api.bench.ts`
  - `POST /api/plan` (deterministic planner via supertest): ~800–893 req/sec (asserted >30).

Run with `npm run bench` (root) or per-workspace. CI runs them as a smoke gate.

---

## Part 11 — CI

`.github/workflows/ci.yml` — three jobs on `ubuntu-latest` (Node 24, npm cache), triggered on push/PR to `main`:

1. `verify`:
   1. `npm ci`
   2. `npm run lint` (tsc `--noEmit` in all workspaces)
   3. `npm run build` (shared -> server -> extension, incl. worker embedding + icons)
   4. `npm test` (61 tests)
   5. `npm run bench` (benchmark smoke gate)
   6. MV3 artifact checks — asserts `dist/manifest.json`, `dist/content/contentScript.js`, `dist/background/serviceWorker.js`, `dist/popup/popup.js` exist and that the manifest is MV3 with a service worker.
2. `e2e` (depends on `verify`) — installs the system **Google Chrome** (via `browser-actions/setup-chrome`) and runs the Playwright suite with `E2E_CHANNEL=chrome` so the MV3 extension runs under headless-new. See [Part 17](#part-17--end-to-end-tests-playwright).
3. `docker` (depends on `verify`) — validates `docker compose config`, builds the image, **asserts `extension.pem`/`extension.crx` never enter the build context** (building the `build` stage and checking the file is absent), then boots via `docker compose up ... -d`, waits for the health check, hits `GET /health`, and tears down in an `always()` step. This gives real, reproducible Docker verification even on machines without Docker.

## Part 12 — Configuration reference

### Server environment variables (`apps/server`)

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `RATE_LIMIT_MAX` | `120` | Max requests per IP per 60 s window |
| `PLANNER_API_KEY` or `OPENAI_API_KEY` | _(unset)_ | Presence enables the LLM planner |
| `PLANNER_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible chat-completions base URL |
| `PLANNER_MODEL` | `gpt-4o-mini` | LLM model name |

The LLM planner fails soft: any error, timeout, or schema mismatch makes `buildPlanWithLlm` return `null`, and the deterministic `buildPlan` takes over.

### Extension constant
`DEFAULT_SERVER_URL` in `apps/extension/src/index.ts` (default `http://localhost:8080`) is where the agent looks for the planner. Change it with `createAgentCycleOptions({ serverUrl: ... })` or edit the constant.

### Runtime modes
- Consent modes: `"strict"` (aggressive prompting), `"balanced"` (default: prompt on medium/high risk, security signals, uncertainty), `"demo"` (only forced prompts).
- Execution tiers: `lite` / `balanced` / `performance` selected by CPU cores + WebGPU.
- Execution modes: `webgpu` / `wasm` / `cpu` selected by GPU availability + device memory.

---

## Part 13 — Design decisions & fail-safe behavior

- **Defense in depth for privacy**: policy construction (structurally impossible to add private fields) + client firewall (re-scans serialized payload) + strict server schemas + server raw-field probe + forced-consent thresholds. Any one layer catching a leak aborts the request.
- **Consent gates before execution**: the plan is never executed before passing local validation AND the consent flow. Rejection stops the cycle with zero actions.
- **Target integrity (fail-closed)**: actions reference stable `data-agent-id`s; before any click/type the executor re-resolves the node and re-verifies role/accessible-name/bounds. Moved, removed, or replaced elements -> the action fails with a message. `body`/`html` can never be targeted.
- **Local-first typing**: `<TOKEN>` values are resolved against the local raw-value map at type time. Unresolvable tokens cause a refusal — the agent never types a secret it can't prove it owns.
- **Deterministic fallback planning**: the server always has a working non-LLM planner, and the extension has an offline local planner, so the system degrades to "suggest a safe public click" rather than failing.
- **LLM can't hallucinate**: LLM plans are validated against the zod schema and every action is filtered to known element ids.
- **Vision degrades gracefully**: Worker -> inline pixel analysis -> Shape Detection API availability is probed each run; a failed screenshot or crop just produces empty observations with a report note.
- **Benchmarks are honest**: self-timed warm loops with assertions, printed `[bench]` lines, not micro-optimized-with-warmup-fencing races.

---

## Part 14 — Common gotchas

- **`dist/` is wiped on every extension build** (`build.mjs` `rmSync`). The extension's `dist` contains only the bundler output; the `tsc` emit pass is immediately overwritten. `packages/shared/dist` and `apps/server/dist` are normal tsc outputs and survive.
- **`@sih/shared` resolution in non-build tools**: vitest configs and `tsconfig.base.json` alias `@sih/shared` to the **source** `index.ts`, so tests/benches always run TypeScript. The esbuild alias does the same for the bundle. Node `start` (server) uses the compiled `dist`.
- **`npm run bench` needs `--reporter=verbose`** to show the `[bench]` console lines (already baked into the workspace scripts).
- **happy-dom lacks browser layout APIs** — `crypto`, `performance`, `getBoundingClientRect`, `getComputedStyle`, and `scrollBy` are stubbed in `apps/extension/test/setup.ts`. When adding DOM-dependent tests, rely on those stubs.
- **Regex `g`-flag reuse** — `findSensitiveValuesInText` and `detectPii` reset `lastIndex`; never reuse a global regex across iterations without resetting.
- **Path with spaces** — this repo's path contains spaces; always quote shell paths when running commands.
- **Playwright config runs with cwd = `e2e/`** — `webServer.command` paths (the static test page and the built server) are `./`-relative to `e2e/`, not the repo root. The root `npm run e2e` builds first, so the server `dist` exists.
- **No `"type": "module"` at the root** — Playwright loads `.ts` configs/helpers as CJS, so use `__dirname` (not `import.meta`) and `require`-style imports in `e2e/`.
- **Extensions need real Chrome, not the headless shell** — Playwright's bundled Chromium with `--load-extension` only works **headed**; on CI set `E2E_CHANNEL=chrome` (system Chrome) so headless-new supports extensions. Locally the harness defaults to headed bundled Chromium.
- **Shielded selectors** — consent-overlay buttons live in a shadow root (`#privacy-guard-consent-root`); Playwright pierces it, but there is **one pill per action** so use `.pg-risk.first()`, and the allow/reject buttons are `.pg-btn-allow` / `.pg-btn-reject` (there is no `.pg-allow`).
- **UUID-shaped strings trip the fail-closed firewall** — the old `CARD_NUMBER` regex matched any 13–19 digit run, and UUIDs (`agentId`, `sessionId`) literally matched. The firewall now strips `agentId`, replaces `sessionId` with a domestic `sess_…` id, and `CARD_NUMBER` uses `(?<!\.)` to ignore decimal fractions.
- **JS float artifacts match `CARD_NUMBER`** — serialized metric divisions (e.g. `0.7833333333333333`) used to match the digit tail. Sub-scores and `detectionSummary` estimates are rounded to 4 decimal places (`round4`) before transport.

---

## Part 15 — Quick file reference (path -> one-line purpose)

### Root
- `package.json` — monorepo root: workspaces, scripts (`test`/`bench`/`build`/`lint`), metadata, devDependencies.
- `package-lock.json` — dependency lockfile (used by CI's `npm ci`).
- `tsconfig.base.json` — shared TS options + `@sih/shared` path alias.
- `.gitignore` — ignores `node_modules`, `dist`, `.DS_Store`, `*.tsbuildinfo`, `.env`, Playwright `test-results/`/`playwright-report/`.
- `.env.example` — template for server env vars.
- `Dockerfile` / `.dockerignore` — multi-stage image for the planner server.
- `docker-compose.yml` — one-command local deployment of the planner.
- `.github/workflows/ci.yml` — CI pipeline: `verify` (lint/build/test/bench/artifact checks), `e2e` (Playwright on system Chrome), and `docker` (build + compose healthcheck + key-exclusion assertion).
- `README.md` — this document.

### `packages/shared/`
- `src/index.ts` — barrel export of the shared package.
- `src/contracts.ts` — every shared TypeScript type (the system vocabulary).
- `src/patterns.ts` — PII regex patterns + `findSensitiveValuesInText` + `assertNoRawSensitiveValues`.
- `src/policy.ts` — `enforceTransportPolicy`, URL/title sanitizers, wire-shape mapping.
- `test/policy.test.ts` — 15 privacy-policy contract tests.
- `bench/privacy.bench.ts` — ground-truth quality + transport-enforcement throughput benches.
- `package.json` / `tsconfig.json` / `vitest.config.ts` / `vitest.bench.config.ts` — package + build/test config.

### `apps/server/`
- `src/index.ts` — server bootstrap (`createApp().listen`).
- `src/app.ts` — Express app: CORS, rate limit, `/health`, `/api/plan` (+ raw-field probe), centralized error handler.
- `src/schema.ts` — strict zod schemas for every wire object.
- `src/planner/buildPlan.ts` — deterministic fallback planner.
- `src/planner/llmPlanner.ts` — optional OpenAI-compatible LLM planner.
- `src/security/serverPolicy.ts` — server-side forced-consent policy.
- `test/api.test.ts` — 8 supertest API tests.
- `bench/api.bench.ts` — `/api/plan` throughput bench.
- `package.json` / `tsconfig.json` / `vitest.config.ts` / `vitest.bench.config.ts` — config.

### `apps/extension/`
- `manifest.json` — MV3 manifest (permissions, entry points, icons).
- `build.mjs` — esbuild bundling + manifest rewrite into `dist`.
- `scripts/embed-worker.mjs` — bundles `workerEntry.ts` into `generated/visionWorkerSource.js`.
- `scripts/generate-icons.mjs` — generates icon PNGs without image libraries.
- `scripts/icons/icon{16,48,128}.png` — generated icons.
- `src/index.ts` — extension API: `DEFAULT_SERVER_URL`, `createAgentCycleOptions`, `runAgentCycleOnPage`.
- `src/background/serviceWorker.ts` — PING / CAPTURE_VISIBLE_TAB / RUN_TASK message handling.
- `src/content/contentScript.ts` — page-side entry (agent cycle + launcher wiring).
- `src/popup/popup.{html,css,ts}` — toolbar popup UI.
- `src/pipeline/agentCycle.ts` — cycle orchestrator (observe->plan->guard->consent->execute).
- `src/pipeline/domExtractor.ts` — DOM -> `UiElement[]` + target resolution/signature matching.
- `src/privacy/piiDetector.ts` — three-channel PII detection (regex/structural/heuristic-NER).
- `src/privacy/redactor.ts` — token-based redaction + tokenMap + redaction regions.
- `src/privacy/networkFirewall.ts` — client firewall (`assertTransportIsSafe`).
- `src/runtime/actionExecutor.ts` — executes CLICK/TYPE/SCROLL/WAIT actions.
- `src/runtime/actionGuardian.ts` — local plan re-validation (drops unsafe/moved actions).
- `src/runtime/consentManager.ts` — consent-mode logic + `ConsentUi` interface.
- `src/runtime/runtimeProfile.ts` — device capability probe (tier + mode).
- `src/transport/client.ts` — server client (posting, retries, offline fallback).
- `src/transport/payloadMinimizer.ts` — caps payload sizes before upload.
- `src/security/promptInjectionGuard.ts` — injection-phrase scanner -> security signals.
- `src/metrics/telemetry.ts` — stage timers.
- `src/metrics/metricsEngine.ts` — rubric metrics + privacy score inputs.
- `src/capture/screenshot.ts` — `CAPTURE_VISIBLE_TAB` bridge + image decode/crop.
- `src/vision/domBlindSpotDetector.ts` — finds canvas/video/iframe blind spots.
- `src/vision/modelCatalog.ts` — the 4-model descriptor catalog.
- `src/vision/modelSelector.ts` — rubric-based model selection + trace.
- `src/vision/modelLoader.ts` — backend warmup + availability report.
- `src/vision/workerAdapter.ts` — runs inference and reports worker availability.
- `src/vision/inferenceAdapter.ts` — viewport capture -> per-blind-spot analysis -> entities.
- `src/vision/backends.ts` — Shape Detection + pixel-analysis backends, hybrid selector.
- `src/vision/pixelAnalysis.ts` — the pixel-level vision classifier (no external ML).
- `src/vision/workerHost.ts` — Blob-worker creation + request/response plumbing.
- `src/vision/workerEntry.ts` — worker-side entry (runs inside the embedded source).
- `src/ui/consentOverlay.ts` — shadow-DOM consent modal.
- `src/ui/pageLauncher.ts` — floating goal-input launcher button.
- `src/ui/executionLog.ts` — `[agent-execution]` console log.
- `src/ui/dashboard.ts` — `[rubric-dashboard]` console log.
- `src/ui/privacyLedger.ts` — `[privacy-ledger]` audit log.
- `src/generated/visionWorkerSource.{js,d.ts}` — embedded worker code (generated).
- `test/{setup,piiDetector,redactor,networkFirewall,consentManager,actionExecutor,domExtractor,pixelAnalysis}.test.ts` — 38 tests + env stubs.
- `bench/onDevice.bench.ts` — pixel-analysis + PII-detection throughput benches.
- `package.json` / `tsconfig.json` / `vitest.config.ts` / `vitest.bench.config.ts` — config.

---

## Quick start

```bash
npm install          # install everything (hoisted into a root node_modules)
npm run lint         # type-check all workspaces (tsc --noEmit)
npm run test         # run all 61 unit tests
npm run bench        # run all benchmarks (verbose [bench] lines)
npm run build        # shared -> server -> extension (loadable MV3 bundle)
npm run e2e          # build + full Playwright E2E suite against real Chrome (see Part 17)
```

Run the planner server:

```bash
npm --workspace @sih/server run start     # http://localhost:8080
curl http://localhost:8080/health
```

Load the extension:

1. `npm --workspace @sih/extension run build`
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** -> `apps/extension/dist`.
4. Keep the server running (or let the extension fall back to its offline planner — consent is always required in that mode).

Then open any page, click the shield launcher (or the toolbar popup), type a goal, approve the consent overlay, and watch the console for `[privacy-ledger]`, `[rubric-dashboard]`, and `[agent-execution]`.

---

## Part 16 — Deployment

The **extension** is distributed separately (Load unpacked / Chrome Web Store — see Quick start). Everything required to run the **planner server** in production is included and is verified by the CI pipeline and an end-to-end Docker-runtime check.

### 1. Plain Node (recommended for a VM)

```bash
npm ci --omit=dev --include-workspace-root     # production deps only
npm run build --workspace @sih/shared
npm run build --workspace @sih/server           # emits apps/server/dist
npm --workspace @sih/server run start           # NODE_ENV=production, HOST=0.0.0.0:8080
```

### 2. Docker / docker-compose

```bash
npm run docker:build        # docker build -t sih-privacyguard-planner .
npm run docker:up           # docker compose up --build -d
```

`docker-compose.yml` runs the image on the host port `8080` (env `PORT` inside the container) with a restart policy and a health check (`node -e "fetch('http://127.0.0.1:8080/health')…"` — alpine images have no `curl`). `env_file: .env` is optional (`required: false`).

The `Dockerfile` is multi-stage: a deps stage runs `npm ci`, a build stage compiles `@sih/shared` + `@sih/server`, and a slim runtime stage runs `npm ci --omit=dev --include-workspace-root`, copies only the built `dist`, and starts with `node apps/server/dist/index.js`.

### Production hardening

- **Bind + proxy**: `HOST` defaults to `0.0.0.0` (so `localhost`/`::1` from Chrome is reachable); behind a proxy set `TRUST_PROXY=true` to honor `X-Forwarded-For` for rate limiting (never expose 0.0.0.0 directly to the internet — put it behind a reverse proxy/TLS).
- **Headers**: `helmet` is applied in `createApp()`.
- **Rate limiting**: `RATE_LIMIT_MAX` (default 120) requests per IP per 60 s.
- **Logging**: JSON logs at `info` (type `startup`/`access`/`error`); `LOG_LEVEL` controls it.
- **Graceful shutdown**: SIGINT/SIGTERM drain active connections with a 3.5 s cap then exit.
- **Never send raw PII**: the wire contract is token-only; the server's strict zod schemas + a raw-field probe reject any smuggled value.
- **Centralized error handling**: any thrown route error is logged as JSON (`level: "error"`, `type: "error"`) and answered with a generic `{ error: "Internal server error." }` — stack traces and messages stay server-side only (the CI error-handler test proves no leakage).

### 3. Packing the extension (CRX)

For self-distribution, pack the built extension from `chrome://extensions` → **Pack extension** → select `apps/extension/dist`. This produces:

- `apps/extension.crx` — the distributable, signed package (add to your site / internal store).
- `apps/extension.pem` — the **private signing key**.

> **Security**: the `.pem` is a signing secret. It must **never** be committed or placed in a Docker build context. Both `*.pem` and `*.crx` are gitignored and dockerignored on purpose; the CI `docker` job asserts the key never enters the image. Back up the `.pem` — if you lose it you cannot issue updates to the same extension ID. (If you already have one, keep using it so the ID stays stable.)

For the **Chrome Web Store** path, skip CRX and upload a ZIP of `apps/extension/dist` — the store signs and assigns the ID.

### Env reference (see Part 12)

`PORT`, `CORS_ORIGIN`, `RATE_LIMIT_MAX`, `TRUST_PROXY`, `LOG_LEVEL`, and optional `PLANNER_API_KEY` / `PLANNER_BASE_URL` / `PLANNER_MODEL`. Copy `.env.example` to `.env` and fill in what you need.

---

## Part 17 — End-to-end tests (Playwright)

Beyond the 61 unit tests, `e2e/` runs the **whole system in a real Chrome** with the built MV3 extension loaded via `--load-extension` (the same path a human uses). It launches a persistent context, opens `e2e/test-page/index.html` (served on `127.0.0.1:3020`), drives the launcher, and asserts the full agent cycle.

### What `agent-cycle.spec.ts` verifies

1. **Launcher + consent overlay** — the content script injects the shadow-DOM launcher; running the agent pops the consent modal with a risk pill and a "N PII found" scan chip.
2. **Approve path** — approving executes the deterministic plan (a CLICK on the submit button), the application is actually submitted (`#status` becomes **"Submitted by agent"**), and the privacy ledger is written to the console.
3. **Reject path** — rejecting stops the cycle with **"Rejected. 0 action(s) executed."** and the page stays ready.
4. **Wire contract on the real network** — the captured `POST /api/plan` body contains no raw PII values (Aadhaar/phone/PAN/card/name), carries typed tokens (`<AADHAAR_3>`), a non-UUID domestic `sessionId` (`sess_…`), no `valueHint`/`attributes`/`enabled`/`checked`, a wire-safe vision `descriptor`, and rounded float metrics.

### Running it

```bash
npm run e2e            # builds then runs the 2-test suite (bundled Chromium, headed)
npm run e2e:headed     # force headed mode locally
npx playwright test --config e2e/playwright.config.ts   # E2E_CHANNEL=chrome on CI
```

On CI, the `e2e` job installs system **Google Chrome** and sets `E2E_CHANNEL=chrome` so headless-new supports MV3 extensions. Locally it defaults to Playwright's bundled Chromium in **headed** mode. `workers: 1`, `retries` on CI only, and `github` + `list` reporters in CI.

### Key files

- `e2e/playwright.config.ts` — headed/`E2E_CHANNEL` logic; `webServer` starts the static test page (`` `node serve-test-page.mjs` ``) and the built planner server (paths relative to `e2e/`).
- `e2e/helpers/launch-extension.ts` — persistent-context launcher with `--load-extension`, `--no-sandbox`, and the MV3 extension-id capture.
- `e2e/serve-test-page.mjs` — minimal static server (no external deps) on `127.0.0.1:3020`.
- `e2e/test-page/index.html` — the bank-application fixture with Aadhaar, mobile, PAN, card fields and a submit button.
- `e2e/agent-cycle.spec.ts` — the two E2E tests.