#!/usr/bin/env node
// scripts/20-pr-run.js
// ═══════════════════════════════════════════════════════════════════════
// 20 PR CORPUS — Comprehensive validation against ChangeLens's own codebase
//
// Validates accuracy across auth, config, test, docs, style, build,
// utility, comment-only, whitespace, rename, and multi-file scenarios.
//
// Run: node scripts/20-pr-run.js
// ═══════════════════════════════════════════════════════════════════════

import { analyze } from "../src/index.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// ═══════════════════════════════════════════════════════════════════════
// 20-PR CORPUS
// ═══════════════════════════════════════════════════════════════════════

const CORPUS = [
  // ── CATEGORY: CORE MODULE EXPORT CHANGES (should be HIGH/MEDIUM) ──
  { id: "PR-01", expected: "HIGH", name: "diffParser export change",
    diff: `diff --git a/src/core/diffParser.js b/src/core/diffParser.js
index a..b 100644
--- a/src/core/diffParser.js
+++ b/src/core/diffParser.js
@@ -10,5 +10,7 @@
-export function parseDiff(diffText) {
+export function parseDiff(diffText, options = {}) {
+  const { strict = false } = options;
   // existing logic
 }` },

  { id: "PR-02", expected: "HIGH", name: "blastRadius export change",
    diff: `diff --git a/src/core/blastRadius.js b/src/core/blastRadius.js
index a..b 100644
--- a/src/core/blastRadius.js
+++ b/src/core/blastRadius.js
@@ -5,6 +5,8 @@
-export function calculateBlastRadius(classifications, consumerMap, fileChanges) {
+export function calculateBlastRadius(classifications, consumerMap, fileChanges, opts = {}) {
+  const { verbose = false } = opts;
   const evidence = [];
   return evidence;
 }` },

  // ── CATEGORY: CONFIG (detect env changes) ──────────────────────
  { id: "PR-03", expected: "LOW", name: "Package.json version bump",
    diff: `diff --git a/package.json b/package.json
index a..b 100644
--- a/package.json
+++ b/package.json
@@ -2,4 +2,4 @@
-  "version": "0.1.0",
+  "version": "0.1.1",` },

  { id: "PR-04", expected: "LOW", name: "New config file",
    diff: `diff --git a/.changelensrc b/.changelensrc
new file mode 100644
index 0..a 100644
--- /dev/null
+++ b/.changelensrc
@@ -0,0 +1,3 @@
+{
+  "maxDepth": 3
+}` },

  // ── CATEGORY: TEST (always LOW) ────────────────────────────────
  { id: "PR-05", expected: "LOW", name: "New test file",
    diff: `diff --git a/tests/newFeature.test.js b/tests/newFeature.test.js
new file mode 100644
index 0..a 100644
--- /dev/null
+++ b/tests/newFeature.test.js
@@ -0,0 +1,10 @@
+import { parseDiff } from '../src/core/diffParser.js';
+import { describe, it } from 'node:test';
+import assert from 'node:assert/strict';
+
+describe('new feature', () => {
+  it('passes', () => {
+    const r = parseDiff('');
+    assert.ok(Array.isArray(r));
+  });
+});` },

  { id: "PR-06", expected: "LOW", name: "Delete old test",
    diff: `diff --git a/tests/old_deprecated.test.js b/tests/old_deprecated.test.js
deleted file mode 100644
index a..0 100644
--- a/tests/old_deprecated.test.js
+++ /dev/null
@@ -1,8 +0,0 @@
-import { describe, it } from 'node:test';
-import assert from 'node:assert/strict';
-describe('deprecated tests', () => {
-  it('old test 1', () => { assert.ok(true); });
-  it('old test 2', () => { assert.ok(true); });
-  it('old test 3', () => { assert.ok(true); });
-  it('old test 4', () => { assert.ok(true); });
-});` },

  // ── CATEGORY: DOCS (always LOW) ────────────────────────────────
  { id: "PR-07", expected: "LOW", name: "README update",
    diff: `diff --git a/README.md b/README.md
index a..b 100644
--- a/README.md
+++ b/README.md
@@ -1,4 +1,6 @@
 # ChangeLens
-Pre-merge change impact visualizer
+Pre-merge change impact visualizer.
+
+## Getting Started
+See below for installation.` },

  { id: "PR-08", expected: "LOW", name: "CHANGELOG addition",
    diff: `diff --git a/CHANGELOG.md b/CHANGELOG.md
new file mode 100644
index 0..a 100644
--- /dev/null
+++ b/CHANGELOG.md
@@ -0,0 +1,8 @@
+# Changelog
+
+## v0.1.0 - 2026-03-11
+- Initial release
+- 6-module pipeline
+- CLI with terminal colors
+- GitHub Action
+- 77 tests` },

  // ── CATEGORY: STYLE (always LOW) ───────────────────────────────
  { id: "PR-09", expected: "LOW", name: "CSS file change",
    diff: `diff --git a/docs/style.css b/docs/style.css
index a..b 100644
--- a/docs/style.css
+++ b/docs/style.css
@@ -5,4 +5,4 @@
-.header { background: #333; }
+.header { background: #1a1a2e; }` },

  // ── CATEGORY: BUILD (LOW) ──────────────────────────────────────
  { id: "PR-10", expected: "LOW", name: "Build script tweak",
    diff: `diff --git a/build.js b/build.js
index a..b 100644
--- a/build.js
+++ b/build.js
@@ -10,4 +10,4 @@
-    target: "node18",
+    target: "node20",` },

  // ── CATEGORY: CORE UTILITY WITH CONSUMERS ──────────────────────
  { id: "PR-11", expected: "MEDIUM", name: "surfaceClassifier export change",
    diff: `diff --git a/src/core/surfaceClassifier.js b/src/core/surfaceClassifier.js
index a..b 100644
--- a/src/core/surfaceClassifier.js
+++ b/src/core/surfaceClassifier.js
@@ -10,5 +10,7 @@
-export function classifySurface(fileChange) {
+export function classifySurface(fileChange, options = {}) {
+  const { confidence = true } = options;
   // classifier logic
 }` },

  // ── COMMENT-ONLY (must be LOW) ─────────────────────────────────
  { id: "PR-12", expected: "LOW", name: "Comment cleanup (3 core files)",
    diff: `diff --git a/src/core/diffParser.js b/src/core/diffParser.js
index a..b 100644
--- a/src/core/diffParser.js
+++ b/src/core/diffParser.js
@@ -1,4 +1,4 @@
-// src/core/diffParser.js
+// src/core/diffParser.js — unified diff parser

diff --git a/src/core/graphWalker.js b/src/core/graphWalker.js
index a..b 100644
--- a/src/core/graphWalker.js
+++ b/src/core/graphWalker.js
@@ -1,4 +1,4 @@
-// src/core/graphWalker.js
+// src/core/graphWalker.js — import graph BFS

diff --git a/src/core/surfaceClassifier.js b/src/core/surfaceClassifier.js
index a..b 100644
--- a/src/core/surfaceClassifier.js
+++ b/src/core/surfaceClassifier.js
@@ -1,4 +1,4 @@
-// src/core/surfaceClassifier.js
+// src/core/surfaceClassifier.js — surface categorizer` },

  { id: "PR-13", expected: "LOW", name: "JSDoc update on parser",
    diff: `diff --git a/src/core/diffParser.js b/src/core/diffParser.js
index a..b 100644
--- a/src/core/diffParser.js
+++ b/src/core/diffParser.js
@@ -5,5 +5,6 @@
- * Parses unified diff
+ * Parses unified diff text into structured FileChange objects
+ * @param {string} diffText - Raw unified diff output
  */` },

  // ── NEW FILE (leaf, no consumers) ──────────────────────────────
  { id: "PR-14", expected: "LOW", name: "New utility (no imports yet)",
    diff: `diff --git a/src/core/cacheLayer.js b/src/core/cacheLayer.js
new file mode 100644
index 0..a 100644
--- /dev/null
+++ b/src/core/cacheLayer.js
@@ -0,0 +1,6 @@
+export function createCache(maxSize = 100) {
+  const cache = new Map();
+  return { get: (k) => cache.get(k), set: (k, v) => cache.set(k, v) };
+}
+export function clearCache(cache) {
+  cache.clear();
+}` },

  // ── MULTI-FILE MIXED: code + test ─────────────────────────────
  { id: "PR-15", expected: "HIGH", name: "graphWalker refactor + test",
    diff: `diff --git a/src/core/graphWalker.js b/src/core/graphWalker.js
index a..b 100644
--- a/src/core/graphWalker.js
+++ b/src/core/graphWalker.js
@@ -8,5 +8,7 @@
-export function analyzeImpact(projectRoot, changedFilePaths, maxDepth = 2) {
+export function analyzeImpact(projectRoot, changedFilePaths, maxDepth = 2, opts = {}) {
+  const { cache = null } = opts;
   // analysis logic
 }
diff --git a/tests/graph_test.js b/tests/graph_test.js
new file mode 100644
index 0..a 100644
--- /dev/null
+++ b/tests/graph_test.js
@@ -0,0 +1,5 @@
+import { analyzeImpact } from '../src/core/graphWalker.js';
+import { it } from 'node:test';
+it('works', () => {
+  analyzeImpact('.', []);
+});` },

  // ── WHITESPACE ONLY ────────────────────────────────────────────
  { id: "PR-16", expected: "LOW", name: "Whitespace-only diff",
    diff: `diff --git a/src/core/diffParser.js b/src/core/diffParser.js
index a..b 100644
--- a/src/core/diffParser.js
+++ b/src/core/diffParser.js
@@ -5,4 +5,5 @@

-  
+

+
 ` },

  // ── PACKAGE.JSON CHANGE ────────────────────────────────────────
  { id: "PR-17", expected: "LOW", name: "Package.json description update",
    diff: `diff --git a/package.json b/package.json
index a..b 100644
--- a/package.json
+++ b/package.json
@@ -3,4 +3,4 @@
-  "description": "Pre-merge change impact visualizer.",
+  "description": "Pre-merge change impact visualizer. Know what your PR will break.",` },

  // ── OUTPUT MODULE CHANGE ───────────────────────────────────────
  { id: "PR-18", expected: "MEDIUM", name: "impactCardBuilder export change",
    diff: `diff --git a/src/output/impactCardBuilder.js b/src/output/impactCardBuilder.js
index a..b 100644
--- a/src/output/impactCardBuilder.js
+++ b/src/output/impactCardBuilder.js
@@ -10,5 +10,7 @@
-export function buildImpactCard(prId, blastResult) {
+export function buildImpactCard(prId, blastResult, meta = {}) {
+  const { timestamp = Date.now() } = meta;
   // card logic
 }` },

  // ── RENAME ─────────────────────────────────────────────────────
  { id: "PR-19", expected: "LOW", name: "File rename (pure)",
    diff: `diff --git a/src/core/oldHelper.js b/src/core/newHelper.js
similarity index 100%
rename from src/core/oldHelper.js
rename to src/core/newHelper.js` },

  // ── MULTI-FILE: all tests ─────────────────────────────────────
  { id: "PR-20", expected: "LOW", name: "3 test files updated",
    diff: `diff --git a/tests/test1.js b/tests/test1.js
index a..b 100644
--- a/tests/test1.js
+++ b/tests/test1.js
@@ -1,3 +1,4 @@
 import { it } from 'node:test';
+import assert from 'node:assert/strict';
 it('works', () => {});
diff --git a/tests/test2.js b/tests/test2.js
index a..b 100644
--- a/tests/test2.js
+++ b/tests/test2.js
@@ -1,3 +1,4 @@
 import { it } from 'node:test';
+import assert from 'node:assert/strict';
 it('works', () => {});
diff --git a/tests/test3.js b/tests/test3.js
index a..b 100644
--- a/tests/test3.js
+++ b/tests/test3.js
@@ -1,3 +1,4 @@
 import { it } from 'node:test';
+import assert from 'node:assert/strict';
 it('works', () => {});` },
];

// ═══════════════════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════════════════

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║        ChangeLens — 20-PR Validation Run                    ║");
console.log("║        Target: ChangeLens (self-referential dogfood)         ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

const results = [];
const issues = { fp: [], fn: [], awkward: [], overstate: [] };
let correct = 0;
let total = 0;

for (const pr of CORPUS) {
  total++;
  const { card, markdown } = analyze(pr.diff, PROJECT_ROOT, { prId: pr.id });

  const match = card.riskTier === pr.expected;
  if (match) correct++;

  // Log mismatches
  if (!match) {
    if (card.riskTier === "HIGH" && pr.expected === "LOW") {
      issues.fp.push({ id: pr.id, name: pr.name, got: card.riskTier, expected: pr.expected });
    } else if (card.riskTier === "LOW" && pr.expected === "HIGH") {
      issues.fn.push({ id: pr.id, name: pr.name, got: card.riskTier, expected: pr.expected });
    } else {
      issues.awkward.push({ id: pr.id, name: pr.name, got: card.riskTier, expected: pr.expected });
    }
  }

  // Check for overstated certainty
  if (markdown.includes("will break") || markdown.includes("definitely") || markdown.includes("guaranteed")) {
    issues.overstate.push({ id: pr.id, name: pr.name, evidence: "certainty language detected" });
  }

  results.push({
    id: pr.id,
    name: pr.name,
    expected: pr.expected,
    got: card.riskTier,
    match: match ? "✅" : "❌",
    consumers: card.affectedConsumers.length,
    safe: card.safeToMerge,
  });
}

// ── RESULTS TABLE ─────────────────────────────────────────────────────

console.log(`${"═".repeat(90)}`);
console.log("  RESULTS");
console.log(`${"═".repeat(90)}\n`);

const BADGES = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🔴" };

console.log("  PR     │ Match │ Expected │ Got      │ Consumers │ Scenario");
console.log("  ───────┼───────┼──────────┼──────────┼───────────┼──────────────────────────────");
for (const r of results) {
  console.log(`  ${r.id.padEnd(7)}│ ${r.match}    │ ${(BADGES[r.expected] + " " + r.expected).padEnd(9)}│ ${(BADGES[r.got] + " " + r.got).padEnd(9)}│ ${String(r.consumers).padEnd(10)}│ ${r.name}`);
}

// ── SUMMARY ───────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(90)}`);
console.log("  SUMMARY");
console.log(`${"═".repeat(90)}\n`);
console.log(`  Accuracy: ${correct}/${total} (${((correct/total)*100).toFixed(0)}%)`);
console.log(`  False positives: ${issues.fp.length}`);
console.log(`  False negatives: ${issues.fn.length}`);
console.log(`  Overstated certainty: ${issues.overstate.length}`);

if (issues.fp.length > 0) {
  console.log("\n  FALSE POSITIVES:");
  for (const i of issues.fp) console.log(`    ${i.id}: ${i.name} (expected ${i.expected}, got ${i.got})`);
}
if (issues.fn.length > 0) {
  console.log("\n  FALSE NEGATIVES:");
  for (const i of issues.fn) console.log(`    ${i.id}: ${i.name} (expected ${i.expected}, got ${i.got})`);
}
if (issues.awkward.length > 0) {
  console.log("\n  TIER MISMATCHES:");
  for (const i of issues.awkward) console.log(`    ${i.id}: ${i.name} (expected ${i.expected}, got ${i.got})`);
}
if (issues.overstate.length > 0) {
  console.log("\n  OVERSTATED CERTAINTY:");
  for (const i of issues.overstate) console.log(`    ${i.id}: ${i.name} — ${i.evidence}`);
}

console.log();
