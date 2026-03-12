// src/demo.js
// ═══════════════════════════════════════════════════════════════════════
// CHANGELENS DEMO — Generate a sample Impact Card from a synthetic PR
//
// Run: node src/demo.js
//
// This generates a realistic Impact Card to demonstrate ChangeLens output.
// Uses synthetic diffs — no real repo dependency scanning needed.
// ═══════════════════════════════════════════════════════════════════════

import { parseDiff } from "./core/diffParser.js";
import { classifyAllSurfaces } from "./core/surfaceClassifier.js";
import { calculateBlastRadius } from "./core/blastRadius.js";
import { buildImpactCard, validateImpactCard } from "./output/impactCardBuilder.js";
import { formatPrComment } from "./output/prCommentFormatter.js";

// ── SYNTHETIC PR DIFF ─────────────────────────────────────────────────
// Scenario: Developer modifies the auth middleware to change token validation
// and updates a shared utility used by 4 API routes.

const DEMO_DIFF = `diff --git a/src/auth/middleware.ts b/src/auth/middleware.ts
index abc1234..def5678 100644
--- a/src/auth/middleware.ts
+++ b/src/auth/middleware.ts
@@ -12,9 +12,12 @@
 import { verifyJwt } from "../utils/crypto";
 
-export function validateToken(req, res, next) {
-  const token = req.headers.authorization;
-  if (!token) return res.status(401).send("Unauthorized");
+export function validateToken(req, res, next) {
+  const raw = req.headers.authorization;
+  if (!raw) return res.status(401).json({ error: "missing_token" });
+  const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;
+  if (!token) return res.status(401).json({ error: "malformed_token" });
   const decoded = verifyJwt(token);
   if (!decoded) return res.status(403).send("Forbidden");
   req.user = decoded;
   next();
 }
+
+export const AUTH_VERSION = "2.1.0";
diff --git a/src/utils/format.ts b/src/utils/format.ts
index 111aaaa..222bbbb 100644
--- a/src/utils/format.ts
+++ b/src/utils/format.ts
@@ -5,8 +5,10 @@
 /**
  * Format API response with standard envelope.
  */
-export function formatResponse(data, status = 200) {
-  return { status, data, timestamp: Date.now() };
+export function formatResponse(data, status = 200, meta = {}) {
+  return { status, data, meta, timestamp: Date.now(), version: "2.0" };
+}
+
+export function formatError(message, code = 500) {
+  return { status: code, error: message, timestamp: Date.now() };
 }
diff --git a/tests/auth.test.ts b/tests/auth.test.ts
index 333cccc..444dddd 100644
--- a/tests/auth.test.ts
+++ b/tests/auth.test.ts
@@ -15,6 +15,14 @@
   expect(res.status).toBe(401);
 });
 
+it("rejects malformed Bearer token", () => {
+  const req = { headers: { authorization: "Bearer " } };
+  const res = mockResponse();
+  validateToken(req, res, jest.fn());
+  expect(res.status).toBe(401);
+  expect(res.body.error).toBe("malformed_token");
+});
+
 it("accepts valid JWT", () => {
`;

// ── RUN DEMO ──────────────────────────────────────────────────────────

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║              ChangeLens — Demo Impact Card                  ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

// Step 1: Parse
const fileChanges = parseDiff(DEMO_DIFF);
console.log(`📂 Parsed ${fileChanges.length} file(s) from diff\n`);

for (const f of fileChanges) {
  console.log(`   ${f.status.toUpperCase().padEnd(8)} ${f.filePath} (+${f.additions}/-${f.deletions})`);
  if (f.symbols.length > 0) {
    console.log(`            symbols: ${f.symbols.map(s => `${s.change} ${s.kind} "${s.name}"`).join(", ")}`);
  }
}
console.log();

// Step 2: Classify
const classifications = classifyAllSurfaces(fileChanges);
console.log("🏷️  Surface classifications:");
for (const c of classifications) {
  console.log(`   ${c.category.padEnd(8)} ${c.filePath} (${(c.confidence * 100).toFixed(0)}% confidence)`);
}
console.log();

// Step 3: Simulate consumers (in real use, graphWalker would find these)
const consumerMap = new Map([
  ["src/auth/middleware.ts", [
    { filePath: "src/routes/users.ts", importedSymbols: ["validateToken"], depth: 1 },
    { filePath: "src/routes/admin.ts", importedSymbols: ["validateToken"], depth: 1 },
    { filePath: "src/routes/profile.ts", importedSymbols: ["validateToken"], depth: 1 },
    { filePath: "src/api/v2/gateway.ts", importedSymbols: ["validateToken"], depth: 1 },
  ]],
  ["src/utils/format.ts", [
    { filePath: "src/routes/users.ts", importedSymbols: ["formatResponse"], depth: 1 },
    { filePath: "src/routes/admin.ts", importedSymbols: ["formatResponse"], depth: 1 },
    { filePath: "src/routes/profile.ts", importedSymbols: ["formatResponse"], depth: 1 },
    { filePath: "src/routes/health.ts", importedSymbols: ["formatResponse"], depth: 1 },
    { filePath: "src/api/v2/gateway.ts", importedSymbols: ["formatResponse"], depth: 1 },
    { filePath: "src/api/v2/webhooks.ts", importedSymbols: ["formatResponse"], depth: 1 },
  ]],
]);

// Step 4: Calculate blast radius
const blastResult = calculateBlastRadius(classifications, consumerMap, fileChanges);
console.log(`🎯 Risk Tier: ${blastResult.riskTier}`);
console.log(`   ${blastResult.why}\n`);

// Step 5: Build card
const card = buildImpactCard("PR-127", blastResult);

// Step 6: Validate
const error = validateImpactCard(card);
if (error) {
  console.error(`❌ Schema error: ${error}`);
} else {
  console.log("✅ Impact Card schema valid\n");
}

// Step 7: Render
console.log("═".repeat(64));
console.log("  GITHUB PR COMMENT OUTPUT");
console.log("═".repeat(64));
console.log();
console.log(formatPrComment(card));
console.log();
console.log("═".repeat(64));
console.log();

// Also output JSON
console.log("📋 JSON Impact Card:");
console.log(JSON.stringify(card, null, 2));
