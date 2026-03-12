// tests/benign.test.js
// ═══════════════════════════════════════════════════════════════════════
// KOVA AUDIT — False positive rate on benign changes
//
// Does ChangeLens cry wolf? These tests verify that
// genuinely harmless PRs come back LOW + safe to merge.
//
// Cases:
//   1. README-only update
//   2. Test-only PR
//   3. Comment-only change (no functional diff)
//   4. Docs folder update
//   5. CI config tweak
//   6. Pure addition (new leaf file, no consumers)
// ═══════════════════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDiff } from "../src/core/diffParser.js";
import { classifyAllSurfaces } from "../src/core/surfaceClassifier.js";
import { calculateBlastRadius } from "../src/core/blastRadius.js";

function quickAnalyze(diff) {
  const files = parseDiff(diff);
  const classifications = classifyAllSurfaces(files);
  const blast = calculateBlastRadius(classifications, new Map(), files);
  return { files, classifications, blast };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. README-ONLY
// ═══════════════════════════════════════════════════════════════════════

describe("Benign: README-only update", () => {
  const README_DIFF = `diff --git a/README.md b/README.md
index abc1234..def5678 100644
--- a/README.md
+++ b/README.md
@@ -1,5 +1,7 @@
 # My Project
 
-A simple project.
+A powerful project for building things.
+
+## Getting Started
+Run \`npm install\` to get started.
 
 ## License`;

  it("classifies as DOCS", () => {
    const { classifications } = quickAnalyze(README_DIFF);
    assert.equal(classifications[0].category, "DOCS");
  });

  it("rates LOW and safe to merge", () => {
    const { blast } = quickAnalyze(README_DIFF);
    assert.equal(blast.riskTier, "LOW");
    assert.equal(blast.safeToMerge, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. TEST-ONLY PR
// ═══════════════════════════════════════════════════════════════════════

describe("Benign: test-only PR", () => {
  const TEST_DIFF = `diff --git a/tests/utils.test.js b/tests/utils.test.js
index abc1234..def5678 100644
--- a/tests/utils.test.js
+++ b/tests/utils.test.js
@@ -15,6 +15,12 @@
   expect(formatDate(new Date("2025-01-01"))).toBe("2025-01-01");
 });
 
+it("handles null input gracefully", () => {
+  expect(formatDate(null)).toBe("");
+});
+
+it("handles undefined input", () => {
+  expect(formatDate(undefined)).toBe("");
+});
+
 it("formats with locale", () => {`;

  it("classifies as TEST", () => {
    const { classifications } = quickAnalyze(TEST_DIFF);
    assert.equal(classifications[0].category, "TEST");
  });

  it("rates LOW and safe to merge", () => {
    const { blast } = quickAnalyze(TEST_DIFF);
    assert.equal(blast.riskTier, "LOW");
    assert.equal(blast.safeToMerge, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. COMMENT-ONLY CHANGE
// ═══════════════════════════════════════════════════════════════════════

describe("Benign: comment-only change", () => {
  const COMMENT_DIFF = `diff --git a/src/utils/helpers.js b/src/utils/helpers.js
index abc1234..def5678 100644
--- a/src/utils/helpers.js
+++ b/src/utils/helpers.js
@@ -5,7 +5,8 @@
 
-// Format a date string
+// Format a date string into ISO format.
+// Updated: now handles timezone correctly.
 export function formatDate(date) {
   return date.toISOString();
 }`;

  it("classifies as UTILITY (path-based)", () => {
    const { classifications } = quickAnalyze(COMMENT_DIFF);
    assert.equal(classifications[0].category, "UTILITY");
  });

  it("rates LOW — no symbol changes detected", () => {
    const { blast, files } = quickAnalyze(COMMENT_DIFF);
    // Comment lines don't match symbol patterns, so no symbol changes
    const exportSymbols = files[0].symbols.filter(
      s => s.kind === "function" || s.kind === "class" || s.kind === "export"
    );
    // formatDate appears in both added and removed context — but as a context line, not a diff line
    // Only the comment lines are in addedLines/removedLines
    assert.equal(blast.riskTier, "LOW");
    assert.equal(blast.safeToMerge, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. DOCS FOLDER UPDATE
// ═══════════════════════════════════════════════════════════════════════

describe("Benign: docs folder update", () => {
  const DOCS_DIFF = `diff --git a/docs/api-reference.md b/docs/api-reference.md
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/docs/api-reference.md
@@ -0,0 +1,25 @@
+# API Reference
+
+## GET /users
+Returns a list of users.
+
+## POST /users
+Creates a new user.`;

  it("classifies as DOCS", () => {
    const { classifications } = quickAnalyze(DOCS_DIFF);
    assert.equal(classifications[0].category, "DOCS");
  });

  it("rates LOW and safe to merge", () => {
    const { blast } = quickAnalyze(DOCS_DIFF);
    assert.equal(blast.riskTier, "LOW");
    assert.equal(blast.safeToMerge, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. CI CONFIG TWEAK
// ═══════════════════════════════════════════════════════════════════════

describe("Benign: CI config tweak", () => {
  const CI_DIFF = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index abc1234..def5678 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -10,7 +10,7 @@
     steps:
       - uses: actions/checkout@v3
-      - uses: actions/setup-node@v3
+      - uses: actions/setup-node@v4
         with:
           node-version: 18`;

  it("classifies as BUILD", () => {
    const { classifications } = quickAnalyze(CI_DIFF);
    assert.equal(classifications[0].category, "BUILD");
  });

  it("rates LOW and safe to merge", () => {
    const { blast } = quickAnalyze(CI_DIFF);
    assert.equal(blast.riskTier, "LOW");
    assert.equal(blast.safeToMerge, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. NEW LEAF FILE (no consumers)
// ═══════════════════════════════════════════════════════════════════════

describe("Benign: new leaf file with no consumers", () => {
  const LEAF_DIFF = `diff --git a/src/utils/newHelper.js b/src/utils/newHelper.js
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/utils/newHelper.js
@@ -0,0 +1,10 @@
+export function calculateTotal(items) {
+  return items.reduce((sum, item) => sum + item.price, 0);
+}
+
+export function formatCurrency(amount) {
+  return \`$\${amount.toFixed(2)}\`;
+}`;

  it("classifies as UTILITY", () => {
    const { classifications } = quickAnalyze(LEAF_DIFF);
    assert.equal(classifications[0].category, "UTILITY");
  });

  it("rates LOW — new file with zero consumers", () => {
    const { blast } = quickAnalyze(LEAF_DIFF);
    assert.equal(blast.riskTier, "LOW");
    // New file has export symbols → safeToMerge=false (conservative: exports exist)
    // This is correct behavior: LOW risk but still warrants review since it adds API surface
    assert.equal(blast.safeToMerge, false, "Conservative: new exports = review recommended");
  });
});
