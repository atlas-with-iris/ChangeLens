// tests/diffParser.test.js
// ═══════════════════════════════════════════════════════════════════════
// Unit tests for diffParser — deterministic diff parsing
// ═══════════════════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, diffSummary } from "../src/core/diffParser.js";

// ── FIXTURE: Simple file modification ─────────────────────────────────
const SIMPLE_MODIFY_DIFF = `diff --git a/src/utils/helpers.js b/src/utils/helpers.js
index abc1234..def5678 100644
--- a/src/utils/helpers.js
+++ b/src/utils/helpers.js
@@ -10,7 +10,8 @@
 const TIMEOUT = 5000;
 
-function formatDate(date) {
-  return date.toISOString();
+function formatDate(date, locale = "en-US") {
+  return new Intl.DateTimeFormat(locale).format(date);
+}
+
+export function parseDate(str) {
+  return new Date(str);
 }`;

// ── FIXTURE: New file ─────────────────────────────────────────────────
const NEW_FILE_DIFF = `diff --git a/src/api/users.ts b/src/api/users.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/api/users.ts
@@ -0,0 +1,15 @@
+import { Router } from "express";
+import { validateToken } from "../auth/middleware";
+
+const router = Router();
+
+router.get("/users", validateToken, async (req, res) => {
+  const users = await db.query("SELECT * FROM users");
+  res.json(users);
+});
+
+export default router;`;

// ── FIXTURE: Deleted file ─────────────────────────────────────────────
const DELETED_FILE_DIFF = `diff --git a/src/legacy/oldHandler.js b/src/legacy/oldHandler.js
deleted file mode 100644
index abc1234..0000000
--- a/src/legacy/oldHandler.js
+++ /dev/null
@@ -1,10 +0,0 @@
-export function oldHandler(req, res) {
-  res.send("deprecated");
-}`;

// ── FIXTURE: Renamed file ─────────────────────────────────────────────
const RENAMED_FILE_DIFF = `diff --git a/src/helpers.js b/src/utils/helpers.js
similarity index 95%
rename from src/helpers.js
rename to src/utils/helpers.js
index abc1234..def5678 100644
--- a/src/helpers.js
+++ b/src/utils/helpers.js
@@ -1,3 +1,3 @@
-export const VERSION = "1.0";
+export const VERSION = "2.0";`;

// ── FIXTURE: Multi-file diff ──────────────────────────────────────────
const MULTI_FILE_DIFF = `${SIMPLE_MODIFY_DIFF}
${NEW_FILE_DIFF}`;

// ── FIXTURE: Export changes ───────────────────────────────────────────
const EXPORT_CHANGE_DIFF = `diff --git a/src/auth/middleware.ts b/src/auth/middleware.ts
index abc1234..def5678 100644
--- a/src/auth/middleware.ts
+++ b/src/auth/middleware.ts
@@ -5,8 +5,10 @@
-export function validateToken(req, res, next) {
-  const token = req.headers.authorization;
+export function validateToken(req, res, next) {
+  const token = req.headers.authorization?.split("Bearer ")[1];
+  if (!token) return res.status(401).json({ error: "No token" });
   // validate
   next();
 }
+
+export const AUTH_HEADER = "Authorization";`;

describe("parseDiff", () => {
  it("parses a simple file modification", () => {
    const files = parseDiff(SIMPLE_MODIFY_DIFF);
    assert.equal(files.length, 1);
    assert.equal(files[0].filePath, "src/utils/helpers.js");
    assert.equal(files[0].status, "modified");
    assert.ok(files[0].additions > 0);
    assert.ok(files[0].deletions > 0);
    assert.ok(files[0].hunks.length > 0);
  });

  it("extracts symbols from modifications", () => {
    const files = parseDiff(SIMPLE_MODIFY_DIFF);
    const symbols = files[0].symbols;
    assert.ok(symbols.length > 0, "should extract symbols");
    const formatDate = symbols.find(s => s.name === "formatDate");
    assert.ok(formatDate, "should find formatDate symbol");
    assert.equal(formatDate.change, "modified");
  });

  it("detects new file", () => {
    const files = parseDiff(NEW_FILE_DIFF);
    assert.equal(files.length, 1);
    assert.equal(files[0].status, "added");
    assert.equal(files[0].filePath, "src/api/users.ts");
    assert.equal(files[0].deletions, 0);
    assert.ok(files[0].additions > 0);
  });

  it("detects deleted file", () => {
    const files = parseDiff(DELETED_FILE_DIFF);
    assert.equal(files.length, 1);
    assert.equal(files[0].status, "deleted");
    assert.ok(files[0].deletions > 0);
    assert.equal(files[0].additions, 0);
  });

  it("detects renamed file", () => {
    const files = parseDiff(RENAMED_FILE_DIFF);
    assert.equal(files.length, 1);
    assert.equal(files[0].status, "renamed");
    assert.equal(files[0].oldPath, "src/helpers.js");
    assert.equal(files[0].filePath, "src/utils/helpers.js");
  });

  it("parses multi-file diff", () => {
    const files = parseDiff(MULTI_FILE_DIFF);
    assert.equal(files.length, 2);
  });

  it("extracts export symbols", () => {
    const files = parseDiff(EXPORT_CHANGE_DIFF);
    const symbols = files[0].symbols;
    const validateToken = symbols.find(s => s.name === "validateToken");
    assert.ok(validateToken, "should find validateToken");
    const authHeader = symbols.find(s => s.name === "AUTH_HEADER");
    assert.ok(authHeader, "should find AUTH_HEADER");
    assert.equal(authHeader.change, "added");
  });

  it("returns empty array for null/empty input", () => {
    assert.deepEqual(parseDiff(""), []);
    assert.deepEqual(parseDiff(null), []);
    assert.deepEqual(parseDiff(undefined), []);
  });
});

describe("diffSummary", () => {
  it("produces correct summary stats", () => {
    const files = parseDiff(MULTI_FILE_DIFF);
    const summary = diffSummary(files);
    assert.equal(summary.totalFiles, 2);
    assert.ok(summary.totalAdditions > 0);
    assert.ok(summary.symbolsChanged >= 0);
  });
});
