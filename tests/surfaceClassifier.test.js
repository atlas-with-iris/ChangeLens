// tests/surfaceClassifier.test.js
// ═══════════════════════════════════════════════════════════════════════
// Unit tests for surfaceClassifier
// ═══════════════════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifySurface, highestRiskCategory } from "../src/core/surfaceClassifier.js";

function makeFileChange(filePath, addedLines = [], removedLines = []) {
  return {
    filePath,
    oldPath: filePath,
    status: "modified",
    hunks: [{ addedLines, removedLines, contextLines: [] }],
    symbols: [],
    additions: addedLines.length,
    deletions: removedLines.length,
  };
}

describe("classifySurface", () => {
  it("classifies test files", () => {
    const result = classifySurface(makeFileChange("tests/auth.test.js"));
    assert.equal(result.category, "TEST");
    assert.ok(result.confidence >= 0.9);
  });

  it("classifies spec files", () => {
    const result = classifySurface(makeFileChange("src/user.spec.ts"));
    assert.equal(result.category, "TEST");
  });

  it("classifies CSS as STYLE", () => {
    const result = classifySurface(makeFileChange("src/styles/main.css"));
    assert.equal(result.category, "STYLE");
  });

  it("classifies auth middleware", () => {
    const result = classifySurface(makeFileChange("src/middleware/auth.ts"));
    assert.equal(result.category, "AUTH");
  });

  it("classifies API routes", () => {
    const result = classifySurface(makeFileChange("src/routes/users.js"));
    assert.equal(result.category, "API");
  });

  it("classifies config files", () => {
    const result = classifySurface(makeFileChange("config/database.js"));
    assert.equal(result.category, "CONFIG");
  });

  it("classifies schema/models", () => {
    const result = classifySurface(makeFileChange("src/models/User.ts"));
    assert.equal(result.category, "SCHEMA");
  });

  it("classifies build configs", () => {
    const result = classifySurface(makeFileChange("Dockerfile"));
    assert.equal(result.category, "BUILD");
  });

  it("classifies docs", () => {
    const result = classifySurface(makeFileChange("README.md"));
    assert.equal(result.category, "DOCS");
  });

  it("classifies utility files", () => {
    const result = classifySurface(makeFileChange("src/utils/format.js"));
    assert.equal(result.category, "UTILITY");
  });

  it("defaults to UTILITY for unknown paths", () => {
    const result = classifySurface(makeFileChange("src/something/random.js"));
    assert.equal(result.category, "UTILITY");
    assert.ok(result.confidence <= 0.5);
  });

  it("uses content patterns for auth detection", () => {
    const result = classifySurface(
      makeFileChange("src/middleware/check.js", ["  const token = req.headers.authorization;"])
    );
    assert.equal(result.category, "AUTH");
  });

  it("uses content patterns for API detection", () => {
    const result = classifySurface(
      makeFileChange("src/app.js", ['app.get("/users", handler);'])
    );
    assert.equal(result.category, "API");
  });
});

describe("highestRiskCategory", () => {
  it("returns AUTH as highest risk", () => {
    const classifications = [
      { category: "TEST", confidence: 0.9 },
      { category: "AUTH", confidence: 0.9 },
      { category: "UTILITY", confidence: 0.7 },
    ];
    assert.equal(highestRiskCategory(classifications), "AUTH");
  });

  it("returns STYLE for style-only changes", () => {
    const classifications = [
      { category: "STYLE", confidence: 0.9 },
    ];
    assert.equal(highestRiskCategory(classifications), "STYLE");
  });
});
