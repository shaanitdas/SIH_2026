# SIH_2026

Privacy-preserving browser agent prototype for SIH 2026 problem statement **"On-device Visual Perception for Light-weight Browser Agents"**.

This repository now implements **M1 through M6** in a working architecture scaffold with end-to-end contracts, client privacy firewalling, server planning, consent gates, metrics, and hardening hooks.

---

## 1) Final architecture (implemented)

```text
/home/runner/work/SIH_2026/SIH_2026
├── apps
│   ├── extension
│   │   └── src
│   │       ├── index.ts
│   │       ├── metrics/metricsEngine.ts
│   │       ├── pipeline/domExtractor.ts
│   │       ├── privacy/piiDetector.ts
│   │       ├── privacy/redactor.ts
│   │       ├── runtime/actionExecutor.ts
│   │       ├── runtime/actionGuardian.ts
│   │       ├── runtime/consentManager.ts
│   │       ├── runtime/runtimeProfile.ts
│   │       ├── security/promptInjectionGuard.ts
│   │       ├── transport/client.ts
│   │       ├── transport/payloadMinimizer.ts
│   │       ├── ui/dashboard.ts
│   │       ├── ui/privacyLedger.ts
│   │       └── vision
│   │           ├── domBlindSpotDetector.ts
│   │           ├── inferenceAdapter.ts
│   │           └── workerAdapter.ts
│   └── server
│       └── src
│           ├── index.ts
│           ├── planner/buildPlan.ts
│           └── security/serverPolicy.ts
├── packages
│   └── shared
│       └── src
│           ├── contracts.ts
│           ├── index.ts
│           └── policy.ts
├── package.json
└── tsconfig.base.json
```

---

## 2) Milestone-by-milestone completion

## M1 — End-to-end loop (Completed)

### Goal
Create a working closed loop: capture UI context locally, sanitize it, send to server planner, receive plan, validate locally.

### What is implemented
- Local DOM extraction of actionable UI elements.
- Local PII scan + local redaction.
- Structured sanitized context sent to planner API.
- Server returns bounded action plan.
- Local guard validates actions before execution.

### Files powering M1
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/pipeline/domExtractor.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/privacy/piiDetector.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/privacy/redactor.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/transport/client.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/server/src/index.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/server/src/planner/buildPlan.ts`

---

## M2 — Strong PII detection and redaction precision (Completed)

### Goal
Improve privacy quality for scoring metrics: strong recall + precision with Indian-context signals.

### What is implemented
- **Layered detector strategy**:
  - Regex channel (Aadhaar, PAN, GSTIN, UPI, IFSC, phone, email, card-like, DOB).
  - Structural channel (password/account/address semantics from UI context).
  - Heuristic NER channel (name-like patterns/honorifics/context labels).
- **Entity calibration + dedupe**:
  - Merge duplicate detections across channels by key.
  - Increase confidence when multi-signal overlap exists.
- **Token remapping redaction**:
  - Replace sensitive values with typed semantic tokens.
  - Mark low-confidence or password-like fields as `restricted`.
  - Export `tokenMap` for private local remapping context.
- **Detection summary**:
  - Store recall estimate, precision estimate, uncertainty count for downstream gates.

### Files powering M2
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/privacy/piiDetector.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/privacy/redactor.ts`
- `/home/runner/work/SIH_2026/SIH_2026/packages/shared/src/contracts.ts`

---

## M3 — Vision fallback for DOM-blind regions (Completed)

### Goal
Handle UI areas where DOM extraction is blind (canvas/video/iframe).

### What is implemented
- DOM-blind region detector for canvas/video/iframe blocks.
- Vision fallback adapter abstraction that converts blind regions into vision observations + potential sensitive entities.
- Worker-like async execution wrapper (`workerAdapter`) so vision runs can be offloaded without blocking flow.
- Vision entities are merged with DOM-driven entities before redaction and policy checks.

### Files powering M3
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/vision/domBlindSpotDetector.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/vision/inferenceAdapter.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/vision/workerAdapter.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/index.ts`

---

## M4 — Consent + policy UX and fail-safe behavior (Completed)

### Goal
Guarantee “privacy-by-default”: uncertain/high-risk paths require consent.

### What is implemented
- Local consent manager blocks autonomous execution when:
  - high-confidence malicious signal exists,
  - plan is medium/high-risk,
  - uncertain redaction exists.
- Local action guardian enforces confidence floors and target existence.
- High-risk actions are dropped before execution.
- Planner + server policy can force consent on low privacy score or severe signals.
- Privacy ledger logs policy decisions for transparent auditability.

### Files powering M4
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/runtime/consentManager.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/runtime/actionGuardian.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/runtime/actionExecutor.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/server/src/security/serverPolicy.ts`
- `/home/runner/work/SIH_2026/SIH_2026/packages/shared/src/policy.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/ui/privacyLedger.ts`

---

## M5 — Rubric-aware metrics dashboard (Completed)

### Goal
Directly optimize and display the five SIH evaluation metrics.

### What is implemented
- Metrics engine computing normalized metric values for:
  - visual context accuracy,
  - PII recall/precision,
  - redaction precision,
  - client resource utilization,
  - end-to-end latency.
- Weighted overall score exactly following SIH weights.
- Dashboard logger output to make metric awareness visible during demos.

### Files powering M5
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/metrics/metricsEngine.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/ui/dashboard.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/index.ts`
- `/home/runner/work/SIH_2026/SIH_2026/packages/shared/src/contracts.ts`

---

## M6 — Benchmark + hardening (Completed)

### Goal
Improve robustness against attacks and low-resource constraints.

### What is implemented
- Prompt-injection detector over on-screen text.
- Transport payload minimizer to cap data volume and latency.
- Strict transport policy to ensure sensitive values never leave client in raw form.
- Runtime profile detection for adaptive mode awareness (`webgpu`/`wasm`/`cpu`, tiering).
- Server-side schema validation + guardrail notes + consent forcing.

### Files powering M6
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/security/promptInjectionGuard.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/transport/payloadMinimizer.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/transport/client.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/extension/src/runtime/runtimeProfile.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/server/src/index.ts`
- `/home/runner/work/SIH_2026/SIH_2026/apps/server/src/planner/buildPlan.ts`
- `/home/runner/work/SIH_2026/SIH_2026/packages/shared/src/policy.ts`

---

## 3) End-to-end runtime flow

1. `index.ts` starts agent cycle.
2. `domExtractor.ts` captures visible actionable DOM context.
3. `domBlindSpotDetector.ts` identifies non-DOM visual zones.
4. `piiDetector.ts` runs layered entity detection.
5. `workerAdapter.ts + inferenceAdapter.ts` add vision fallback entities.
6. `redactor.ts` tokenizes/masks and builds `tokenMap` + redaction regions.
7. `promptInjectionGuard.ts` emits security signals.
8. `metricsEngine.ts` computes rubric score snapshot.
9. `policy.ts + payloadMinimizer.ts + client.ts` enforce and transmit minimal sanitized context.
10. Server validates request, applies `serverPolicy.ts`, and builds constrained plan.
11. `actionGuardian.ts` and `consentManager.ts` enforce local final safety.
12. `actionExecutor.ts` executes only allowed actions; logs via ledger/dashboard.

---

## 4) How this maps to SIH judging criteria

- **Visual context accuracy (25%)**: DOM-first extraction + vision fallback for blind regions.
- **PII recall/precision (20%)**: layered regex + structural + heuristic NER for India-oriented identifiers.
- **Redaction precision (20%)**: typed token remapping + restricted handling for uncertainty/password fields.
- **Client resource utilization (20%)**: adaptive runtime profiling + payload minimization + worker-like async path.
- **Latency (15%)**: compact payload + bounded schema + reduced outbound text volumes.

---

## 5) Build and run

```bash
cd /home/runner/work/SIH_2026/SIH_2026
npm install
npm run build
npm run lint
```

Start planner server:

```bash
cd /home/runner/work/SIH_2026/SIH_2026
npm --workspace @sih/server run start
```

---

## 6) Next engineering upgrades (optional for competition polishing)

- Replace heuristic NER with on-device quantized NER model.
- Plug real face/text-region detector for image fallback.
- Add true extension UI popup for consent workflow (approve/reject per action).
- Add benchmark harness with replay datasets and confusion matrices for PII detection.
- Add integration tests with synthetic pages containing controlled PII patterns.
