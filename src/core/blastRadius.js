// src/core/blastRadius.js
// ═══════════════════════════════════════════════════════════════════════
// BLAST RADIUS — Estimate downstream impact and assign risk tier
//
// Deterministic. No LLM. No external deps.
//
// Input:  surface classifications + consumer maps + symbol changes
// Output: risk tier (LOW | MEDIUM | HIGH) with evidence
//
// Risk philosophy:
//   Conservative. When in doubt, raise the tier.
//   Evidence-backed. Every tier assignment has concrete structural reasons.
//   No drama. HIGH means "structurally risky", not "the sky is falling."
// ═══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} BlastRadiusResult
 * @property {string} riskTier       - "LOW" | "MEDIUM" | "HIGH"
 * @property {string} summary        - One-line summary of the change's impact
 * @property {string[]} changedSurfaces - What changed structurally
 * @property {string[]} affectedConsumers - Who is downstream
 * @property {string} why            - Precise explanation
 * @property {string[]} evidence     - Concrete structural reasons
 * @property {string} mergeCaution   - One sentence caution
 * @property {boolean} safeToMerge   - Conservative boolean
 */

// ── RISK TIER WEIGHTS ─────────────────────────────────────────────────
// Surface categories contribute base risk weight.
// Consumer count is a multiplier.
// Symbol changes on exports are amplifiers.

const SURFACE_RISK_WEIGHTS = {
  AUTH:    5,
  SCHEMA: 5,
  API:    4,
  CONFIG: 3,
  UTILITY: 2,
  BUILD:  1,
  DOCS:   0,
  TEST:   0,
  STYLE:  0,
};
// ── COMMENT / WHITESPACE DETECTION ────────────────────────────────────
// A line is "non-functional" if it's a comment, whitespace, or empty.
// If ALL changed lines in a file are non-functional, the file's
// risk contribution should be zeroed.

const COMMENT_PATTERNS = [
  /^\s*\/\//,           // JS single-line comment
  /^\s*\/\*/,           // JS block comment start
  /^\s*\*/,             // JS block comment continuation
  /^\s*\*\//,           // JS block comment end
  /^\s*#/,              // Shell/Python comment
  /^\s*<!--/,           // HTML comment
  /^\s*{\/\*/,          // JSX comment
];

/**
 * Check if a line is purely a comment or whitespace.
 * @param {string} line
 * @returns {boolean}
 */
function isNonFunctionalLine(line) {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  return COMMENT_PATTERNS.some(p => p.test(trimmed));
}

/**
 * Check if ALL changes in a FileChange are comments or whitespace.
 * @param {import('./diffParser.js').FileChange} fileChange
 * @returns {boolean}
 */
function isCommentOnlyChange(fileChange) {
  if (fileChange.hunks.length === 0) return false; // No hunks = structural (rename etc.)

  const allChangedLines = fileChange.hunks.flatMap(h => [
    ...h.addedLines,
    ...h.removedLines,
  ]);

  // If there are no changed lines at all, treat as non-comment (structural)
  if (allChangedLines.length === 0) return false;

  return allChangedLines.every(isNonFunctionalLine);
}

/**
 * Calculate the blast radius for a set of changes.
 *
 * @param {import('./surfaceClassifier.js').SurfaceClassification[]} classifications
 * @param {Map<string, import('./graphWalker.js').ConsumerInfo[]>} consumerMap
 * @param {import('./diffParser.js').FileChange[]} fileChanges
 * @returns {BlastRadiusResult}
 */
export function calculateBlastRadius(classifications, consumerMap, fileChanges) {
  const evidence = [];
  let maxWeight = 0;
  let totalConsumers = 0;
  let hasExportChanges = false;
  let hasSignatureChanges = false;

  // ── Gather structural facts ─────────────────────────────────────
  const changedSurfaces = [];
  const affectedConsumers = new Set();

  for (const cls of classifications) {
    let weight = SURFACE_RISK_WEIGHTS[cls.category] ?? 1;

    // Build surface description
    const fileChange = fileChanges.find(f => f.filePath === cls.filePath);
    if (!fileChange) continue;

    // ── Comment-only detection ─────────────────────────────────────
    // If ALL changed lines are comments/whitespace, zero the weight
    // and skip consumer/export analysis for this file.
    const commentOnly = isCommentOnlyChange(fileChange);
    if (commentOnly) {
      weight = 0;
      evidence.push(`comment-only change in ${cls.filePath} — no functional impact`);
    }

    if (weight > maxWeight) maxWeight = weight;

    const symbolNames = fileChange.symbols.map(s => s.name).join(", ");
    const desc = symbolNames
      ? `${cls.category}: ${cls.filePath} (${fileChange.symbols.length} symbol(s): ${symbolNames})`
      : `${cls.category}: ${cls.filePath} (+${fileChange.additions}/-${fileChange.deletions})`;
    changedSurfaces.push(desc);

    // Check for export-level changes (amplifier) — skip for comment-only files
    if (!commentOnly) {
      const exportSymbols = fileChange.symbols.filter(
        s => s.kind === "export" || s.kind === "function" || s.kind === "class"
      );
      if (exportSymbols.length > 0) {
        hasExportChanges = true;
        for (const sym of exportSymbols) {
          if (sym.change === "modified" || sym.change === "removed") {
            hasSignatureChanges = true;
            evidence.push(`${sym.change} ${sym.kind} "${sym.name}" in ${cls.filePath}`);
          } else if (sym.change === "added") {
            evidence.push(`new ${sym.kind} "${sym.name}" in ${cls.filePath}`);
          }
        }
      }

      // Collect consumers for this file (normalize path separators for cross-platform compat)
      const fwdPath = cls.filePath.replace(/\\/g, "/");
      const bkPath = cls.filePath.replace(/\//g, "\\");
      const consumers = consumerMap.get(cls.filePath) || consumerMap.get(fwdPath) || consumerMap.get(bkPath) || [];
      for (const consumer of consumers) {
        affectedConsumers.add(consumer.filePath);
        totalConsumers++;
      }
    }

    // Surface-specific evidence
    if (cls.category === "AUTH") {
      evidence.push(`auth surface touched: ${cls.filePath}`);
    } else if (cls.category === "CONFIG") {
      evidence.push(`config surface changed: ${cls.filePath}`);
    } else if (cls.category === "SCHEMA") {
      evidence.push(`schema/type definition modified: ${cls.filePath}`);
    }
  }

  // Consumer evidence
  if (affectedConsumers.size > 0) {
    evidence.push(`${affectedConsumers.size} downstream file(s) import from changed surfaces`);
  }

  if (hasSignatureChanges && affectedConsumers.size > 0) {
    evidence.push(`export signature change detected with active consumers — verify compatibility`);
  }

  // ── Compute risk tier ───────────────────────────────────────────

  let riskTier = "LOW";
  let why = "";

  // HIGH: auth/schema/config changes with consumers, or signature changes with many consumers
  if (
    (maxWeight >= 5 && affectedConsumers.size > 0) ||
    (maxWeight >= 4 && affectedConsumers.size > 3) ||
    (hasSignatureChanges && affectedConsumers.size > 3)
  ) {
    riskTier = "HIGH";
    if (maxWeight >= 5 && affectedConsumers.size > 0) {
      why = `Critical surface (auth/schema) changed with ${affectedConsumers.size} downstream consumer(s)`;
    } else if (hasSignatureChanges) {
      why = `Export signature changed with ${affectedConsumers.size} downstream consumer(s)`;
    } else {
      why = `API surface changed with ${affectedConsumers.size} downstream consumer(s)`;
    }
  }
  // MEDIUM: API/config changes with any consumers, or utility with many consumers
  else if (
    (maxWeight >= 3 && affectedConsumers.size > 0) ||
    (maxWeight >= 2 && affectedConsumers.size > 1) ||
    (hasSignatureChanges && affectedConsumers.size > 0)
  ) {
    riskTier = "MEDIUM";
    if (hasSignatureChanges) {
      why = `Export signature change detected with ${affectedConsumers.size} downstream consumer(s) — verify compatibility`;
    } else {
      why = `Shared surface changed with ${affectedConsumers.size} downstream consumer(s)`;
    }
  }
  // LOW: leaf changes, test-only, style-only, low consumer count
  else {
    riskTier = "LOW";
    if (affectedConsumers.size === 0) {
      why = "No downstream consumers detected — leaf change";
    } else {
      why = `Low-risk surface with minimal downstream impact (${affectedConsumers.size} consumer)`;
    }
  }

  // ── Build summary ───────────────────────────────────────────────

  const categories = [...new Set(classifications.map(c => c.category))];
  const totalChanges = fileChanges.reduce((s, f) => s + f.additions + f.deletions, 0);
  const summary = `${fileChanges.length} file(s) changed across ${categories.join(", ")} surfaces — ${totalChanges} line(s) modified, ${affectedConsumers.size} downstream consumer(s)`;

  // ── Merge caution ───────────────────────────────────────────────

  let mergeCaution = "";
  if (riskTier === "HIGH") {
    mergeCaution = "Review downstream consumers before merging — potential breaking change detected.";
  } else if (riskTier === "MEDIUM") {
    mergeCaution = "Downstream consumers identified — verify they handle the updated interface.";
  } else {
    mergeCaution = "Low structural risk — standard review applies.";
  }

  // ── Safe to merge? ──────────────────────────────────────────────
  // Conservative: only LOW risk AND zero downstream consumers AND no export changes
  const safeToMerge = riskTier === "LOW" && affectedConsumers.size === 0 && !hasExportChanges;

  return {
    riskTier,
    summary,
    changedSurfaces,
    affectedConsumers: [...affectedConsumers],
    why,
    evidence,
    mergeCaution,
    safeToMerge,
  };
}
