// src/scar/scarLedger.js
// ═══════════════════════════════════════════════════════════════════════
// SCAR LEDGER — Read/write the structural memory ledger
//
// The scar ledger lives at .changelens/scars.json in the project root.
// It tracks file-level incident history: rollbacks, hotfixes, rapid
// follow-up PRs, and any other structural signal that a change to a
// file caused problems.
//
// Deterministic. No LLM. No external deps. Just JSON.
// ═══════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const LEDGER_DIR = ".changelens";
const LEDGER_FILE = "scars.json";
const LEDGER_VERSION = 1;

/**
 * @typedef {Object} FileScar
 * @property {number} total_prs       - Total PRs that touched this file
 * @property {number} incidents       - Total incidents linked to this file
 * @property {number} rollbacks       - Revert/rollback count
 * @property {number} hotfixes        - Hotfix count
 * @property {number} rapid_followups - PRs re-touching same file within 48h
 * @property {string|null} last_incident - ISO date of most recent incident
 * @property {number} scar_score      - incidents / total_prs
 */

/**
 * @typedef {Object} ScarEvent
 * @property {string} type      - "rollback" | "hotfix" | "rapid_followup" | "keyword"
 * @property {string} commit    - The commit SHA that triggered the event
 * @property {string[]} files   - Files involved
 * @property {string} date      - ISO date
 * @property {string} message   - Commit message (first line)
 * @property {string} detected_by - How it was detected
 */

/**
 * @typedef {Object} ScarLedger
 * @property {number} version
 * @property {string} repo
 * @property {Object<string, FileScar>} scars
 * @property {ScarEvent[]} events
 * @property {string} last_scan - ISO date of last scan
 */

/**
 * Create an empty scar ledger.
 * @param {string} repo - Repository identifier
 * @returns {ScarLedger}
 */
export function createEmptyLedger(repo = "unknown") {
  return {
    version: LEDGER_VERSION,
    repo,
    scars: {},
    events: [],
    last_scan: null,
  };
}

/**
 * Create an empty file scar entry.
 * @returns {FileScar}
 */
export function createEmptyFileScar() {
  return {
    total_prs: 0,
    incidents: 0,
    rollbacks: 0,
    hotfixes: 0,
    rapid_followups: 0,
    last_incident: null,
    scar_score: 0.0,
  };
}

/**
 * Load the scar ledger from disk.
 * Returns an empty ledger if the file doesn't exist.
 *
 * @param {string} projectRoot - Path to project root
 * @returns {ScarLedger}
 */
export function loadLedger(projectRoot) {
  const ledgerPath = join(projectRoot, LEDGER_DIR, LEDGER_FILE);

  if (!existsSync(ledgerPath)) {
    return createEmptyLedger();
  }

  try {
    const raw = readFileSync(ledgerPath, "utf-8");
    const parsed = JSON.parse(raw);

    // Version migration (future-proofing)
    if (parsed.version !== LEDGER_VERSION) {
      // For now, just reset if version mismatch
      return createEmptyLedger(parsed.repo);
    }

    return parsed;
  } catch (err) {
    console.error(`⚠ Could not parse scar ledger: ${err.message}`);
    return createEmptyLedger();
  }
}

/**
 * Save the scar ledger to disk.
 *
 * @param {string} projectRoot - Path to project root
 * @param {ScarLedger} ledger - The ledger to save
 */
export function saveLedger(projectRoot, ledger) {
  const dirPath = join(projectRoot, LEDGER_DIR);
  const ledgerPath = join(dirPath, LEDGER_FILE);

  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }

  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), "utf-8");
}

/**
 * Record an event in the ledger and update file scar entries.
 *
 * @param {ScarLedger} ledger - The ledger to update (mutated in place)
 * @param {ScarEvent} event - The event to record
 * @returns {ScarLedger}
 */
export function recordEvent(ledger, event) {
  // Add the event
  ledger.events.push(event);

  // Update file scars
  for (const filePath of event.files) {
    if (!ledger.scars[filePath]) {
      ledger.scars[filePath] = createEmptyFileScar();
    }

    const scar = ledger.scars[filePath];
    scar.incidents++;

    switch (event.type) {
      case "rollback":
        scar.rollbacks++;
        break;
      case "hotfix":
        scar.hotfixes++;
        break;
      case "rapid_followup":
        scar.rapid_followups++;
        break;
    }

    scar.last_incident = event.date;
    // Recalculate score (will be finalized after PR counting)
    if (scar.total_prs > 0) {
      scar.scar_score = parseFloat((scar.incidents / scar.total_prs).toFixed(4));
    }
  }

  return ledger;
}

/**
 * Increment the PR count for files touched by a merge.
 *
 * @param {ScarLedger} ledger
 * @param {string[]} files - Files touched by the merged PR
 * @returns {ScarLedger}
 */
export function recordMerge(ledger, files) {
  for (const filePath of files) {
    if (!ledger.scars[filePath]) {
      ledger.scars[filePath] = createEmptyFileScar();
    }
    ledger.scars[filePath].total_prs++;

    // Recalculate score
    const scar = ledger.scars[filePath];
    if (scar.total_prs > 0) {
      scar.scar_score = parseFloat((scar.incidents / scar.total_prs).toFixed(4));
    }
  }

  return ledger;
}

/**
 * Get the scar entry for a specific file.
 *
 * @param {ScarLedger} ledger
 * @param {string} filePath
 * @returns {FileScar|null}
 */
export function getFileScar(ledger, filePath) {
  // Normalize path separators
  const fwd = filePath.replace(/\\/g, "/");
  return ledger.scars[filePath] || ledger.scars[fwd] || null;
}

/**
 * Get all files with scar scores above a threshold.
 *
 * @param {ScarLedger} ledger
 * @param {number} threshold - Minimum scar score (default: 0.05)
 * @returns {Array<{ filePath: string, scar: FileScar }>}
 */
export function getHotFiles(ledger, threshold = 0.05) {
  return Object.entries(ledger.scars)
    .filter(([_, scar]) => scar.scar_score >= threshold)
    .map(([filePath, scar]) => ({ filePath, scar }))
    .sort((a, b) => b.scar.scar_score - a.scar.scar_score);
}
