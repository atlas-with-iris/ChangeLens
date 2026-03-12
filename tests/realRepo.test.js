// tests/realRepo.test.js
// ═══════════════════════════════════════════════════════════════════════
// REAL REPO TEST — Run ChangeLens against its own codebase (dogfood)
//
// This test generates a synthetic diff that mimics a real PR touching
// actual files in the ChangeLens project, then runs the full pipeline
// including graphWalker against the real import graph.
//
// Purpose:
//   - Verify graphWalker works on a real project structure
//   - Check surface classification on real file paths
//   - Validate import graph traversal finds real consumers
//   - Collect false positive / false negative notes
// ═══════════════════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parseDiff } from "../src/core/diffParser.js";
import { buildImportGraph, buildReverseGraph, findConsumers } from "../src/core/graphWalker.js";
import { classifyAllSurfaces } from "../src/core/surfaceClassifier.js";
import { calculateBlastRadius } from "../src/core/blastRadius.js";
import { buildImpactCard, validateImpactCard } from "../src/output/impactCardBuilder.js";
import { formatPrComment } from "../src/output/prCommentFormatter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

describe("Real repo: self-referential dogfood", () => {

  it("builds import graph from own codebase", () => {
    const graph = buildImportGraph(PROJECT_ROOT);
    // Should find multiple files
    assert.ok(graph.size > 0, `Expected files in import graph, got ${graph.size}`);
    console.log(`    📊 Import graph: ${graph.size} files scanned`);

    // Count total edges
    let totalEdges = 0;
    for (const [, edges] of graph) {
      totalEdges += edges.length;
    }
    console.log(`    📊 Import edges: ${totalEdges} total`);
  });

  it("finds consumers of diffParser.js", () => {
    const diffParserPath = resolve(PROJECT_ROOT, "src", "core", "diffParser.js");
    if (!existsSync(diffParserPath)) {
      return; // Skip if file doesn't exist
    }

    const graph = buildImportGraph(PROJECT_ROOT);
    const reverseGraph = buildReverseGraph(graph);
    const consumers = findConsumers([diffParserPath], reverseGraph, PROJECT_ROOT, 2);

    // Try both path separators
    const key = [...consumers.keys()].find(k => k.includes("diffParser.js"));
    const diffConsumers = key ? consumers.get(key) : [];
    console.log(`    📊 diffParser.js consumers: ${diffConsumers.length}`);
    for (const c of diffConsumers) {
      console.log(`       depth ${c.depth}: ${c.filePath}`);
    }

    // diffParser should have at least 1 consumer (index.js)
    assert.ok(diffConsumers.length >= 1, "diffParser.js should have at least 1 consumer");
  });

  it("finds consumers of blastRadius.js", () => {
    const blastPath = resolve(PROJECT_ROOT, "src", "core", "blastRadius.js");
    if (!existsSync(blastPath)) {
      return;
    }

    const graph = buildImportGraph(PROJECT_ROOT);
    const reverseGraph = buildReverseGraph(graph);
    const consumers = findConsumers([blastPath], reverseGraph, PROJECT_ROOT, 2);

    const key = [...consumers.keys()].find(k => k.includes("blastRadius.js"));
    const blastConsumers = key ? consumers.get(key) : [];
    console.log(`    📊 blastRadius.js consumers: ${blastConsumers.length}`);
    for (const c of blastConsumers) {
      console.log(`       depth ${c.depth}: ${c.filePath}`);
    }

    // blastRadius should be consumed by index.js
    assert.ok(blastConsumers.length >= 1, "blastRadius.js should have at least 1 consumer");
  });

  it("runs full pipeline on a synthetic diff touching real files", () => {
    // Simulate a PR that modifies diffParser.js
    const syntheticDiff = `diff --git a/src/core/diffParser.js b/src/core/diffParser.js
index abc1234..def5678 100644
--- a/src/core/diffParser.js
+++ b/src/core/diffParser.js
@@ -10,5 +10,7 @@
-export function parseDiff(diffText) {
+export function parseDiff(diffText, options = {}) {
+  const { strict = false } = options;
   // ...existing logic...
 }`;

    const files = parseDiff(syntheticDiff);
    assert.equal(files.length, 1);

    const classifications = classifyAllSurfaces(files);
    console.log(`    📊 Classification: ${classifications[0].category} (${(classifications[0].confidence * 100).toFixed(0)}%)`);

    // Build real consumer map
    const graph = buildImportGraph(PROJECT_ROOT);
    const reverseGraph = buildReverseGraph(graph);
    const changedAbsolute = [resolve(PROJECT_ROOT, "src", "core", "diffParser.js")];
    const consumerMap = findConsumers(changedAbsolute, reverseGraph, PROJECT_ROOT, 2);

    const blast = calculateBlastRadius(classifications, consumerMap, files);
    console.log(`    📊 Risk tier: ${blast.riskTier}`);
    console.log(`    📊 Consumers: ${blast.affectedConsumers.length}`);
    console.log(`    📊 Evidence:`);
    for (const e of blast.evidence) {
      console.log(`       ${e}`);
    }

    const card = buildImpactCard("PR-REAL-1", blast);
    const error = validateImpactCard(card);
    assert.equal(error, null, `Schema validation should pass: ${error}`);

    const md = formatPrComment(card);
    console.log(`\n    ── IMPACT ESTIMATE ──────────────────────────`);
    console.log(md.split("\n").map(l => `    ${l}`).join("\n"));

    // The change touches a utility with consumers — should not be LOW
    assert.notEqual(blast.riskTier, "LOW", "diffParser.js export change with consumers should not be LOW");
  });
});
