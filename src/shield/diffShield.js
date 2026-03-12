// src/shield/diffShield.js
// ═══════════════════════════════════════════════════════════════════════
// DIFFSHIELD — Policy enforcement layer for ChangeLens
//
// Reads .changelens.yml config and applies merge policy rules.
//
// Modes:
//   warn  — Post Impact Card + warning label, never block
//   block — Fail the check if policy is violated
//
// Policy rules:
//   - require_approvals: Minimum approvals for HIGH risk PRs
//   - block_on_high: Boolean, fail check on HIGH risk
//   - require_approvals_medium: Minimum approvals for MEDIUM risk PRs
//   - allowed_surfaces: Surfaces that bypass policy (e.g. DOCS, TEST)
//
// Zero dependencies. Same deterministic spine.
// ═══════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";

/**
 * @typedef {Object} ShieldConfig
 * @property {string}   mode                    - "warn" | "block"
 * @property {boolean}  block_on_high           - Block merges on HIGH risk
 * @property {number}   require_approvals       - Required approvals for HIGH risk
 * @property {number}   require_approvals_medium - Required approvals for MEDIUM risk
 * @property {string[]} bypass_surfaces         - Surfaces that skip enforcement (e.g. ["DOCS", "TEST"])
 * @property {string}   slack_webhook           - Slack webhook URL for notifications
 * @property {boolean}  label_prs               - Add risk-tier labels to PRs
 */

const DEFAULT_CONFIG = {
  mode: "warn",
  block_on_high: false,
  require_approvals: 2,
  require_approvals_medium: 1,
  bypass_surfaces: ["DOCS", "TEST", "STYLE"],
  slack_webhook: "",
  label_prs: true,
};

/**
 * Load DiffShield config from .changelens.yml in the project root.
 * Falls back to defaults if no config file is found.
 *
 * @param {string} projectRoot - Path to project root
 * @returns {ShieldConfig}
 */
export function loadShieldConfig(projectRoot) {
  const configPaths = [
    join(projectRoot, ".changelens.yml"),
    join(projectRoot, ".changelens.yaml"),
    join(projectRoot, ".changelens.json"),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");

        // Simple YAML parser for our flat config (no dependency needed)
        if (configPath.endsWith(".json")) {
          const parsed = JSON.parse(raw);
          return { ...DEFAULT_CONFIG, ...parsed };
        }

        // Parse YAML-like flat key: value pairs
        const config = { ...DEFAULT_CONFIG };
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;

          const colonIdx = trimmed.indexOf(":");
          if (colonIdx === -1) continue;

          const key = trimmed.slice(0, colonIdx).trim();
          let value = trimmed.slice(colonIdx + 1).trim();

          // Parse value types
          if (value === "true") value = true;
          else if (value === "false") value = false;
          else if (/^\d+$/.test(value)) value = parseInt(value, 10);
          else if (value.startsWith("[") && value.endsWith("]")) {
            // Simple array: [DOCS, TEST, STYLE]
            value = value.slice(1, -1).split(",").map(s => s.trim().replace(/['"]/g, ""));
          }
          else {
            // Strip quotes
            value = value.replace(/^["']|["']$/g, "");
          }

          if (key in DEFAULT_CONFIG) {
            config[key] = value;
          }
        }
        return config;
      } catch (err) {
        // Config parse error — fall back to defaults
        console.error(`⚠ Could not parse ${configPath}: ${err.message}`);
      }
    }
  }

  return { ...DEFAULT_CONFIG };
}

/**
 * @typedef {Object} ShieldVerdict
 * @property {"pass"|"warn"|"block"} action   - What DiffShield recommends
 * @property {string}                reason   - Human-readable explanation
 * @property {string}                riskTier - The detected risk tier
 * @property {boolean}               enforced - Whether this is enforced (block mode) or advisory (warn mode)
 * @property {Object}                policy   - The policy that was evaluated
 */

/**
 * Evaluate a ChangeLens Impact Card against the DiffShield policy.
 *
 * @param {Object}       card     - ChangeLens Impact Card
 * @param {ShieldConfig} config   - DiffShield configuration
 * @param {Object}       [context] - Optional context (approval count, etc.)
 * @param {number}       [context.approvalCount] - Number of current PR approvals
 * @returns {ShieldVerdict}
 */
export function evaluatePolicy(card, config, context = {}) {
  const { approvalCount = 0 } = context;
  const enforced = config.mode === "block";

  // Check if all changed surfaces are in bypass list
  if (card.changedSurfaces && config.bypass_surfaces.length > 0) {
    const allBypassed = card.changedSurfaces.every(surface => {
      // Extract category from surface string (e.g. "DOCS: README.md" → "DOCS")
      const category = surface.split(":")[0].trim();
      return config.bypass_surfaces.includes(category);
    });

    if (allBypassed) {
      return {
        action: "pass",
        reason: `All changed surfaces (${config.bypass_surfaces.join(", ")}) are in the bypass list — no enforcement needed.`,
        riskTier: card.riskTier,
        enforced,
        policy: { rule: "bypass_surfaces", config: config.bypass_surfaces },
      };
    }
  }

  // LOW risk — always pass
  if (card.riskTier === "LOW") {
    return {
      action: "pass",
      reason: "LOW risk — no policy enforcement triggered.",
      riskTier: "LOW",
      enforced,
      policy: { rule: "low_risk_pass" },
    };
  }

  // MEDIUM risk — check approval requirements
  if (card.riskTier === "MEDIUM") {
    const required = config.require_approvals_medium;
    if (approvalCount < required) {
      return {
        action: enforced ? "block" : "warn",
        reason: `MEDIUM risk — requires ${required} approval(s), has ${approvalCount}. ${enforced ? "Merge blocked." : "Advisory only."}`,
        riskTier: "MEDIUM",
        enforced,
        policy: { rule: "require_approvals_medium", required, actual: approvalCount },
      };
    }
    return {
      action: "pass",
      reason: `MEDIUM risk — ${approvalCount} approval(s) meets the ${required} required.`,
      riskTier: "MEDIUM",
      enforced,
      policy: { rule: "require_approvals_medium", required, actual: approvalCount },
    };
  }

  // HIGH risk — strictest enforcement
  if (card.riskTier === "HIGH") {
    // Check block_on_high first
    if (config.block_on_high) {
      const required = config.require_approvals;
      if (approvalCount < required) {
        return {
          action: enforced ? "block" : "warn",
          reason: `🛡️ HIGH risk — requires ${required} senior approval(s), has ${approvalCount}. ${enforced ? "Merge blocked by DiffShield." : "DiffShield advisory: merge not recommended."}`,
          riskTier: "HIGH",
          enforced,
          policy: { rule: "block_on_high", required, actual: approvalCount },
        };
      }
      return {
        action: "pass",
        reason: `HIGH risk — ${approvalCount} approval(s) meets the ${required} required. DiffShield: merge permitted.`,
        riskTier: "HIGH",
        enforced,
        policy: { rule: "block_on_high", required, actual: approvalCount },
      };
    }

    // block_on_high is off — just check approvals
    const required = config.require_approvals;
    if (approvalCount < required) {
      return {
        action: enforced ? "block" : "warn",
        reason: `HIGH risk — ${required} approval(s) recommended, has ${approvalCount}. ${enforced ? "Merge blocked." : "Advisory only."}`,
        riskTier: "HIGH",
        enforced,
        policy: { rule: "require_approvals", required, actual: approvalCount },
      };
    }

    return {
      action: "pass",
      reason: `HIGH risk — ${approvalCount} approval(s) meets the ${required} required.`,
      riskTier: "HIGH",
      enforced,
      policy: { rule: "require_approvals", required, actual: approvalCount },
    };
  }

  // Fallback
  return {
    action: "pass",
    reason: "Unknown risk tier — defaulting to pass.",
    riskTier: card.riskTier,
    enforced,
    policy: { rule: "fallback" },
  };
}

/**
 * Format a DiffShield verdict as a markdown block for PR comments.
 *
 * @param {ShieldVerdict} verdict
 * @returns {string}
 */
export function formatShieldVerdict(verdict) {
  const icon = verdict.action === "block" ? "🛡️ ⛔" :
               verdict.action === "warn"  ? "🛡️ ⚠️" :
               "🛡️ ✅";

  const header = verdict.action === "block" ? "**DiffShield: Merge Blocked**" :
                 verdict.action === "warn"  ? "**DiffShield: Review Required**" :
                 "**DiffShield: Approved**";

  const lines = [
    `\n---\n`,
    `${icon} ${header}`,
    ``,
    `> ${verdict.reason}`,
  ];

  if (verdict.action === "block") {
    lines.push(``, `This PR requires additional approvals before merging. DiffShield is enforcing your team's merge policy.`);
  } else if (verdict.action === "warn") {
    lines.push(``, `_DiffShield is in warn mode. Configure \`.changelens.yml\` to enforce merge policies._`);
  }

  lines.push(``, `<sub>DiffShield by ChangeLens · Policy: ${verdict.policy.rule}</sub>`);

  return lines.join("\n");
}

/**
 * Send a Slack notification for a DiffShield verdict.
 *
 * @param {string}        webhookUrl - Slack webhook URL
 * @param {ShieldVerdict} verdict    - The verdict to notify about
 * @param {Object}        context    - PR context (repo, number, etc.)
 * @returns {Promise<boolean>}
 */
export async function notifySlack(webhookUrl, verdict, context = {}) {
  if (!webhookUrl) return false;

  const emoji = verdict.action === "block" ? "⛔" : verdict.action === "warn" ? "⚠️" : "✅";
  const payload = {
    text: `${emoji} *DiffShield ${verdict.action.toUpperCase()}* — ${context.repo || "unknown"}${context.prNumber ? ` PR #${context.prNumber}` : ""}\n${verdict.reason}`,
  };

  try {
    const url = new URL(webhookUrl);
    const https = await import("https");

    return new Promise((resolve) => {
      const req = https.default.request({
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on("error", () => resolve(false));
      req.write(JSON.stringify(payload));
      req.end();
    });
  } catch {
    return false;
  }
}
