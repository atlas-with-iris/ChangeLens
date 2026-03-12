// src/output/impactCardBuilder.js
// ═══════════════════════════════════════════════════════════════════════
// IMPACT CARD BUILDER — Assemble the locked output contract
//
// Takes the outputs of all core modules and produces the final
// Impact Card JSON, conforming to the v1 schema.
//
// Schema (locked):
// {
//   "prId": "string",
//   "summary": "string",
//   "changedSurfaces": ["string"],
//   "affectedConsumers": ["string"],
//   "riskTier": "LOW | MEDIUM | HIGH",
//   "why": "string",
//   "evidence": ["string"],
//   "mergeCaution": "string",
//   "safeToMerge": boolean
// }
// ═══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ImpactCard
 * @property {string} prId
 * @property {string} summary
 * @property {string[]} changedSurfaces
 * @property {string[]} affectedConsumers
 * @property {"LOW"|"MEDIUM"|"HIGH"} riskTier
 * @property {string} why
 * @property {string[]} evidence
 * @property {string} mergeCaution
 * @property {boolean} safeToMerge
 */

/**
 * Build the Impact Card from blast radius analysis.
 *
 * @param {string} prId - Pull request identifier
 * @param {import('../core/blastRadius.js').BlastRadiusResult} blastResult
 * @returns {ImpactCard}
 */
export function buildImpactCard(prId, blastResult) {
  return {
    prId,
    summary: blastResult.summary,
    changedSurfaces: blastResult.changedSurfaces,
    affectedConsumers: blastResult.affectedConsumers,
    riskTier: blastResult.riskTier,
    why: blastResult.why,
    evidence: blastResult.evidence,
    mergeCaution: blastResult.mergeCaution,
    safeToMerge: blastResult.safeToMerge,
  };
}

/**
 * Validate that an Impact Card conforms to the v1 schema.
 * Returns null if valid, or an error string if invalid.
 *
 * @param {ImpactCard} card
 * @returns {string|null}
 */
export function validateImpactCard(card) {
  if (typeof card.prId !== "string" || !card.prId) return "prId must be a non-empty string";
  if (typeof card.summary !== "string") return "summary must be a string";
  if (!Array.isArray(card.changedSurfaces)) return "changedSurfaces must be an array";
  if (!Array.isArray(card.affectedConsumers)) return "affectedConsumers must be an array";
  if (!["LOW", "MEDIUM", "HIGH"].includes(card.riskTier)) return "riskTier must be LOW, MEDIUM, or HIGH";
  if (typeof card.why !== "string") return "why must be a string";
  if (!Array.isArray(card.evidence)) return "evidence must be an array";
  if (typeof card.mergeCaution !== "string") return "mergeCaution must be a string";
  if (typeof card.safeToMerge !== "boolean") return "safeToMerge must be a boolean";
  return null;
}
