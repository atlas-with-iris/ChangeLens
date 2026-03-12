// tests/impactCard.test.js
// ═══════════════════════════════════════════════════════════════════════
// Integration test — full pipeline: diff → Impact Card
// ═══════════════════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildImpactCard, validateImpactCard } from "../src/output/impactCardBuilder.js";
import { formatPrComment, formatStatusLine } from "../src/output/prCommentFormatter.js";
import { calculateBlastRadius } from "../src/core/blastRadius.js";

describe("buildImpactCard", () => {
  it("builds a valid card from blast result", () => {
    const blastResult = {
      riskTier: "HIGH",
      summary: "2 file(s) changed across AUTH, API surfaces — 15 line(s) modified, 4 downstream consumer(s)",
      changedSurfaces: [
        'AUTH: src/auth/middleware.ts (1 symbol(s): validateToken)',
        'API: src/routes/users.ts (+5/-2)',
      ],
      affectedConsumers: ["src/app.ts", "src/routes/admin.ts", "src/routes/profile.ts", "src/api/v2.ts"],
      why: "Critical surface (auth/schema) changed with 4 downstream consumer(s)",
      evidence: [
        'modified function "validateToken" in src/auth/middleware.ts',
        'auth surface touched: src/auth/middleware.ts',
        '4 downstream file(s) import from changed surfaces',
        'export signature change detected with active consumers — verify compatibility',
      ],
      mergeCaution: "Review downstream consumers before merging — potential breaking change detected.",
      safeToMerge: false,
    };

    const card = buildImpactCard("PR-42", blastResult);
    assert.equal(card.prId, "PR-42");
    assert.equal(card.riskTier, "HIGH");
    assert.equal(card.safeToMerge, false);
    assert.equal(card.affectedConsumers.length, 4);
    assert.ok(card.evidence.length > 0);

    const error = validateImpactCard(card);
    assert.equal(error, null, `Validation should pass but got: ${error}`);
  });

  it("validates schema enforcement", () => {
    const bad = { prId: "", riskTier: "INVALID" };
    const error = validateImpactCard(bad);
    assert.ok(error !== null, "Should fail validation");
  });
});

describe("formatPrComment", () => {
  it("renders markdown with risk badge", () => {
    const card = {
      prId: "PR-42",
      summary: "1 file changed — 5 lines modified",
      changedSurfaces: ["AUTH: src/auth.ts"],
      affectedConsumers: ["src/app.ts"],
      riskTier: "HIGH",
      why: "Auth surface changed with 1 consumer",
      evidence: ["modified function validateToken"],
      mergeCaution: "Review downstream consumers before merging.",
      safeToMerge: false,
    };

    const md = formatPrComment(card);
    assert.ok(md.includes("🔴 HIGH"), "Should have HIGH badge");
    assert.ok(md.includes("ChangeLens"), "Should have header");
    assert.ok(md.includes("modified function validateToken"), "Should include evidence");
    assert.ok(md.includes("⚠️"), "Should have warning for unsafe merge");
    assert.ok(md.includes("Not a guarantee"), "Should have footer");
  });

  it("shows safe merge for LOW risk", () => {
    const card = {
      prId: "PR-1",
      summary: "1 file changed",
      changedSurfaces: ["TEST: tests/foo.test.js"],
      affectedConsumers: [],
      riskTier: "LOW",
      why: "Test-only change",
      evidence: [],
      mergeCaution: "Low structural risk — standard review applies.",
      safeToMerge: true,
    };

    const md = formatPrComment(card);
    assert.ok(md.includes("🟢 LOW"), "Should have LOW badge");
    assert.ok(md.includes("✅"), "Should show safe to merge");
  });
});

describe("formatStatusLine", () => {
  it("produces a compact status line", () => {
    const card = { riskTier: "MEDIUM", summary: "3 files changed" };
    const line = formatStatusLine(card);
    assert.ok(line.includes("🟡 MEDIUM"));
    assert.ok(line.includes("3 files changed"));
  });
});

describe("calculateBlastRadius", () => {
  it("assigns LOW risk to test-only changes", () => {
    const classifications = [
      { filePath: "tests/foo.test.js", category: "TEST", confidence: 0.95, reason: "test" },
    ];
    const consumerMap = new Map();
    const fileChanges = [{
      filePath: "tests/foo.test.js",
      additions: 5,
      deletions: 2,
      symbols: [],
      hunks: [],
    }];

    const result = calculateBlastRadius(classifications, consumerMap, fileChanges);
    assert.equal(result.riskTier, "LOW");
    assert.equal(result.safeToMerge, true);
  });

  it("assigns HIGH risk to auth changes with consumers", () => {
    const classifications = [
      { filePath: "src/auth/middleware.ts", category: "AUTH", confidence: 0.9, reason: "auth path" },
    ];
    const consumerMap = new Map([
      ["src/auth/middleware.ts", [
        { filePath: "src/app.ts", importedSymbols: ["validateToken"], depth: 1 },
      ]],
    ]);
    const fileChanges = [{
      filePath: "src/auth/middleware.ts",
      additions: 3,
      deletions: 2,
      symbols: [{ name: "validateToken", kind: "function", change: "modified", line: 5 }],
      hunks: [],
    }];

    const result = calculateBlastRadius(classifications, consumerMap, fileChanges);
    assert.equal(result.riskTier, "HIGH");
    assert.equal(result.safeToMerge, false);
    assert.ok(result.evidence.some(e => e.includes("validateToken")));
  });
});
