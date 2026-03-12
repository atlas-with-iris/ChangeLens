// tests/scar.test.js
// ═══════════════════════════════════════════════════════════════════════
// SCAR — Structural memory tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  createEmptyLedger,
  createEmptyFileScar,
  loadLedger,
  saveLedger,
  recordEvent,
  recordMerge,
  getFileScar,
  getHotFiles,
} from "../src/scar/scarLedger.js";

import {
  detectReverts,
  detectKeywordIncidents,
  detectRapidFollowups,
} from "../src/scar/scarDetector.js";

import {
  getScarTier,
  generateFileReport,
  generateReportsForFiles,
  formatScarMarkdown,
  formatScarTerminal,
} from "../src/scar/scarScorer.js";

// ═══ LEDGER TESTS ═══════════════════════════════════════════════════

describe("Scar Ledger", () => {
  const testDir = join(tmpdir(), `scar-test-${Date.now()}`);

  it("should create an empty ledger", () => {
    const ledger = createEmptyLedger("test/repo");
    assert.equal(ledger.version, 1);
    assert.equal(ledger.repo, "test/repo");
    assert.deepEqual(ledger.scars, {});
    assert.deepEqual(ledger.events, []);
  });

  it("should save and load a ledger", () => {
    mkdirSync(testDir, { recursive: true });
    const ledger = createEmptyLedger("test/repo");
    ledger.scars["src/auth.js"] = {
      total_prs: 10,
      incidents: 2,
      rollbacks: 1,
      hotfixes: 1,
      rapid_followups: 0,
      last_incident: "2026-03-01",
      scar_score: 0.2,
    };

    saveLedger(testDir, ledger);
    assert.ok(existsSync(join(testDir, ".changelens", "scars.json")));

    const loaded = loadLedger(testDir);
    assert.equal(loaded.scars["src/auth.js"].scar_score, 0.2);
    assert.equal(loaded.scars["src/auth.js"].incidents, 2);
    rmSync(testDir, { recursive: true });
  });

  it("should return empty ledger for missing file", () => {
    const ledger = loadLedger("/nonexistent/path");
    assert.deepEqual(ledger.scars, {});
  });

  it("should record events and update file scars", () => {
    const ledger = createEmptyLedger("test/repo");

    // First add some merge history
    recordMerge(ledger, ["src/auth.js"]);
    recordMerge(ledger, ["src/auth.js"]);
    recordMerge(ledger, ["src/auth.js"]);
    recordMerge(ledger, ["src/auth.js"]);

    assert.equal(ledger.scars["src/auth.js"].total_prs, 4);

    // Now record an incident
    recordEvent(ledger, {
      type: "rollback",
      commit: "abc1234",
      files: ["src/auth.js"],
      date: "2026-03-01",
      message: "Revert \"update auth middleware\"",
      detected_by: "revert-commit",
    });

    assert.equal(ledger.scars["src/auth.js"].incidents, 1);
    assert.equal(ledger.scars["src/auth.js"].rollbacks, 1);
    assert.equal(ledger.scars["src/auth.js"].scar_score, 0.25);
    assert.equal(ledger.events.length, 1);
  });

  it("should track hot files above threshold", () => {
    const ledger = createEmptyLedger("test/repo");

    // Clean file
    recordMerge(ledger, ["src/utils.js"]);
    recordMerge(ledger, ["src/utils.js"]);
    recordMerge(ledger, ["src/utils.js"]);

    // Scarred file
    recordMerge(ledger, ["src/auth.js"]);
    recordMerge(ledger, ["src/auth.js"]);
    recordEvent(ledger, {
      type: "rollback",
      commit: "abc1234",
      files: ["src/auth.js"],
      date: "2026-03-01",
      message: "Revert auth",
      detected_by: "revert-commit",
    });

    const hot = getHotFiles(ledger, 0.05);
    assert.equal(hot.length, 1);
    assert.equal(hot[0].filePath, "src/auth.js");
    assert.ok(hot[0].scar.scar_score > 0.05);
  });
});

// ═══ DETECTOR TESTS ═══════════════════════════════════════════════════

describe("Scar Detector", () => {
  it("should detect revert commits", () => {
    const commits = [
      { hash: "abc1234", date: "2026-03-01", message: 'Revert "update auth"', author: "dev", files: ["src/auth.js"], branch: "" },
      { hash: "def5678", date: "2026-03-01", message: "add feature", author: "dev", files: ["src/feature.js"], branch: "" },
    ];

    const events = detectReverts(commits);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "rollback");
    assert.equal(events[0].detected_by, "revert-commit");
    assert.deepEqual(events[0].files, ["src/auth.js"]);
  });

  it("should detect keyword incidents", () => {
    const commits = [
      { hash: "abc1234", date: "2026-03-01", message: "fix regression in login flow", author: "dev", files: ["src/login.js"], branch: "" },
      { hash: "def5678", date: "2026-03-01", message: "update docs", author: "dev", files: ["README.md"], branch: "" },
      { hash: "ghi9012", date: "2026-03-01", message: "emergency fix: broken deploy", author: "dev", files: ["config/deploy.js"], branch: "" },
    ];

    const events = detectKeywordIncidents(commits);
    assert.equal(events.length, 2);
    assert.ok(events.some(e => e.files.includes("src/login.js")));
    assert.ok(events.some(e => e.files.includes("config/deploy.js")));
  });

  it("should not double-count reverts as keyword incidents", () => {
    const commits = [
      { hash: "abc1234", date: "2026-03-01", message: 'Revert "broke the build"', author: "dev", files: ["src/build.js"], branch: "" },
    ];

    const reverts = detectReverts(commits);
    const keywords = detectKeywordIncidents(commits);
    assert.equal(reverts.length, 1);
    assert.equal(keywords.length, 0); // Should not double-count
  });

  it("should detect rapid follow-ups within 48h window", () => {
    const commits = [
      { hash: "abc1234", date: "2026-03-01T10:00:00Z", message: "update auth", author: "dev", files: ["src/auth.js"], branch: "" },
      { hash: "def5678", date: "2026-03-01T14:00:00Z", message: "fix auth again", author: "dev", files: ["src/auth.js"], branch: "" },
    ];

    const events = detectRapidFollowups(commits, 48);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "rapid_followup");
  });

  it("should NOT flag changes outside the window", () => {
    const commits = [
      { hash: "abc1234", date: "2026-03-01T10:00:00Z", message: "update auth", author: "dev", files: ["src/auth.js"], branch: "" },
      { hash: "def5678", date: "2026-03-10T10:00:00Z", message: "update auth again", author: "dev", files: ["src/auth.js"], branch: "" },
    ];

    const events = detectRapidFollowups(commits, 48);
    assert.equal(events.length, 0);
  });
});

// ═══ SCORER TESTS ═══════════════════════════════════════════════════

describe("Scar Scorer", () => {
  it("should assign CLEAN tier for score 0", () => {
    assert.equal(getScarTier(0), "CLEAN");
  });

  it("should assign CAUTION tier for score 0.08", () => {
    assert.equal(getScarTier(0.08), "CAUTION");
  });

  it("should assign HOT tier for score 0.20", () => {
    assert.equal(getScarTier(0.20), "HOT");
  });

  it("should assign DANGER tier for score 0.35", () => {
    assert.equal(getScarTier(0.35), "DANGER");
  });

  it("should generate a file report with correct tier", () => {
    const scar = {
      total_prs: 10,
      incidents: 3,
      rollbacks: 2,
      hotfixes: 1,
      rapid_followups: 0,
      last_incident: "2026-03-01",
      scar_score: 0.3,
    };

    const report = generateFileReport("src/auth.js", scar);
    assert.equal(report.tier, "DANGER");
    assert.equal(report.scarScore, 0.3);
    assert.ok(report.summary.includes("30.0%"));
  });

  it("should generate reports only for files with scar history", () => {
    const ledger = createEmptyLedger();
    ledger.scars["src/auth.js"] = {
      total_prs: 10, incidents: 2, rollbacks: 1, hotfixes: 1,
      rapid_followups: 0, last_incident: "2026-03-01", scar_score: 0.2,
    };
    ledger.scars["src/utils.js"] = {
      total_prs: 20, incidents: 0, rollbacks: 0, hotfixes: 0,
      rapid_followups: 0, last_incident: null, scar_score: 0.0,
    };

    const reports = generateReportsForFiles(["src/auth.js", "src/utils.js", "src/new.js"], ledger);
    assert.equal(reports.length, 1); // Only auth.js has scar_score > 0
    assert.equal(reports[0].filePath, "src/auth.js");
  });

  it("should format scar markdown with DANGER warning", () => {
    const ledger = createEmptyLedger();
    ledger.scars["src/auth.js"] = {
      total_prs: 5, incidents: 2, rollbacks: 2, hotfixes: 0,
      rapid_followups: 0, last_incident: "2026-03-01", scar_score: 0.4,
    };

    const reports = generateReportsForFiles(["src/auth.js"], ledger);
    const md = formatScarMarkdown(reports);
    assert.ok(md.includes("Scar Memory"));
    assert.ok(md.includes("DANGER files detected"));
    assert.ok(md.includes("src/auth.js"));
  });

  it("should return empty string when no scar history", () => {
    const md = formatScarMarkdown([]);
    assert.equal(md, "");
  });

  it("should format terminal output with scar bars", () => {
    const ledger = createEmptyLedger();
    ledger.scars["src/auth.js"] = {
      total_prs: 10, incidents: 3, rollbacks: 2, hotfixes: 1,
      rapid_followups: 0, last_incident: "2026-03-01", scar_score: 0.3,
    };

    const reports = generateReportsForFiles(["src/auth.js"], ledger);
    const term = formatScarTerminal(reports);
    assert.ok(term.includes("Scar Memory"));
    assert.ok(term.includes("src/auth.js"));
    assert.ok(term.includes("█"));
  });
});
