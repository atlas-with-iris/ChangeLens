// tests/diffShield.test.js
// ═══════════════════════════════════════════════════════════════════════
// DIFFSHIELD — Policy enforcement tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, formatShieldVerdict, loadShieldConfig } from "../src/shield/diffShield.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Test Impact Cards ─────────────────────────────────────────────────

const HIGH_CARD = {
  riskTier: "HIGH",
  summary: "Auth middleware changed with 15 consumers",
  changedSurfaces: ["AUTH: src/auth/middleware.js (2 symbols: validateToken, AUTH_VERSION)"],
  affectedConsumers: ["src/routes/users.js", "src/routes/admin.js"],
  why: "Critical surface changed with 15 downstream consumers",
  evidence: ["modified function \"validateToken\" in src/auth/middleware.js"],
  mergeCaution: "Review downstream consumers before merging.",
  safeToMerge: false,
};

const MEDIUM_CARD = {
  riskTier: "MEDIUM",
  summary: "Utility module changed with 3 consumers",
  changedSurfaces: ["UTILITY: src/utils/format.js (1 symbol: formatResponse)"],
  affectedConsumers: ["src/routes/api.js"],
  why: "Shared surface changed with 3 downstream consumers",
  evidence: ["modified function \"formatResponse\" in src/utils/format.js"],
  mergeCaution: "Verify downstream consumers handle the updated interface.",
  safeToMerge: false,
};

const LOW_CARD = {
  riskTier: "LOW",
  summary: "Test file updated",
  changedSurfaces: ["TEST: tests/auth.test.js (+5/-3)"],
  affectedConsumers: [],
  why: "No downstream consumers detected — leaf change",
  evidence: [],
  mergeCaution: "Low structural risk — standard review applies.",
  safeToMerge: true,
};

const DOCS_CARD = {
  riskTier: "LOW",
  summary: "README updated",
  changedSurfaces: ["DOCS: README.md (+10/-5)"],
  affectedConsumers: [],
  why: "No downstream consumers detected — leaf change",
  evidence: [],
  mergeCaution: "Low structural risk.",
  safeToMerge: true,
};

// ── Default config for tests ──────────────────────────────────────────

const WARN_CONFIG = {
  mode: "warn",
  block_on_high: true,
  require_approvals: 2,
  require_approvals_medium: 1,
  bypass_surfaces: ["DOCS", "TEST", "STYLE"],
  slack_webhook: "",
  label_prs: true,
};

const BLOCK_CONFIG = {
  ...WARN_CONFIG,
  mode: "block",
};

// ═══ TESTS ═══════════════════════════════════════════════════════════

describe("DiffShield: evaluatePolicy", () => {

  // ── LOW risk ────────────────────────────────────────────────────────

  it("should pass LOW risk changes without enforcement", () => {
    const verdict = evaluatePolicy(LOW_CARD, WARN_CONFIG);
    assert.equal(verdict.action, "pass");
    assert.equal(verdict.riskTier, "LOW");
  });

  it("should pass LOW risk even in block mode", () => {
    const verdict = evaluatePolicy(LOW_CARD, BLOCK_CONFIG);
    assert.equal(verdict.action, "pass");
  });

  // ── DOCS/TEST bypass ────────────────────────────────────────────────

  it("should bypass enforcement for DOCS-only changes", () => {
    const verdict = evaluatePolicy(DOCS_CARD, BLOCK_CONFIG);
    assert.equal(verdict.action, "pass");
    assert.ok(verdict.reason.includes("bypass"));
  });

  // ── MEDIUM risk ─────────────────────────────────────────────────────

  it("should warn on MEDIUM risk with insufficient approvals (warn mode)", () => {
    const verdict = evaluatePolicy(MEDIUM_CARD, WARN_CONFIG, { approvalCount: 0 });
    assert.equal(verdict.action, "warn");
    assert.equal(verdict.riskTier, "MEDIUM");
  });

  it("should block on MEDIUM risk with insufficient approvals (block mode)", () => {
    const verdict = evaluatePolicy(MEDIUM_CARD, BLOCK_CONFIG, { approvalCount: 0 });
    assert.equal(verdict.action, "block");
  });

  it("should pass MEDIUM risk with sufficient approvals", () => {
    const verdict = evaluatePolicy(MEDIUM_CARD, WARN_CONFIG, { approvalCount: 1 });
    assert.equal(verdict.action, "pass");
  });

  // ── HIGH risk ───────────────────────────────────────────────────────

  it("should warn on HIGH risk with insufficient approvals (warn mode)", () => {
    const verdict = evaluatePolicy(HIGH_CARD, WARN_CONFIG, { approvalCount: 0 });
    assert.equal(verdict.action, "warn");
    assert.ok(verdict.reason.includes("DiffShield"));
  });

  it("should block on HIGH risk with insufficient approvals (block mode)", () => {
    const verdict = evaluatePolicy(HIGH_CARD, BLOCK_CONFIG, { approvalCount: 0 });
    assert.equal(verdict.action, "block");
    assert.ok(verdict.reason.includes("Merge blocked"));
  });

  it("should pass HIGH risk with sufficient approvals", () => {
    const verdict = evaluatePolicy(HIGH_CARD, BLOCK_CONFIG, { approvalCount: 2 });
    assert.equal(verdict.action, "pass");
    assert.ok(verdict.reason.includes("merge permitted"));
  });

  it("should pass HIGH risk with MORE than required approvals", () => {
    const verdict = evaluatePolicy(HIGH_CARD, BLOCK_CONFIG, { approvalCount: 5 });
    assert.equal(verdict.action, "pass");
  });

  // ── Enforced flag ───────────────────────────────────────────────────

  it("should set enforced=false in warn mode", () => {
    const verdict = evaluatePolicy(HIGH_CARD, WARN_CONFIG);
    assert.equal(verdict.enforced, false);
  });

  it("should set enforced=true in block mode", () => {
    const verdict = evaluatePolicy(HIGH_CARD, BLOCK_CONFIG);
    assert.equal(verdict.enforced, true);
  });
});

// ═══ CONFIG LOADING ═══════════════════════════════════════════════════

describe("DiffShield: loadShieldConfig", () => {
  const testDir = join(tmpdir(), `changelens-test-${Date.now()}`);

  it("should return defaults when no config file exists", () => {
    mkdirSync(testDir, { recursive: true });
    const config = loadShieldConfig(testDir);
    assert.equal(config.mode, "warn");
    assert.equal(config.block_on_high, false);
    assert.equal(config.require_approvals, 2);
    rmSync(testDir, { recursive: true });
  });

  it("should load YAML-style config", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, ".changelens.yml"), [
      "mode: block",
      "block_on_high: true",
      "require_approvals: 3",
      "require_approvals_medium: 2",
      "bypass_surfaces: [DOCS, TEST]",
    ].join("\n"));

    const config = loadShieldConfig(testDir);
    assert.equal(config.mode, "block");
    assert.equal(config.block_on_high, true);
    assert.equal(config.require_approvals, 3);
    assert.equal(config.require_approvals_medium, 2);
    assert.deepEqual(config.bypass_surfaces, ["DOCS", "TEST"]);
    rmSync(testDir, { recursive: true });
  });

  it("should load JSON config", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, ".changelens.json"), JSON.stringify({
      mode: "block",
      block_on_high: true,
      require_approvals: 4,
    }));

    const config = loadShieldConfig(testDir);
    assert.equal(config.mode, "block");
    assert.equal(config.require_approvals, 4);
    rmSync(testDir, { recursive: true });
  });
});

// ═══ VERDICT FORMATTING ═══════════════════════════════════════════════

describe("DiffShield: formatShieldVerdict", () => {
  it("should format a block verdict with proper header", () => {
    const verdict = evaluatePolicy(HIGH_CARD, BLOCK_CONFIG, { approvalCount: 0 });
    const formatted = formatShieldVerdict(verdict);
    assert.ok(formatted.includes("Merge Blocked"));
    assert.ok(formatted.includes("DiffShield"));
  });

  it("should format a pass verdict with approval info", () => {
    const verdict = evaluatePolicy(HIGH_CARD, BLOCK_CONFIG, { approvalCount: 2 });
    const formatted = formatShieldVerdict(verdict);
    assert.ok(formatted.includes("Approved"));
  });

  it("should format a warn verdict with advisory language", () => {
    const verdict = evaluatePolicy(HIGH_CARD, WARN_CONFIG, { approvalCount: 0 });
    const formatted = formatShieldVerdict(verdict);
    assert.ok(formatted.includes("Review Required"));
  });
});
