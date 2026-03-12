// tests/hardening.test.js
// ═══════════════════════════════════════════════════════════════════════
// PHASE 3 — HARDENING TESTS
//
// Governor-discipline adversarial fixtures.
// These test the classifier and blast radius against edge cases that
// would fool naive analysis:
//
//   1. Tiny diff, huge impact ("looks small, breaks big")
//   2. Scary diff, harmless in context ("looks scary, safe in practice")
//   3. Rename / move / alias cases
//   4. Config drift
//   5. Auth touches hiding in non-auth paths
//   6. Hidden downstream breakage via re-exports
//   7. Barrel file cascade
//   8. False confidence traps
// ═══════════════════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDiff } from "../src/core/diffParser.js";
import { classifySurface, classifyAllSurfaces } from "../src/core/surfaceClassifier.js";
import { calculateBlastRadius } from "../src/core/blastRadius.js";

// ── HELPER ────────────────────────────────────────────────────────────

function quickBlast(diff, consumerMap = new Map()) {
  const files = parseDiff(diff);
  const classifications = classifyAllSurfaces(files);
  return {
    files,
    classifications,
    blast: calculateBlastRadius(classifications, consumerMap, files),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. TINY DIFF, HUGE IMPACT
//    A single-character export signature change that breaks N consumers.
// ═══════════════════════════════════════════════════════════════════════

describe("Tiny diff, huge impact", () => {
  const TINY_DIFF = `diff --git a/src/utils/crypto.ts b/src/utils/crypto.ts
index abc1234..def5678 100644
--- a/src/utils/crypto.ts
+++ b/src/utils/crypto.ts
@@ -8,5 +8,5 @@
-export function hashPassword(password) {
+export function hashPassword(password, salt = "") {
   return crypto.createHash("sha256").update(password).digest("hex");
 }`;

  it("should flag as MEDIUM+ even for a 1-line change with consumers", () => {
    const consumers = new Map([
      ["src/utils/crypto.ts", [
        { filePath: "src/auth/login.ts", importedSymbols: ["hashPassword"], depth: 1 },
        { filePath: "src/auth/register.ts", importedSymbols: ["hashPassword"], depth: 1 },
        { filePath: "src/api/reset-password.ts", importedSymbols: ["hashPassword"], depth: 1 },
      ]],
    ]);

    const { blast } = quickBlast(TINY_DIFF, consumers);
    assert.notEqual(blast.riskTier, "LOW", "1-line export change with 3 consumers must not be LOW");
    assert.ok(blast.evidence.some(e => e.includes("hashPassword")), "must cite the changed function");
    assert.equal(blast.safeToMerge, false);
  });

  it("should not inflate risk for 1-line change with zero consumers", () => {
    const { blast } = quickBlast(TINY_DIFF, new Map());
    assert.equal(blast.riskTier, "LOW", "1-line change with zero consumers should be LOW");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. SCARY DIFF, HARMLESS IN CONTEXT
//    Large deletion of test files — looks dramatic, structurally safe.
// ═══════════════════════════════════════════════════════════════════════

describe("Scary diff, harmless in context", () => {
  const SCARY_DIFF = `diff --git a/tests/integration/legacy-auth.test.js b/tests/integration/legacy-auth.test.js
deleted file mode 100644
index abc1234..0000000
--- a/tests/integration/legacy-auth.test.js
+++ /dev/null
@@ -1,85 +0,0 @@
-import { describe, it } from "node:test";
-import assert from "node:assert";
-// ... 83 more lines of test code removed
-describe("legacy auth", () => {
-  it("validates old JWT format", () => {
-    // 80 lines of test assertions
-  });
-});
diff --git a/tests/integration/legacy-crypto.test.js b/tests/integration/legacy-crypto.test.js
deleted file mode 100644
index def5678..0000000
--- a/tests/integration/legacy-crypto.test.js
+++ /dev/null
@@ -1,65 +0,0 @@
-import crypto from "crypto";
-// ... 63 more lines removed
-describe("legacy crypto tests", () => {
-  it("tests deprecated hash", () => {
-  });
-});`;

  it("should classify both deleted files as TEST", () => {
    const { classifications } = quickBlast(SCARY_DIFF);
    for (const c of classifications) {
      assert.equal(c.category, "TEST", `${c.filePath} should be TEST`);
    }
  });

  it("should rate LOW despite large deletion", () => {
    const { blast } = quickBlast(SCARY_DIFF);
    assert.equal(blast.riskTier, "LOW", "Test-only deletions should be LOW risk");
    assert.equal(blast.safeToMerge, true, "Deleting tests with no consumers is safe");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. RENAME / MOVE — same file, different path
// ═══════════════════════════════════════════════════════════════════════

describe("Rename / move detection", () => {
  const RENAME_DIFF = `diff --git a/src/helpers/format.js b/src/utils/format.js
similarity index 100%
rename from src/helpers/format.js
rename to src/utils/format.js`;

  it("should detect rename status", () => {
    const files = parseDiff(RENAME_DIFF);
    assert.equal(files.length, 1);
    assert.equal(files[0].status, "renamed");
    assert.equal(files[0].oldPath, "src/helpers/format.js");
    assert.equal(files[0].filePath, "src/utils/format.js");
  });

  it("should flag as MEDIUM if rename has consumers importing old path", () => {
    const consumers = new Map([
      ["src/utils/format.js", [
        { filePath: "src/routes/users.ts", importedSymbols: ["formatDate"], depth: 1 },
        { filePath: "src/routes/admin.ts", importedSymbols: ["formatDate"], depth: 1 },
      ]],
    ]);

    const { blast } = quickBlast(RENAME_DIFF, consumers);
    assert.notEqual(blast.riskTier, "LOW", "Rename with consumers should not be LOW");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. CONFIG DRIFT — env var rename affects runtime behavior
// ═══════════════════════════════════════════════════════════════════════

describe("Config drift", () => {
  const CONFIG_DIFF = `diff --git a/config/database.js b/config/database.js
index abc1234..def5678 100644
--- a/config/database.js
+++ b/config/database.js
@@ -3,7 +3,7 @@
 module.exports = {
-  host: process.env.DB_HOST || "localhost",
-  port: process.env.DB_PORT || 5432,
+  host: process.env.DATABASE_HOST || "localhost",
+  port: parseInt(process.env.DATABASE_PORT || "5432"),
   database: process.env.DB_NAME || "app",
 };`;

  it("should classify as CONFIG with high confidence", () => {
    const files = parseDiff(CONFIG_DIFF);
    const cls = classifySurface(files[0]);
    assert.equal(cls.category, "CONFIG");
    assert.ok(cls.confidence >= 0.85);
  });

  it("should flag env var rename as risky if consumed", () => {
    const consumers = new Map([
      ["config/database.js", [
        { filePath: "src/db/connection.ts", importedSymbols: ["*"], depth: 1 },
        { filePath: "src/db/migrations.ts", importedSymbols: ["*"], depth: 1 },
        { filePath: "tests/setup.ts", importedSymbols: ["*"], depth: 1 },
      ]],
    ]);

    const { blast } = quickBlast(CONFIG_DIFF, consumers);
    assert.notEqual(blast.riskTier, "LOW", "Config change with consumers should not be LOW");
    assert.ok(blast.evidence.some(e => e.includes("config")), "should cite config surface");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. AUTH HIDING IN NON-AUTH PATH
//    File path doesn't say "auth" but content touches tokens.
// ═══════════════════════════════════════════════════════════════════════

describe("Auth hiding in non-auth path", () => {
  const HIDDEN_AUTH_DIFF = `diff --git a/src/middleware/requestHandler.ts b/src/middleware/requestHandler.ts
index abc1234..def5678 100644
--- a/src/middleware/requestHandler.ts
+++ b/src/middleware/requestHandler.ts
@@ -10,6 +10,9 @@
 export function processRequest(req, res, next) {
+  // New: verify JWT before processing
+  const token = req.headers.authorization?.split("Bearer ")[1];
+  if (!token) return res.status(401).json({ error: "unauthorized" });
   // ... existing logic
   next();
 }`;

  it("should detect auth content in non-auth file path", () => {
    const files = parseDiff(HIDDEN_AUTH_DIFF);
    const cls = classifySurface(files[0]);
    assert.equal(cls.category, "AUTH", "Content-based detection should override default");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. HIDDEN BREAKAGE VIA RE-EXPORT (barrel file)
//    Change is in a leaf module, but a barrel index.ts re-exports it,
//    so the blast radius should include barrel consumers too.
// ═══════════════════════════════════════════════════════════════════════

describe("Hidden breakage via re-export", () => {
  const BARREL_DIFF = `diff --git a/src/utils/validators.ts b/src/utils/validators.ts
index abc1234..def5678 100644
--- a/src/utils/validators.ts
+++ b/src/utils/validators.ts
@@ -5,5 +5,5 @@
-export function validateEmail(email) {
+export function validateEmail(email, strict = false) {
   return /^[^@]+@[^@]+$/.test(email);
 }`;

  it("should detect the export signature change", () => {
    const files = parseDiff(BARREL_DIFF);
    const sValidateEmail = files[0].symbols.find(s => s.name === "validateEmail");
    assert.ok(sValidateEmail, "should find validateEmail symbol");
    assert.equal(sValidateEmail.change, "modified");
  });

  it("should flag HIGH with transitive consumers through barrel", () => {
    // Simulate: validators.ts → index.ts (barrel) → 5 route files
    const consumers = new Map([
      ["src/utils/validators.ts", [
        { filePath: "src/utils/index.ts", importedSymbols: ["validateEmail"], depth: 1 },
        { filePath: "src/routes/register.ts", importedSymbols: ["validateEmail"], depth: 2 },
        { filePath: "src/routes/profile.ts", importedSymbols: ["validateEmail"], depth: 2 },
        { filePath: "src/routes/settings.ts", importedSymbols: ["validateEmail"], depth: 2 },
        { filePath: "src/api/v2/users.ts", importedSymbols: ["validateEmail"], depth: 2 },
      ]],
    ]);

    const { blast } = quickBlast(BARREL_DIFF, consumers);
    assert.equal(blast.riskTier, "HIGH", "Export signature change with 5 consumers should be HIGH");
    assert.ok(blast.evidence.some(e => e.includes("validateEmail")));
    assert.ok(blast.evidence.some(e => e.includes("export signature")));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. STYLE-ONLY CHANGE — should never trigger risk
// ═══════════════════════════════════════════════════════════════════════

describe("Style-only change", () => {
  const STYLE_DIFF = `diff --git a/src/styles/theme.css b/src/styles/theme.css
index abc1234..def5678 100644
--- a/src/styles/theme.css
+++ b/src/styles/theme.css
@@ -15,3 +15,5 @@
   --primary: #3b82f6;
+  --primary-dark: #2563eb;
+  --primary-light: #60a5fa;
   --secondary: #10b981;
 }`;

  it("should be LOW risk and safe to merge", () => {
    const { blast } = quickBlast(STYLE_DIFF);
    assert.equal(blast.riskTier, "LOW");
    assert.equal(blast.safeToMerge, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. SCHEMA CHANGE — database migration
// ═══════════════════════════════════════════════════════════════════════

describe("Schema change", () => {
  const SCHEMA_DIFF = `diff --git a/src/models/User.ts b/src/models/User.ts
index abc1234..def5678 100644
--- a/src/models/User.ts
+++ b/src/models/User.ts
@@ -10,6 +10,7 @@
 interface User {
   id: string;
   email: string;
+  phone?: string;
   name: string;
   createdAt: Date;
 }`;

  it("should classify as SCHEMA", () => {
    const files = parseDiff(SCHEMA_DIFF);
    const cls = classifySurface(files[0]);
    assert.equal(cls.category, "SCHEMA");
  });

  it("should flag HIGH if schema has consumers", () => {
    const consumers = new Map([
      ["src/models/User.ts", [
        { filePath: "src/routes/users.ts", importedSymbols: ["User"], depth: 1 },
        { filePath: "src/services/userService.ts", importedSymbols: ["User"], depth: 1 },
      ]],
    ]);

    const { blast } = quickBlast(SCHEMA_DIFF, consumers);
    assert.equal(blast.riskTier, "HIGH", "Schema change with consumers should be HIGH");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 9. EMPTY / EDGE CASE DIFFS
// ═══════════════════════════════════════════════════════════════════════

describe("Edge cases", () => {
  it("handles empty diff gracefully", () => {
    const { blast } = quickBlast("");
    assert.equal(blast.riskTier, "LOW");
  });

  it("handles whitespace-only diff", () => {
    const WHITESPACE_DIFF = `diff --git a/src/utils/helpers.js b/src/utils/helpers.js
index abc1234..def5678 100644
--- a/src/utils/helpers.js
+++ b/src/utils/helpers.js
@@ -5,3 +5,3 @@
-  return result;
+  return result;  
 }`;

    const { blast } = quickBlast(WHITESPACE_DIFF);
    // Whitespace change — extremely low risk
    assert.equal(blast.safeToMerge, true);
  });
});
