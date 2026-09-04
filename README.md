# SIH_2026

Privacy-preserving browser agent starter for SIH 2026 problem statement **"On-device Visual Perception for Light-weight Browser Agents"**.

## Exact implementation blueprint

## Folder structure

```text
/home/runner/work/SIH_2026/SIH_2026
├── apps
│   ├── extension
│   │   └── src
│   │       ├── index.ts                    # agent cycle orchestrator
│   │       ├── pipeline/domExtractor.ts    # DOM-first perception
│   │       ├── privacy/piiDetector.ts      # India-aware PII detection
│   │       ├── privacy/redactor.ts         # token remapping + masking metadata
│   │       ├── runtime/actionGuardian.ts   # local policy gate before execution
│   │       ├── transport/client.ts         # sanitized payload transport
│   │       └── ui/privacyLedger.ts         # audit visibility for demo
│   └── server
│       └── src/index.ts                    # planner API with schema validation
├── packages
│   └── shared
│       └── src
│           ├── contracts.ts                # canonical request/response schema
│           ├── policy.ts                   # privacy transport policy
│           └── index.ts
└── tsconfig.base.json
```

## Module responsibilities

1. **DOM Extractor**: capture role/text/bounds/path for actionable elements; avoid raw full-frame transfer.
2. **PII Detector**: detect Aadhaar, PAN, GSTIN, UPI, Indian phone, email, password signals.
3. **Redactor**: replace sensitive spans with typed tokens and mark sensitive regions.
4. **Transport Policy**: enforce zero raw sensitive fields before network call.
5. **Server Planner**: interpret sanitized context and return bounded, confidence-scored actions.
6. **Action Guardian**: locally filter unsafe/low-confidence/high-risk actions.
7. **Privacy Ledger**: log what was redacted and privacy score for evaluator-visible trust.

## Milestone-by-milestone build order

1. **M1 – End-to-end loop**: client extraction -> sanitize -> server plan -> local validation.
2. **M2 – Strong PII**: regex + NER + structural rules for Indian context.
3. **M3 – Vision fallback**: process canvas/video/DOM-blind segments with lightweight model.
4. **M4 – Consent + policy UX**: allow user review for uncertain/high-risk transmissions/actions.
5. **M5 – Metrics dashboard**: live scoring for accuracy, PII recall/precision, redaction precision, resource use, latency.
6. **M6 – Benchmark + hardening**: payload minimization, worker offload, adversarial UI/prompt-injection checks.

## Run

```bash
npm install
npm run build
```

Server start:

```bash
npm --workspace @sih/server run start
```
