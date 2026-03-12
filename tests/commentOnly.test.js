// tests/commentOnly.test.js
// ═══════════════════════════════════════════════════════════════════════
// REGRESSION TEST — Comment-only false positive must stay dead.
//
// Fixed: March 10, 2026
// Bug: Comment-only changes to utility files with downstream consumers
//      were rated MEDIUM because the engine couldn't distinguish
//      comment diffs from code diffs.
// Fix: isCommentOnlyChange() in blastRadius.js zeros weight and skips
//      consumer/export analysis for files where ALL changed lines
//      are comments or whitespace.
// ═══════════════════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDiff } from "../src/core/diffParser.js";
import { classifyAllSurfaces } from "../src/core/surfaceClassifier.js";
import { calculateBlastRadius } from "../src/core/blastRadius.js";

function quickBlast(diff, consumerMap = new Map()) {
  const files = parseDiff(diff);
  const classifications = classifyAllSurfaces(files);
  return calculateBlastRadius(classifications, consumerMap, files);
}

// ── THE ORIGINAL FP SCENARIO ──────────────────────────────────────────
// This is the exact scenario from live demo #5 that triggered the FP.

describe("Regression: comment-only FP", () => {
  const COMMENT_ONLY_DIFF = `diff --git a/src/utils/salienceEngine.js b/src/utils/salienceEngine.js
index abc1234..def5678 100644
--- a/src/utils/salienceEngine.js
+++ b/src/utils/salienceEngine.js
@@ -1,4 +1,4 @@
-// Salience Engine - v1
+// Salience Engine - v1.1 (cleaned up)
 
diff --git a/src/utils/slipLedger.js b/src/utils/slipLedger.js
index abc1234..def5678 100644
--- a/src/utils/slipLedger.js
+++ b/src/utils/slipLedger.js
@@ -1,4 +1,4 @@
-// Slip Ledger
+// Slip Ledger - tracks regression events
 
diff --git a/src/utils/truthMinistry.js b/src/utils/truthMinistry.js
index abc1234..def5678 100644
--- a/src/utils/truthMinistry.js
+++ b/src/utils/truthMinistry.js
@@ -1,4 +1,4 @@
-// Truth Ministry
+// Truth Ministry - deterministic truth verification`;

  it("must rate LOW even with 16 consumers (comment-only = no functional impact)", () => {
    // Simulate the 16 consumers that exist in the real codebase
    const consumers = new Map([
      ["src/utils/salienceEngine.js", Array(6).fill({ filePath: "consumer.js", importedSymbols: ["*"], depth: 1 })],
      ["src/utils/slipLedger.js", Array(5).fill({ filePath: "consumer2.js", importedSymbols: ["*"], depth: 1 })],
      ["src/utils/truthMinistry.js", Array(5).fill({ filePath: "consumer3.js", importedSymbols: ["*"], depth: 1 })],
    ]);

    const blast = quickBlast(COMMENT_ONLY_DIFF, consumers);
    assert.equal(blast.riskTier, "LOW", "Comment-only changes must be LOW regardless of consumer count");
    assert.equal(blast.safeToMerge, true, "Comment-only changes must be safe to merge");
    assert.ok(blast.evidence.some(e => e.includes("comment-only")), "Must cite comment-only detection");
  });

  it("must not count consumers for comment-only files", () => {
    const consumers = new Map([
      ["src/utils/salienceEngine.js", [
        { filePath: "server.js", importedSymbols: ["*"], depth: 1 },
        { filePath: "routes/users.ts", importedSymbols: ["*"], depth: 1 },
      ]],
    ]);

    const blast = quickBlast(COMMENT_ONLY_DIFF, consumers);
    assert.equal(blast.affectedConsumers.length, 0, "Comment-only files should not contribute consumers");
  });
});

// ── SINGLE-LINE COMMENT VARIANTS ──────────────────────────────────────

describe("Comment-only: line-level detection", () => {
  it("detects // style comments", () => {
    const diff = `diff --git a/src/utils/helper.js b/src/utils/helper.js
index abc1234..def5678 100644
--- a/src/utils/helper.js
+++ b/src/utils/helper.js
@@ -5,3 +5,4 @@
-// old comment
+// new comment
+// another comment`;

    const blast = quickBlast(diff, new Map([
      ["src/utils/helper.js", [{ filePath: "a.js", importedSymbols: ["*"], depth: 1 }]],
    ]));
    assert.equal(blast.riskTier, "LOW");
  });

  it("detects /* */ block comments", () => {
    const diff = `diff --git a/src/utils/format.js b/src/utils/format.js
index abc1234..def5678 100644
--- a/src/utils/format.js
+++ b/src/utils/format.js
@@ -1,5 +1,5 @@
-/* Old description */
+/* Updated description for v2 */
 export function format() {}`;

    const blast = quickBlast(diff, new Map([
      ["src/utils/format.js", [{ filePath: "b.js", importedSymbols: ["format"], depth: 1 }]],
    ]));
    assert.equal(blast.riskTier, "LOW");
  });

  it("detects JSDoc comments", () => {
    const diff = `diff --git a/src/utils/validate.js b/src/utils/validate.js
index abc1234..def5678 100644
--- a/src/utils/validate.js
+++ b/src/utils/validate.js
@@ -3,5 +3,6 @@
- * Validates input
+ * Validates input data
+ * @param {string} input
  */`;

    const blast = quickBlast(diff, new Map([
      ["src/utils/validate.js", [{ filePath: "c.js", importedSymbols: ["validate"], depth: 1 }]],
    ]));
    assert.equal(blast.riskTier, "LOW");
  });

  it("does NOT treat code changes as comment-only", () => {
    const diff = `diff --git a/src/utils/helper.js b/src/utils/helper.js
index abc1234..def5678 100644
--- a/src/utils/helper.js
+++ b/src/utils/helper.js
@@ -5,4 +5,5 @@
 // This is a comment
-export function helper() { return 1; }
+export function helper(x) { return x + 1; }`;

    const blast = quickBlast(diff, new Map([
      ["src/utils/helper.js", [
        { filePath: "a.js", importedSymbols: ["helper"], depth: 1 },
        { filePath: "b.js", importedSymbols: ["helper"], depth: 1 },
      ]],
    ]));
    assert.notEqual(blast.riskTier, "LOW", "Code changes must not be treated as comment-only");
    assert.ok(blast.affectedConsumers.length > 0, "Must count consumers for code changes");
  });

  it("mixed comment + code = NOT comment-only", () => {
    const diff = `diff --git a/src/utils/mixed.js b/src/utils/mixed.js
index abc1234..def5678 100644
--- a/src/utils/mixed.js
+++ b/src/utils/mixed.js
@@ -1,5 +1,6 @@
-// Old header
+// New header
+const VERSION = "2.0";
 export function run() {}`;

    const blast = quickBlast(diff, new Map([
      ["src/utils/mixed.js", [{ filePath: "x.js", importedSymbols: ["run"], depth: 1 }]],
    ]));
    // Has a code line (const VERSION) so should NOT be comment-only
    assert.ok(blast.affectedConsumers.length > 0, "Mixed changes must count consumers");
  });
});
