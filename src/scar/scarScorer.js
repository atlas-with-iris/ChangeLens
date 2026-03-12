// src/scar/scarScorer.js
// ═══════════════════════════════════════════════════════════════════════
// SCAR SCORER — Calculate scar scores and risk tiers from ledger data
//
// Scar score = incidents / total_prs
//
// Risk tiers:
//   0.00 – 0.05  →  CLEAN     No policy override
//   0.05 – 0.15  →  CAUTION   DiffShield adds a warning note
//   0.15 – 0.30  →  HOT       DiffShield auto-escalates approvals
//   0.30+        →  DANGER    DiffShield blocks unless senior approves
//
// Deterministic. Just division.
// ═══════════════════════════════════════════════════════════════════════

/**
 * @typedef {"CLEAN"|"CAUTION"|"HOT"|"DANGER"} ScarTier
 */

/**
 * @typedef {Object} ScarReport
 * @property {string}    filePath
 * @property {number}    scarScore
 * @property {ScarTier}  tier
 * @property {number}    totalPrs
 * @property {number}    incidents
 * @property {number}    rollbacks
 * @property {number}    hotfixes
 * @property {number}    rapidFollowups
 * @property {string|null} lastIncident
 * @property {string}    summary
 */

// ── TIER THRESHOLDS ───────────────────────────────────────────────────

const TIER_THRESHOLDS = [
  { min: 0.30, tier: "DANGER",  label: "🔴 DANGER" },
  { min: 0.15, tier: "HOT",     label: "🟠 HOT" },
  { min: 0.05, tier: "CAUTION", label: "🟡 CAUTION" },
  { min: 0.00, tier: "CLEAN",   label: "🟢 CLEAN" },
];

/**
 * Get the scar tier for a given score.
 * @param {number} score
 * @returns {ScarTier}
 */
export function getScarTier(score) {
  for (const { min, tier } of TIER_THRESHOLDS) {
    if (score >= min) return tier;
  }
  return "CLEAN";
}

/**
 * Get the display label for a scar tier.
 * @param {ScarTier} tier
 * @returns {string}
 */
export function getScarLabel(tier) {
  const found = TIER_THRESHOLDS.find((t) => t.tier === tier);
  return found ? found.label : "🟢 CLEAN";
}

/**
 * Generate a scar report for a specific file.
 *
 * @param {string} filePath
 * @param {import('./scarLedger.js').FileScar} scar
 * @returns {ScarReport}
 */
export function generateFileReport(filePath, scar) {
  const tier = getScarTier(scar.scar_score);
  const pct = (scar.scar_score * 100).toFixed(1);

  let summary;
  if (tier === "DANGER") {
    summary = `${pct}% failure rate (${scar.incidents} incidents in ${scar.total_prs} PRs) — this file has a pattern of causing problems`;
  } else if (tier === "HOT") {
    summary = `${pct}% failure rate (${scar.incidents} incidents in ${scar.total_prs} PRs) — elevated risk, extra review recommended`;
  } else if (tier === "CAUTION") {
    summary = `${pct}% failure rate (${scar.incidents} incidents in ${scar.total_prs} PRs) — some history of issues`;
  } else {
    summary = scar.total_prs > 0
      ? `Clean record across ${scar.total_prs} PRs`
      : "No merge history recorded";
  }

  return {
    filePath,
    scarScore: scar.scar_score,
    tier,
    totalPrs: scar.total_prs,
    incidents: scar.incidents,
    rollbacks: scar.rollbacks,
    hotfixes: scar.hotfixes,
    rapidFollowups: scar.rapid_followups,
    lastIncident: scar.last_incident,
    summary,
  };
}

/**
 * Generate scar reports for a list of files (from a PR diff).
 *
 * @param {string[]} filePaths - Files touched by the PR
 * @param {import('./scarLedger.js').ScarLedger} ledger
 * @returns {ScarReport[]}
 */
export function generateReportsForFiles(filePaths, ledger) {
  const reports = [];

  for (const filePath of filePaths) {
    const fwd = filePath.replace(/\\/g, "/");
    const scar = ledger.scars[filePath] || ledger.scars[fwd];

    if (scar && scar.scar_score > 0) {
      reports.push(generateFileReport(filePath, scar));
    }
  }

  // Sort by scar score descending (worst files first)
  return reports.sort((a, b) => b.scarScore - a.scarScore);
}

/**
 * Format scar reports as a markdown block for PR comments.
 *
 * @param {ScarReport[]} reports
 * @returns {string}
 */
export function formatScarMarkdown(reports) {
  if (reports.length === 0) return "";

  const lines = [
    "",
    "---",
    "",
    "### 🩹 Scar Memory",
    "",
    "These files have incident history in your codebase:",
    "",
  ];

  for (const r of reports) {
    const label = getScarLabel(r.tier);
    lines.push(`- ${label} \`${r.filePath}\` — ${r.summary}`);

    const details = [];
    if (r.rollbacks > 0) details.push(`${r.rollbacks} rollback(s)`);
    if (r.hotfixes > 0) details.push(`${r.hotfixes} hotfix(es)`);
    if (r.rapidFollowups > 0) details.push(`${r.rapidFollowups} rapid follow-up(s)`);
    if (details.length > 0) {
      lines.push(`  - History: ${details.join(", ")}`);
    }
    if (r.lastIncident) {
      lines.push(`  - Last incident: ${r.lastIncident.split("T")[0]}`);
    }
  }

  const hasDanger = reports.some((r) => r.tier === "DANGER");
  const hasHot = reports.some((r) => r.tier === "HOT");

  if (hasDanger) {
    lines.push("", "> ⚠️ **DANGER files detected** — these files have a pattern of causing incidents. Extra review strongly recommended.");
  } else if (hasHot) {
    lines.push("", "> 🟠 **Hot files detected** — elevated incident history. Consider additional review.");
  }

  lines.push("", "<sub>Scar by ChangeLens · Deterministic structural memory · Based on your repo's actual merge history</sub>");

  return lines.join("\n");
}

/**
 * Format scar reports for terminal output.
 *
 * @param {ScarReport[]} reports
 * @returns {string}
 */
export function formatScarTerminal(reports) {
  if (reports.length === 0) {
    return "  🩹  No scar history for touched files.\n";
  }

  const lines = [
    "",
    "  🩹  Scar Memory",
    "  ────────────────────────────────────",
  ];

  for (const r of reports) {
    const label = getScarLabel(r.tier);
    const bar = "█".repeat(Math.min(Math.ceil(r.scarScore * 20), 10));
    const pct = (r.scarScore * 100).toFixed(1);

    lines.push(`  ${label} ${r.filePath}`);
    lines.push(`     ${bar} ${pct}% failure rate (${r.incidents}/${r.totalPrs} PRs)`);

    const details = [];
    if (r.rollbacks > 0) details.push(`${r.rollbacks} rollback(s)`);
    if (r.hotfixes > 0) details.push(`${r.hotfixes} hotfix(es)`);
    if (r.rapidFollowups > 0) details.push(`${r.rapidFollowups} rapid follow-up(s)`);
    if (details.length > 0) {
      lines.push(`     ${details.join(" · ")}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
