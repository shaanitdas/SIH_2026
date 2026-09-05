import { ActionPlan, ConsentDecision, SanitizedContext } from "@sih/shared";
import { ConsentUi } from "../runtime/consentManager.js";

const OVERLAY_ROOT_ID = "privacy-guard-consent-root";

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; }
  .pg-backdrop {
    position: fixed; inset: 0; z-index: 2147483646;
    background: rgba(15, 23, 42, 0.55);
    display: flex; align-items: center; justify-content: center;
  }
  .pg-card {
    width: min(480px, calc(100vw - 32px));
    background: #ffffff; color: #0f172a; border-radius: 14px;
    box-shadow: 0 24px 64px rgba(0,0,0,0.35); padding: 20px; max-height: 84vh; overflow: auto;
  }
  .pg-title { font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
  .pg-badge {
    background: #0ea5e9; color: #fff; font-size: 11px; font-weight: 700;
    border-radius: 999px; padding: 2px 10px; letter-spacing: 0.3px;
  }
  .pg-section { margin-top: 14px; }
  .pg-h { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; }
  .pg-action {
    display: flex; justify-content: space-between; align-items: center; gap: 8px;
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
    padding: 8px 10px; margin-top: 6px; font-size: 13px;
  }
  .pg-risk { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
  .pg-risk-low { background: #dcfce7; color: #15803d; }
  .pg-risk-medium { background: #fef9c3; color: #a16207; }
  .pg-risk-high { background: #fee2e2; color: #b91c1c; }
  .pg-scan { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .pg-chip { font-size: 12px; background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; border-radius: 999px; padding: 3px 10px; }
  .pg-chip-warn { background: #fffbeb; color: #b45309; border-color: #fde68a; }
  .pg-note { font-size: 12px; color: #475569; margin-top: 8px; line-height: 1.5; }
  .pg-btns { display: flex; gap: 10px; margin-top: 18px; }
  .pg-btn {
    flex: 1; border: 0; border-radius: 10px; padding: 12px 0; font-size: 14px; font-weight: 700; cursor: pointer;
  }
  .pg-btn-allow { background: #16a34a; color: #fff; }
  .pg-btn-allow:hover { background: #15803d; }
  .pg-btn-reject { background: #f1f5f9; color: #334155; }
  .pg-btn-reject:hover { background: #e2e8f0; }
`;

function riskLabel(risk: string): string {
  return `<span class="pg-risk pg-risk-${risk}">${risk.toUpperCase()}</span>`;
}

async function prompt(
  plan: ActionPlan,
  context: SanitizedContext,
): Promise<ConsentDecision> {
  const host = document.createElement("div");
  host.id = OVERLAY_ROOT_ID;
  host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;

  const isSensitive = (elementId: string): boolean =>
    context.elements.find((element) => element.id === elementId)?.sensitivity !== "public";

  const actionRows = plan.actions
    .map((action) => {
      const targetInfo = action.targetElementId
        ? context.elements.find((element) => element.id === action.targetElementId)
        : undefined;
      const label = targetInfo?.accessibleName ?? targetInfo?.role ?? action.type;
      const secret = isSensitive(action.targetElementId ?? "") ? " (secret field)" : "";
      return `<div class="pg-action">
        <div><strong>${action.type}</strong> ${label}${secret}</div>
        ${riskLabel(action.riskLevel)}
      </div>`;
    })
    .join("");

  const scans = [
    { label: `${context.sensitiveEntities.length} PII found`, sensitive: true },
    { label: `${context.redactedRegions.length} regions redacted`, sensitive: true },
    { label: `Privacy score ${Math.round(context.privacyScore * 100)}%`, sensitive: context.privacyScore < 0.8 },
    { label: `${context.detectionSummary.uncertainCount} uncertain`, sensitive: context.detectionSummary.uncertainCount > 0 },
  ]
    .map((entry) => `<span class="pg-chip${entry.sensitive ? "" : " pg-chip-warn"}">${entry.label}</span>`)
    .join("");

  const card = document.createElement("div");
  card.className = "pg-card";
  card.innerHTML = `
    <div class="pg-title"><span>PRIVACY&nbsp;GUARD</span><span class="pg-badge">BROWSER AGENT</span></div>
    <div class="pg-section">
      <div class="pg-h">Agent wants to</div>
      ${actionRows || '<div class="pg-action"><div>No safe action found</div></div>'}
    </div>
    <div class="pg-section">
      <div class="pg-h">Privacy scan</div>
      <div class="pg-scan">${scans}</div>
    </div>
    <div class="pg-note">
      Your personal values never leave this device. The agent only sends redacted structure
      and typed tokens to the planner.
    </div>
    <div class="pg-btns">
      <button class="pg-btn pg-btn-allow">Allow once</button>
      <button class="pg-btn pg-btn-reject">Reject</button>
    </div>
  `;
  host.shadowRoot?.append(style, card);
  document.documentElement.append(host);

  return new Promise<ConsentDecision>((resolve) => {
    const cleanup = (): void => host.remove();
    const allow = card.querySelector<HTMLButtonElement>(".pg-btn-allow");
    const reject = card.querySelector<HTMLButtonElement>(".pg-btn-reject");
    allow?.addEventListener("click", () => {
      cleanup();
      resolve({
        approved: true,
        reason: "User approved the privacy-visible action plan.",
        requiredActions: plan.actions.map((action) => action.id),
      });
    });
    reject?.addEventListener("click", () => {
      cleanup();
      resolve({
        approved: false,
        reason: "User rejected the action plan.",
        requiredActions: [],
      });
    });
  });
}

export const consentOverlayUi: ConsentUi = { prompt };

export function removeConsentOverlay(): void {
  document.getElementById(OVERLAY_ROOT_ID)?.remove();
}