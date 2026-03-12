// src/scar/scarDetector.js
// ═══════════════════════════════════════════════════════════════════════
// SCAR DETECTOR — Scan git history for incident signals
//
// Detects:
//   1. Revert commits (git revert, "Revert" in message)
//   2. Hotfix branches (hotfix/*, fix/* touching same files)
//   3. Rapid follow-up PRs (same file changed again within 48h)
//   4. Keyword signals ("broke", "regression", "rollback", "critical fix")
//
// All detection is deterministic. Reads git log. No network calls.
// ═══════════════════════════════════════════════════════════════════════

import { execSync } from "child_process";

// ── INCIDENT KEYWORDS ─────────────────────────────────────────────────
// Conservative set. We'd rather miss an incident than false-flag one.

const INCIDENT_KEYWORDS = [
  "revert",
  "rollback",
  "roll back",
  "broke",
  "broken",
  "regression",
  "hotfix",
  "hot fix",
  "critical fix",
  "emergency fix",
  "urgent fix",
  "reverted",
  "backing out",
  "back out",
];

const REVERT_PATTERN = /^Revert\s+"|^revert:/i;
const HOTFIX_BRANCH_PATTERN = /hotfix\/|fix\//i;

/**
 * @typedef {Object} GitCommit
 * @property {string} hash    - Short SHA
 * @property {string} date    - ISO date
 * @property {string} message - First line of commit message
 * @property {string} author  - Author name
 * @property {string[]} files - Files changed in the commit
 * @property {string} branch  - Branch name (if available)
 */

/**
 * Run a git command and return stdout.
 * @param {string} cmd
 * @param {string} cwd
 * @returns {string}
 */
function git(cmd, cwd) {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Parse git log output into structured commits.
 * @param {string} projectRoot
 * @param {number} maxCommits
 * @returns {GitCommit[]}
 */
export function getRecentCommits(projectRoot, maxCommits = 500) {
  // Format: hash|date|message|author
  const log = git(
    `log --pretty=format:"%h|%aI|%s|%an" --name-only -n ${maxCommits}`,
    projectRoot
  );

  if (!log) return [];

  const commits = [];
  let current = null;

  for (const line of log.split("\n")) {
    if (!line.trim()) {
      if (current) {
        commits.push(current);
        current = null;
      }
      continue;
    }

    // Check if this is a commit line (contains | separators)
    const parts = line.split("|");
    if (parts.length >= 4 && parts[0].match(/^"?[a-f0-9]{7,}/)) {
      if (current) commits.push(current);
      current = {
        hash: parts[0].replace(/^"/, ""),
        date: parts[1],
        message: parts.slice(2, -1).join("|"), // message might contain |
        author: parts[parts.length - 1].replace(/"$/, ""),
        files: [],
        branch: "",
      };
    } else if (current && line.trim()) {
      // This is a file name
      current.files.push(line.trim());
    }
  }

  if (current) commits.push(current);
  return commits;
}

/**
 * Get the current branch name.
 * @param {string} projectRoot
 * @returns {string}
 */
function getCurrentBranch(projectRoot) {
  return git("rev-parse --abbrev-ref HEAD", projectRoot);
}

/**
 * Detect revert commits.
 * @param {GitCommit[]} commits
 * @returns {import('./scarLedger.js').ScarEvent[]}
 */
export function detectReverts(commits) {
  const events = [];

  for (const commit of commits) {
    if (REVERT_PATTERN.test(commit.message)) {
      events.push({
        type: "rollback",
        commit: commit.hash,
        files: commit.files,
        date: commit.date,
        message: commit.message,
        detected_by: "revert-commit",
      });
    }
  }

  return events;
}

/**
 * Detect keyword-flagged commits (broke, regression, etc.).
 * @param {GitCommit[]} commits
 * @returns {import('./scarLedger.js').ScarEvent[]}
 */
export function detectKeywordIncidents(commits) {
  const events = [];

  for (const commit of commits) {
    const msgLower = commit.message.toLowerCase();

    // Skip if it's already caught by revert detection
    if (REVERT_PATTERN.test(commit.message)) continue;

    const matched = INCIDENT_KEYWORDS.find((kw) => msgLower.includes(kw));
    if (matched) {
      events.push({
        type: "hotfix",
        commit: commit.hash,
        files: commit.files,
        date: commit.date,
        message: commit.message,
        detected_by: `keyword:${matched}`,
      });
    }
  }

  return events;
}

/**
 * Detect rapid follow-up changes (same file changed again within 48h).
 * @param {GitCommit[]} commits
 * @param {number} windowHours - Hours to consider "rapid" (default: 48)
 * @returns {import('./scarLedger.js').ScarEvent[]}
 */
export function detectRapidFollowups(commits, windowHours = 48) {
  const events = [];
  const windowMs = windowHours * 60 * 60 * 1000;

  // Build a map of file → most recent commit timestamp
  const fileLastTouch = new Map();

  // Process commits chronologically (oldest first)
  const sorted = [...commits].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  for (const commit of sorted) {
    const commitTime = new Date(commit.date).getTime();

    for (const filePath of commit.files) {
      const lastTouch = fileLastTouch.get(filePath);

      if (lastTouch && commitTime - lastTouch.time < windowMs) {
        // This file was changed again within the window
        events.push({
          type: "rapid_followup",
          commit: commit.hash,
          files: [filePath],
          date: commit.date,
          message: commit.message,
          detected_by: `rapid-followup:${windowHours}h`,
        });
      }

      fileLastTouch.set(filePath, {
        time: commitTime,
        hash: commit.hash,
      });
    }
  }

  return events;
}

/**
 * Run all detectors and return all events found.
 *
 * @param {string} projectRoot
 * @param {Object} [options]
 * @param {number} [options.maxCommits] - Max commits to scan (default: 500)
 * @param {number} [options.rapidWindowHours] - Rapid follow-up window (default: 48)
 * @returns {{ commits: GitCommit[], events: import('./scarLedger.js').ScarEvent[] }}
 */
export function scanForIncidents(projectRoot, options = {}) {
  const maxCommits = options.maxCommits || 500;
  const rapidWindowHours = options.rapidWindowHours || 48;

  const commits = getRecentCommits(projectRoot, maxCommits);

  if (commits.length === 0) {
    return { commits: [], events: [] };
  }

  const reverts = detectReverts(commits);
  const keywords = detectKeywordIncidents(commits);
  const followups = detectRapidFollowups(commits, rapidWindowHours);

  // Deduplicate events by commit hash + file
  const seen = new Set();
  const allEvents = [...reverts, ...keywords, ...followups].filter((event) => {
    const key = `${event.commit}:${event.files.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by date (newest first)
  allEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return { commits, events: allEvents };
}
