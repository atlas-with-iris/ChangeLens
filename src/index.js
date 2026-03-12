#!/usr/bin/env node
// src/index.js
// ═══════════════════════════════════════════════════════════════════════
// CHANGELENS — Pre-merge change impact visualizer
//
// CLI entry point.
//
// Usage:
//   echo "$(git diff main)" | node src/index.js --project ./path/to/repo
//   node src/index.js --diff ./path/to/diff.patch --project ./path/to/repo
//   node src/index.js --project ./path/to/repo   (reads from stdin)
//
// Output: Impact Card as GitHub-flavored markdown (stdout)
// ═══════════════════════════════════════════════════════════════════════

import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDiff, diffSummary } from "./core/diffParser.js";
import { analyzeImpact } from "./core/graphWalker.js";
import { classifyAllSurfaces } from "./core/surfaceClassifier.js";
import { calculateBlastRadius } from "./core/blastRadius.js";
import { buildImpactCard, validateImpactCard } from "./output/impactCardBuilder.js";
import { formatPrComment } from "./output/prCommentFormatter.js";
import { formatTerminal } from "./output/terminalFormatter.js";

const VERSION = "0.1.0";

// ── ANSI helpers (for status messages to stderr) ──────────────────────

const isTTY = process.stderr.isTTY;
const dim = (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s;
const cyan = (s) => isTTY ? `\x1b[36m${s}\x1b[0m` : s;
const bold = (s) => isTTY ? `\x1b[1m${s}\x1b[0m` : s;

function status(msg) {
  if (isTTY) {
    process.stderr.write(`  ${cyan("▸")} ${msg}\n`);
  }
}

/**
 * Run the full ChangeLens pipeline.
 *
 * @param {string} diffText     - Unified diff string
 * @param {string} projectRoot  - Path to the project root
 * @param {Object} [options]
 * @param {string} [options.prId]       - PR identifier (default: "local")
 * @param {number} [options.maxDepth]   - Max consumer traversal depth (default: 2)
 * @param {"json"|"markdown"|"both"|"terminal"} [options.format] - Output format
 * @returns {{ card: ImpactCard, markdown: string, terminal: string, meta: Object }}
 */
export function analyze(diffText, projectRoot, options = {}) {
  const prId = options.prId || "local";
  const maxDepth = options.maxDepth || 2;
  const t0 = Date.now();

  // Step 1: Parse the diff
  status("Parsing diff...");
  const fileChanges = parseDiff(diffText);
  if (fileChanges.length === 0) {
    const card = buildImpactCard(prId, {
      riskTier: "LOW",
      summary: "No parseable changes detected",
      changedSurfaces: [],
      affectedConsumers: [],
      why: "Empty or unparseable diff",
      evidence: [],
      mergeCaution: "Verify diff is valid",
      safeToMerge: true,
    });
    return {
      card,
      markdown: "No changes detected.",
      terminal: "No changes detected.",
      meta: { timeMs: Date.now() - t0, filesScanned: 0 },
    };
  }

  const summary = diffSummary(fileChanges);
  status(`Parsed ${summary.totalFiles} file(s), ${summary.totalAdditions}+ / ${summary.totalDeletions}- lines, ${summary.symbolsChanged} symbol(s)`);

  // Step 2: Classify surfaces
  status("Classifying surfaces...");
  const classifications = classifyAllSurfaces(fileChanges);

  // Step 3: Walk the import graph and find consumers
  status(`Scanning import graph at ${projectRoot}...`);
  const changedPaths = fileChanges.map(f => f.filePath);
  const consumerMap = analyzeImpact(projectRoot, changedPaths, maxDepth);
  const totalConsumers = [...consumerMap.values()].reduce((s, v) => s + v.length, 0);
  status(`Found ${totalConsumers} downstream consumer(s)`);

  // Step 4: Calculate blast radius
  status("Calculating blast radius...");
  const blastResult = calculateBlastRadius(classifications, consumerMap, fileChanges);

  // Step 5: Build Impact Card
  const card = buildImpactCard(prId, blastResult);

  // Step 6: Validate
  const validationError = validateImpactCard(card);
  if (validationError) {
    process.stderr.write(`  \x1b[33m⚠\x1b[0m Schema warning: ${validationError}\n`);
  }

  const timeMs = Date.now() - t0;
  const meta = { timeMs, filesScanned: 0 };

  // Step 7: Format
  const markdown = formatPrComment(card);
  const terminal = formatTerminal(card, meta);

  status(`Done in ${timeMs}ms`);

  return { card, markdown, terminal, meta };
}

// ── CLI ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let diffPath = null;
  let projectRoot = process.cwd();
  let prId = "local";
  let format = "auto"; // auto = terminal if TTY, markdown if piped

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--diff":
        diffPath = args[++i];
        break;
      case "--project":
        projectRoot = resolve(args[++i]);
        break;
      case "--pr":
        prId = args[++i];
        break;
      case "--format":
        format = args[++i];
        break;
      case "--json":
        format = "json";
        break;
      case "--markdown":
        format = "markdown";
        break;
      case "--version":
      case "-v":
        console.log(`changelens v${VERSION}`);
        process.exit(0);
        break;
      case "--help":
      case "-h":
        console.log(`
${bold("ChangeLens")} v${VERSION} — Pre-merge change impact visualizer

${bold("Usage:")}
  git diff main | changelens --project ./repo
  changelens --diff changes.patch --project ./repo

${bold("Options:")}
  --diff <path>      Path to diff file (reads stdin if omitted)
  --project <path>   Project root directory (default: cwd)
  --pr <id>          Pull request identifier
  --format <type>    Output format: terminal | markdown | json | both
  --json             Shorthand for --format json
  --markdown         Shorthand for --format markdown
  --version, -v      Show version
  --help, -h         Show this help

${bold("Examples:")}
  ${dim("# Analyze uncommitted changes")}
  git diff | changelens

  ${dim("# Analyze a feature branch")}
  git diff main...feature | changelens --project ./my-repo

  ${dim("# JSON output for CI integration")}
  git diff main | changelens --json --pr PR-42

${dim("Built by Atlas with Iris · BSL 1.1 · Static analysis · Not a guarantee")}
        `);
        process.exit(0);
    }
  }

  // Read diff
  let diffText;
  if (diffPath) {
    try {
      diffText = readFileSync(resolve(diffPath), "utf-8");
    } catch (err) {
      process.stderr.write(`\x1b[31m✖\x1b[0m Could not read diff file: ${diffPath}\n  ${err.message}\n`);
      process.exit(1);
    }
  } else {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    diffText = Buffer.concat(chunks).toString("utf-8");
  }

  if (!diffText.trim()) {
    process.stderr.write(`\x1b[33m⚠\x1b[0m  No diff input provided.\n\n  ${dim("Usage:")} git diff main | changelens --project ./repo\n  ${dim("Help:")}  changelens --help\n`);
    process.exit(1);
  }

  // Run analysis
  const { card, markdown, terminal } = analyze(diffText, projectRoot, { prId, format });

  // Auto-detect format
  if (format === "auto") {
    format = process.stdout.isTTY ? "terminal" : "markdown";
  }

  // Output
  switch (format) {
    case "json":
      console.log(JSON.stringify(card, null, 2));
      break;
    case "both":
      console.log(JSON.stringify(card, null, 2));
      console.log("\n---\n");
      console.log(markdown);
      break;
    case "terminal":
      console.log(terminal);
      break;
    case "markdown":
    default:
      console.log(markdown);
      break;
  }
}

// Only run CLI if this is the entry point
const isEntry = process.argv[1] && (
  process.argv[1].endsWith("index.js") ||
  process.argv[1].endsWith("changelens")
);
if (isEntry) {
  main().catch(err => {
    process.stderr.write(`\x1b[31m✖\x1b[0m ChangeLens fatal: ${err.message}\n`);
    process.exit(1);
  });
}
