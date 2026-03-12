#!/usr/bin/env node
// action/run.js
// ═══════════════════════════════════════════════════════════════════════
// GITHUB ACTION ENTRY — Fetches PR diff, runs ChangeLens, posts comment
//
// Environment variables (set by GitHub Actions):
//   GITHUB_TOKEN       — Auth token for API calls
//   GITHUB_REPOSITORY  — owner/repo
//   GITHUB_EVENT_PATH  — Path to event payload JSON
//
// Uses the GitHub REST API directly — no dependencies.
// ═══════════════════════════════════════════════════════════════════════

import { readFileSync } from "fs";
import { resolve } from "path";
import https from "https";

// ── GitHub API Helper ─────────────────────────────────────────────────

function githubRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      port: 443,
      path,
      method,
      headers: {
        "User-Agent": "ChangeLens-Action",
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
      },
    };

    if (body) {
      options.headers["Content-Type"] = "application/json";
    }

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Input Helpers ─────────────────────────────────────────────────────

function getInput(name) {
  const envKey = `INPUT_${name.replace(/-/g, "_").toUpperCase()}`;
  return process.env[envKey] || "";
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const { appendFileSync } = await import("fs");
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("::error::GITHUB_TOKEN is required");
    process.exit(1);
  }

  // Read event payload
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error("::error::GITHUB_EVENT_PATH not set — is this running in GitHub Actions?");
    process.exit(1);
  }

  const event = JSON.parse(readFileSync(eventPath, "utf-8"));
  const prNumber = event.pull_request?.number;
  if (!prNumber) {
    console.log("Not a pull request event — skipping.");
    return;
  }

  const repo = process.env.GITHUB_REPOSITORY; // owner/repo
  const projectPath = getInput("project-path") || ".";
  const maxDepth = parseInt(getInput("max-depth") || "2", 10);
  const failOnHigh = getInput("fail-on-high") === "true";

  console.log(`🔍 ChangeLens analyzing PR #${prNumber} in ${repo}`);
  console.log(`   Project: ${projectPath}, Max depth: ${maxDepth}`);

  // Fetch the PR diff
  const diffRes = await githubRequest("GET", `/repos/${repo}/pulls/${prNumber}`, null);
  // Get diff format
  const diffReq = await new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      port: 443,
      path: `/repos/${repo}/pulls/${prNumber}`,
      method: "GET",
      headers: {
        "User-Agent": "ChangeLens-Action",
        "Accept": "application/vnd.github.v3.diff",
        "Authorization": `Bearer ${token}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.end();
  });

  if (!diffReq || !diffReq.trim()) {
    console.log("Empty diff — no changes to analyze.");
    return;
  }

  // Run ChangeLens
  const { analyze } = await import("../src/index.js");
  const projectRoot = resolve(process.env.GITHUB_WORKSPACE || ".", projectPath);
  const { card, markdown } = analyze(diffReq, projectRoot, {
    prId: `PR-${prNumber}`,
    maxDepth,
  });

  console.log(`\n   Risk: ${card.riskTier} | Consumers: ${card.affectedConsumers.length} | Safe: ${card.safeToMerge}`);

  // Post or update PR comment
  const commentMarker = "<!-- changelens-impact-card -->";
  const commentBody = `${commentMarker}\n${markdown}`;

  // Check for existing comment
  const commentsRes = await githubRequest("GET", `/repos/${repo}/issues/${prNumber}/comments?per_page=100`);
  const existing = commentsRes.data?.find?.(c => c.body?.includes(commentMarker));

  if (existing) {
    // Update existing comment
    await githubRequest("PATCH", `/repos/${repo}/issues/comments/${existing.id}`, { body: commentBody });
    console.log(`   ✅ Updated existing comment #${existing.id}`);
  } else {
    // Create new comment
    await githubRequest("POST", `/repos/${repo}/issues/${prNumber}/comments`, { body: commentBody });
    console.log(`   ✅ Posted new Impact Card comment`);
  }

  // Set outputs
  setOutput("risk-tier", card.riskTier);
  setOutput("consumer-count", String(card.affectedConsumers.length));
  setOutput("impact-card", JSON.stringify(card));

  // Fail if HIGH and configured to do so
  if (failOnHigh && card.riskTier === "HIGH") {
    console.error(`::error::Risk tier is HIGH — failing check as configured.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`::error::ChangeLens action failed: ${err.message}`);
  process.exit(1);
});
