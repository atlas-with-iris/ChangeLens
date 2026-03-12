// src/scar/scarPolicy.js
// ═══════════════════════════════════════════════════════════════════════
// SCAR POLICY — Auto-tune DiffShield from scar scores
//
// Reads the scar ledger and generates policy overrides for files
// with incident history. These overrides are layered on top of
// the base DiffShield config.
//
// Scar tiers map to approval overrides:
//   CLEAN   → no override (use base config)
//   CAUTION → +0 approvals (add warning note only)
//   HOT     → +1 approval above base config
//   DANGER  → +2 approvals above base config, warn even in warn mode
// ═══════════════════════════════════════════════════════════════════════

import { loadLedger, getFileScar } from "./scarLedger.js";
import { getScarTier, generateReportsForFiles } from "./scarScorer.js";

/**
 * @typedef {Object} ScarPolicyOverride
 * @property {number}   require_approvals  - Overridden approval count
 * @property {string}   reason             - Why this override exists
 * @property {string}   tier               - Scar tier
 * @property {boolean}  force_warn         - Force a warning even if policy would pass
 */

/**
 * Calculate policy overrides for files touched in a PR.
 *
 * @param {string[]} touchedFiles     - Files in the PR
 * @param {import('../shield/diffShield.js').ShieldConfig} baseConfig - Base DiffShield config
 * @param {string} projectRoot        - Project root path
 * @returns {{ overrides: Object<string, ScarPolicyOverride>, maxApprovals: number, reports: import('./scarScorer.js').ScarReport[] }}
 */
export function getScarOverrides(touchedFiles, baseConfig, projectRoot) {
  const ledger = loadLedger(projectRoot);
  const reports = generateReportsForFiles(touchedFiles, ledger);
  const overrides = {};
  let maxApprovals = baseConfig.require_approvals;

  for (const report of reports) {
    const tier = report.tier;
    let extraApprovals = 0;
    let forceWarn = false;
    let reason = "";

    switch (tier) {
      case "DANGER":
        extraApprovals = 2;
        forceWarn = true;
        reason = `🔴 DANGER: ${report.filePath} has ${report.incidents} incidents in ${report.totalPrs} PRs (${(report.scarScore * 100).toFixed(1)}% failure rate). Scar auto-escalated approvals.`;
        break;
      case "HOT":
        extraApprovals = 1;
        forceWarn = true;
        reason = `🟠 HOT: ${report.filePath} has ${report.incidents} incidents in ${report.totalPrs} PRs. Extra review recommended.`;
        break;
      case "CAUTION":
        extraApprovals = 0;
        forceWarn = false;
        reason = `🟡 CAUTION: ${report.filePath} has some incident history (${report.incidents} in ${report.totalPrs} PRs).`;
        break;
      default:
        continue;
    }

    const requiredApprovals = baseConfig.require_approvals + extraApprovals;
    if (requiredApprovals > maxApprovals) {
      maxApprovals = requiredApprovals;
    }

    overrides[report.filePath] = {
      require_approvals: requiredApprovals,
      reason,
      tier,
      force_warn: forceWarn,
    };
  }

  return { overrides, maxApprovals, reports };
}

/**
 * Apply scar overrides to a DiffShield verdict.
 * If scar data suggests higher requirements, escalate the verdict.
 *
 * @param {import('../shield/diffShield.js').ShieldVerdict} verdict - Original DiffShield verdict
 * @param {Object} scarResult - Return value from getScarOverrides
 * @param {Object} context - PR context (approvalCount, etc.)
 * @returns {import('../shield/diffShield.js').ShieldVerdict}
 */
export function applyScarOverrides(verdict, scarResult, context = {}) {
  const { overrides, maxApprovals, reports } = scarResult;
  const { approvalCount = 0 } = context;

  // No overrides needed
  if (Object.keys(overrides).length === 0) {
    return verdict;
  }

  // Check if any scar override would escalate
  const anyForceWarn = Object.values(overrides).some(o => o.force_warn);

  // If the scar requires more approvals than currently met
  if (approvalCount < maxApprovals) {
    const reasons = Object.values(overrides).map(o => o.reason);
    const combinedReason = reasons.join("\n");

    // Escalate verdict
    if (verdict.enforced) {
      return {
        ...verdict,
        action: "block",
        reason: `🩹 Scar Memory escalated: requires ${maxApprovals} approval(s), has ${approvalCount}.\n${combinedReason}`,
        policy: {
          ...verdict.policy,
          rule: "scar_override",
          scar_required: maxApprovals,
          actual: approvalCount,
        },
      };
    } else {
      return {
        ...verdict,
        action: "warn",
        reason: `🩹 Scar Memory advisory: recommends ${maxApprovals} approval(s), has ${approvalCount}.\n${combinedReason}`,
        policy: {
          ...verdict.policy,
          rule: "scar_override",
          scar_required: maxApprovals,
          actual: approvalCount,
        },
      };
    }
  }

  // Approvals met but scar still wants to force a warning
  if (anyForceWarn && verdict.action === "pass") {
    const reasons = Object.values(overrides)
      .filter(o => o.force_warn)
      .map(o => o.reason);

    return {
      ...verdict,
      action: "warn",
      reason: `🩹 Scar Memory note: ${reasons.join("; ")}`,
      policy: {
        ...verdict.policy,
        rule: "scar_advisory",
      },
    };
  }

  return verdict;
}
