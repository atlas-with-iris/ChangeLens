// tests/snapshot.test.js
// ═══════════════════════════════════════════════════════════════════════
// SNAPSHOT TESTS — Lock down Impact Card and PR comment output format
//
// These tests ensure the output contract stays stable.
// If the output format changes, these tests will fail, forcing
// intentional review of any output changes.
// ═══════════════════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildImpactCard, validateImpactCard } from "../src/output/impactCardBuilder.js";
import { formatPrComment, formatStatusLine } from "../src/output/prCommentFormatter.js";

// ── FROZEN INPUT ──────────────────────────────────────────────────────
// This blast result is frozen. Do not change it.
// It tests that the output contract remains stable.

const FROZEN_BLAST = {
  riskTier: "MEDIUM",
  summary: "2 file(s) changed across API, UTILITY surfaces — 12 line(s) modified, 3 downstream consumer(s)",
  changedSurfaces: [
    'API: src/routes/users.ts (1 symbol(s): getUsers)',
    'UTILITY: src/utils/format.ts (+3/-1)',
  ],
  affectedConsumers: ["src/app.ts", "src/routes/admin.ts", "src/api/v2.ts"],
  why: "Shared surface changed with 3 downstream consumer(s)",
  evidence: [
    'modified function "getUsers" in src/routes/users.ts',
    '3 downstream file(s) import from changed surfaces',
  ],
  mergeCaution: "Downstream consumers identified — verify they handle the updated interface.",
  safeToMerge: false,
};

describe("Snapshot: Impact Card JSON", () => {
  it("produces stable JSON structure", () => {
    const card = buildImpactCard("PR-SNAPSHOT", FROZEN_BLAST);

    // Schema correctness
    assert.equal(validateImpactCard(card), null);

    // Exact field checks
    assert.equal(card.prId, "PR-SNAPSHOT");
    assert.equal(card.riskTier, "MEDIUM");
    assert.equal(card.safeToMerge, false);
    assert.equal(card.changedSurfaces.length, 2);
    assert.equal(card.affectedConsumers.length, 3);
    assert.equal(card.evidence.length, 2);
    assert.equal(typeof card.summary, "string");
    assert.equal(typeof card.why, "string");
    assert.equal(typeof card.mergeCaution, "string");
  });

  it("preserves all 9 required fields", () => {
    const card = buildImpactCard("PR-99", FROZEN_BLAST);
    const requiredFields = [
      "prId", "summary", "changedSurfaces", "affectedConsumers",
      "riskTier", "why", "evidence", "mergeCaution", "safeToMerge"
    ];
    for (const field of requiredFields) {
      assert.ok(field in card, `Missing required field: ${field}`);
    }

    // No extra fields
    const actualFields = Object.keys(card);
    assert.equal(actualFields.length, requiredFields.length, "Card should have exactly 9 fields");
    for (const field of actualFields) {
      assert.ok(requiredFields.includes(field), `Unexpected field: ${field}`);
    }
  });
});

describe("Snapshot: PR comment format", () => {
  it("contains all required sections", () => {
    const card = buildImpactCard("PR-SNAPSHOT", FROZEN_BLAST);
    const md = formatPrComment(card);

    // Header
    assert.ok(md.includes("ChangeLens"), "Must include product name");
    assert.ok(md.includes("Impact Estimate"), "Must say Impact Estimate, not Impact Card");

    // Risk badge
    assert.ok(md.includes("🟡 MEDIUM"), "Must include MEDIUM badge");

    // Required sections
    assert.ok(md.includes("### Summary"), "Must have Summary section");
    assert.ok(md.includes("### Why this risk tier?"), "Must have Why section");
    assert.ok(md.includes("### Affected Surfaces Detected"), "Must say Detected, not just Changed");
    assert.ok(md.includes("### Downstream Consumers Identified"), "Must say Identified");
    assert.ok(md.includes("### Evidence"), "Must have Evidence section");

    // Footer
    assert.ok(md.includes("Not a guarantee"), "Must include disclaimer");
    assert.ok(md.includes("Static analysis impact estimate"), "Must say estimate");

    // Must NOT contain old language
    assert.ok(!md.includes("Impact Card"), "Must not say Impact Card");
    assert.ok(!md.includes("No AI inference"), "Old footer language must be gone");
    assert.ok(!md.includes("Structural impact analysis"), "Old footer must be gone");
  });

  it("MEDIUM risk shows warning icon, not checkmark", () => {
    const card = buildImpactCard("PR-SNAPSHOT", FROZEN_BLAST);
    const md = formatPrComment(card);
    assert.ok(md.includes("⚠️"), "MEDIUM risk should show warning");
    assert.ok(!md.includes("✅"), "MEDIUM risk should not show checkmark");
  });

  it("LOW risk shows checkmark", () => {
    const lowBlast = {
      ...FROZEN_BLAST,
      riskTier: "LOW",
      safeToMerge: true,
      mergeCaution: "Low structural risk — standard review applies.",
    };
    const card = buildImpactCard("PR-LOW", lowBlast);
    const md = formatPrComment(card);
    assert.ok(md.includes("✅"), "LOW + safe should show checkmark");
    assert.ok(md.includes("🟢 LOW"), "Should have LOW badge");
  });

  it("HIGH risk shows red badge", () => {
    const highBlast = {
      ...FROZEN_BLAST,
      riskTier: "HIGH",
      safeToMerge: false,
      mergeCaution: "Review downstream consumers before merging — potential breaking change detected.",
    };
    const card = buildImpactCard("PR-HIGH", highBlast);
    const md = formatPrComment(card);
    assert.ok(md.includes("🔴 HIGH"), "Should have HIGH badge");
    assert.ok(md.includes("⚠️"), "HIGH risk should show warning");
  });
});

describe("Snapshot: status line format", () => {
  it("produces compact one-liner", () => {
    const card = buildImpactCard("PR-SNAPSHOT", FROZEN_BLAST);
    const line = formatStatusLine(card);
    assert.ok(line.includes("🟡 MEDIUM"));
    assert.ok(line.includes("|"));
    // Must be a single line
    assert.ok(!line.includes("\n"), "Status line must be single line");
  });
});
