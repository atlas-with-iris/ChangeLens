// src/core/diffParser.js
// ═══════════════════════════════════════════════════════════════════════
// DIFF PARSER — Ingest unified diff → structured change objects
//
// Deterministic. No LLM. No external deps.
//
// Input:  unified diff string (git diff output)
// Output: array of FileChange objects with symbol-level extraction
//
// Handles:
//   - Added, modified, deleted, renamed files
//   - Symbol extraction: function/class/const/export declarations
//   - Hunk-level granularity for precise impact mapping
// ═══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} HunkChange
 * @property {number} oldStart
 * @property {number} oldCount
 * @property {number} newStart
 * @property {number} newCount
 * @property {string[]} addedLines
 * @property {string[]} removedLines
 * @property {string[]} contextLines
 */

/**
 * @typedef {Object} SymbolChange
 * @property {string} name         - Symbol name (function, class, variable)
 * @property {string} kind         - "function" | "class" | "const" | "let" | "var" | "type" | "interface" | "enum" | "export"
 * @property {"added"|"removed"|"modified"} change
 * @property {number} line         - Line number in the new file (or old file if removed)
 */

/**
 * @typedef {Object} FileChange
 * @property {string} filePath     - Path to the file
 * @property {string} oldPath      - Original path (differs from filePath on rename)
 * @property {"added"|"modified"|"deleted"|"renamed"} status
 * @property {HunkChange[]} hunks
 * @property {SymbolChange[]} symbols
 * @property {number} additions    - Total lines added
 * @property {number} deletions    - Total lines removed
 */

// ── SYMBOL EXTRACTION PATTERNS ────────────────────────────────────────
// Deterministic regex-based extraction. Covers JS/TS declarations.

const SYMBOL_PATTERNS = [
  // Named function declarations: function foo(
  { regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,           kind: "function" },
  // Arrow / const functions: const foo = (...) => | const foo = function
  { regex: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/,  kind: "function" },
  // Class declarations: class Foo
  { regex: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,           kind: "class" },
  // Interface declarations (TS): interface Foo
  { regex: /^\s*(?:export\s+)?interface\s+(\w+)/,                       kind: "interface" },
  // Type alias (TS): type Foo =
  { regex: /^\s*(?:export\s+)?type\s+(\w+)\s*=/,                       kind: "type" },
  // Enum (TS): enum Foo
  { regex: /^\s*(?:export\s+)?(?:const\s+)?enum\s+(\w+)/,              kind: "enum" },
  // Const/let/var declarations (non-function): const FOO =
  { regex: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/,          kind: "const" },
  // Named exports: export { foo, bar }
  { regex: /^\s*export\s+\{\s*([^}]+)\}/,                               kind: "export" },
  // Default export: export default
  { regex: /^\s*export\s+default\s+(?:class|function)?\s*(\w+)?/,       kind: "export" },
  // Module.exports: module.exports = { ... } or module.exports.foo =
  { regex: /^\s*module\.exports(?:\.(\w+))?\s*=/,                       kind: "export" },
];

/**
 * Extract symbol declarations from a set of diff lines.
 * @param {string[]} lines - Added or removed lines from a hunk
 * @param {"added"|"removed"} changeType
 * @param {number} startLine - Starting line number for these lines
 * @returns {SymbolChange[]}
 */
function extractSymbols(lines, changeType, startLine) {
  const symbols = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of SYMBOL_PATTERNS) {
      const match = line.match(pattern.regex);
      if (match) {
        // For "export { foo, bar }" — extract each name
        if (pattern.kind === "export" && match[1] && match[1].includes(",")) {
          const names = match[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
          for (const name of names) {
            symbols.push({
              name,
              kind: "export",
              change: changeType,
              line: startLine + i,
            });
          }
        } else {
          const name = match[1] || "default";
          symbols.push({
            name,
            kind: pattern.kind,
            change: changeType,
            line: startLine + i,
          });
        }
        break; // First pattern match wins per line
      }
    }
  }
  return symbols;
}

/**
 * Merge added/removed symbol lists into a unified symbol change list.
 * If the same symbol name appears in both added and removed → "modified".
 * @param {SymbolChange[]} addedSymbols
 * @param {SymbolChange[]} removedSymbols
 * @returns {SymbolChange[]}
 */
function mergeSymbols(addedSymbols, removedSymbols) {
  const merged = [];
  const addedNames = new Map(addedSymbols.map(s => [s.name, s]));
  const removedNames = new Map(removedSymbols.map(s => [s.name, s]));

  // Modified: in both added and removed
  for (const [name, added] of addedNames) {
    if (removedNames.has(name)) {
      merged.push({ ...added, change: "modified" });
      removedNames.delete(name);
      addedNames.delete(name);
    }
  }

  // Pure additions
  for (const [, sym] of addedNames) {
    merged.push(sym);
  }

  // Pure removals
  for (const [, sym] of removedNames) {
    merged.push(sym);
  }

  return merged;
}

// ── HUNK PARSER ───────────────────────────────────────────────────────

/**
 * Parse a unified diff hunk header: @@ -old,count +new,count @@
 * @param {string} line
 * @returns {{oldStart: number, oldCount: number, newStart: number, newCount: number} | null}
 */
function parseHunkHeader(line) {
  const match = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!match) return null;
  return {
    oldStart: parseInt(match[1], 10),
    oldCount: match[2] !== undefined ? parseInt(match[2], 10) : 1,
    newStart: parseInt(match[3], 10),
    newCount: match[4] !== undefined ? parseInt(match[4], 10) : 1,
  };
}

// ── FILE HEADER PARSER ────────────────────────────────────────────────

/**
 * Parse the diff header to extract file paths and status.
 * Handles: standard diff, rename, new file, deleted file.
 * @param {string[]} headerLines
 * @returns {{ filePath: string, oldPath: string, status: string }}
 */
function parseFileHeader(headerLines) {
  let filePath = "";
  let oldPath = "";
  let status = "modified";

  for (const line of headerLines) {
    // Rename detection: rename from / rename to
    if (line.startsWith("rename from ")) {
      oldPath = line.slice("rename from ".length).trim();
    } else if (line.startsWith("rename to ")) {
      filePath = line.slice("rename to ".length).trim();
      status = "renamed";
    }
    // New file
    else if (line.startsWith("new file mode")) {
      status = "added";
    }
    // Deleted file
    else if (line.startsWith("deleted file mode")) {
      status = "deleted";
    }
    // Standard a/b paths
    else if (line.startsWith("--- a/")) {
      oldPath = oldPath || line.slice("--- a/".length).trim();
    } else if (line.startsWith("+++ b/")) {
      filePath = filePath || line.slice("+++ b/".length).trim();
    }
    // /dev/null cases
    else if (line === "--- /dev/null") {
      status = status === "modified" ? "added" : status;
    } else if (line === "+++ /dev/null") {
      status = "deleted";
    }
  }

  // Fallback: extract from diff --git line
  if (!filePath && headerLines[0]) {
    const gitMatch = headerLines[0].match(/^diff --git a\/(.+?) b\/(.+)/);
    if (gitMatch) {
      oldPath = oldPath || gitMatch[1];
      filePath = filePath || gitMatch[2];
    }
  }

  return { filePath, oldPath: oldPath || filePath, status };
}

// ── MAIN PARSER ───────────────────────────────────────────────────────

/**
 * Parse a unified diff string into structured FileChange objects.
 *
 * @param {string} diffText - Full unified diff output (e.g., from `git diff`)
 * @returns {FileChange[]}
 */
export function parseDiff(diffText) {
  if (!diffText || typeof diffText !== "string") return [];

  const lines = diffText.split("\n");
  const files = [];
  let currentFile = null;
  let headerLines = [];
  let currentHunk = null;
  let lineInNew = 0;
  let lineInOld = 0;

  // Finalize any pending header lines into a FileChange (handles pure renames with no hunks)
  function finalizeHeader() {
    if (headerLines.length > 0 && !currentFile) {
      const { filePath, oldPath, status } = parseFileHeader(headerLines);
      if (filePath) {
        currentFile = {
          filePath,
          oldPath,
          status,
          hunks: [],
          symbols: [],
          additions: 0,
          deletions: 0,
        };
      }
      headerLines = [];
    }
  }

  function finalizeFile() {
    finalizeHeader(); // Ensure header-only diffs (pure renames) are captured
    if (!currentFile) return;
    if (currentHunk) {
      currentFile.hunks.push(currentHunk);
    }
    // Extract and merge symbols from all hunks
    const allAdded = [];
    const allRemoved = [];
    for (const hunk of currentFile.hunks) {
      allAdded.push(...extractSymbols(hunk.addedLines, "added", hunk.newStart));
      allRemoved.push(...extractSymbols(hunk.removedLines, "removed", hunk.oldStart));
    }
    currentFile.symbols = mergeSymbols(allAdded, allRemoved);
    files.push(currentFile);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file block starts with "diff --git"
    if (line.startsWith("diff --git ")) {
      finalizeFile();
      headerLines = [line];
      currentHunk = null;
      currentFile = null;
      continue;
    }

    // Accumulate header lines until we hit a hunk
    if (!currentFile && headerLines.length > 0 && !line.startsWith("@@")) {
      headerLines.push(line);
      continue;
    }

    // Hunk header
    if (line.startsWith("@@")) {
      // If this is the first hunk, parse the file header
      if (!currentFile) {
        const { filePath, oldPath, status } = parseFileHeader(headerLines);
        currentFile = {
          filePath,
          oldPath,
          status,
          hunks: [],
          symbols: [],
          additions: 0,
          deletions: 0,
        };
        headerLines = [];
      }

      // Finalize previous hunk
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }

      const hunkHeader = parseHunkHeader(line);
      if (hunkHeader) {
        lineInNew = hunkHeader.newStart;
        lineInOld = hunkHeader.oldStart;
        currentHunk = {
          ...hunkHeader,
          addedLines: [],
          removedLines: [],
          contextLines: [],
        };
      }
      continue;
    }

    // Hunk content
    if (currentHunk) {
      if (line.startsWith("+")) {
        const content = line.slice(1);
        currentHunk.addedLines.push(content);
        currentFile.additions++;
        lineInNew++;
      } else if (line.startsWith("-")) {
        const content = line.slice(1);
        currentHunk.removedLines.push(content);
        currentFile.deletions++;
        lineInOld++;
      } else if (line.startsWith(" ") || line === "") {
        currentHunk.contextLines.push(line.startsWith(" ") ? line.slice(1) : line);
        lineInNew++;
        lineInOld++;
      }
      // Skip "\ No newline at end of file"
    }
  }

  finalizeFile();
  return files;
}

/**
 * Quick summary of a parsed diff.
 * @param {FileChange[]} files
 * @returns {{ totalFiles: number, totalAdditions: number, totalDeletions: number, symbolsChanged: number }}
 */
export function diffSummary(files) {
  return {
    totalFiles: files.length,
    totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
    totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
    symbolsChanged: files.reduce((sum, f) => sum + f.symbols.length, 0),
  };
}
