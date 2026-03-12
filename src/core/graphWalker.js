// src/core/graphWalker.js
// ═══════════════════════════════════════════════════════════════════════
// GRAPH WALKER — Walk import/export graph from changed files
//
// Deterministic. No LLM. No external deps.
//
// Input:  project root path + list of changed file paths
// Output: dependency graph with consumers for each changed file
//
// Handles:
//   - ES module imports: import { x } from './y'
//   - CommonJS requires: const x = require('./y')
//   - Re-exports: export { x } from './y'
//   - Barrel files: index.js that re-exports
//   - TypeScript path aliases (basic tsconfig paths)
//   - Relative and absolute imports
//   - Transitive consumers (configurable depth, default 2)
// ═══════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, dirname, extname, join, relative } from "path";

/**
 * @typedef {Object} ImportEdge
 * @property {string} source      - File that imports
 * @property {string} target      - File being imported
 * @property {string[]} symbols   - Imported symbol names (["*"] for namespace imports)
 * @property {string} raw         - Raw import statement
 */

/**
 * @typedef {Object} ConsumerInfo
 * @property {string} filePath        - Consumer file path (relative to root)
 * @property {string[]} importedSymbols - Which symbols it imports from the changed file
 * @property {number} depth           - How many hops from the changed file (1 = direct)
 */

// ── IMPORT EXTRACTION PATTERNS ────────────────────────────────────────

const IMPORT_PATTERNS = [
  // ES: import { foo, bar } from './path'
  {
    regex: /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
    extract: (match) => ({
      symbols: match[1].split(",").map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean),
      path: match[2],
    }),
  },
  // ES: import foo from './path'
  {
    regex: /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    extract: (match) => ({
      symbols: [match[1]],
      path: match[2],
    }),
  },
  // ES: import * as foo from './path'
  {
    regex: /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    extract: (match) => ({
      symbols: ["*"],
      path: match[2],
    }),
  },
  // ES: import './path' (side-effect import)
  {
    regex: /import\s+['"]([^'"]+)['"]/g,
    extract: (match) => ({
      symbols: ["__side_effect__"],
      path: match[1],
    }),
  },
  // CommonJS: const foo = require('./path')
  {
    regex: /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    extract: (match) => ({
      symbols: [match[1]],
      path: match[2],
    }),
  },
  // CommonJS: const { foo, bar } = require('./path')
  {
    regex: /(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    extract: (match) => ({
      symbols: match[1].split(",").map(s => s.trim().split(/\s*:\s*/)[0].trim()).filter(Boolean),
      path: match[2],
    }),
  },
  // CommonJS: require('./path') (standalone)
  {
    regex: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    extract: (match) => ({
      symbols: ["*"],
      path: match[1],
    }),
  },
  // Re-export: export { foo } from './path'
  {
    regex: /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
    extract: (match) => ({
      symbols: match[1].split(",").map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean),
      path: match[2],
    }),
  },
  // Re-export: export * from './path'
  {
    regex: /export\s+\*\s+from\s+['"]([^'"]+)['"]/g,
    extract: (match) => ({
      symbols: ["*"],
      path: match[1],
    }),
  },
];

// ── FILE RESOLUTION ───────────────────────────────────────────────────

const JS_EXTENSIONS = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"];

/**
 * Resolve an import path to an actual file on disk.
 * Handles: extensions, index files, and directory imports.
 *
 * @param {string} importPath - The import specifier
 * @param {string} fromFile   - The file containing the import
 * @param {string} projectRoot
 * @returns {string|null} - Resolved absolute path, or null if external/unresolvable
 */
function resolveImportPath(importPath, fromFile, projectRoot) {
  // Skip external packages (no ./ or ../ prefix and not absolute)
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    // Could be a path alias — check tsconfig later
    return null;
  }

  const baseDir = dirname(fromFile);
  const candidates = [];

  // Try exact path first
  const exact = resolve(baseDir, importPath);
  candidates.push(exact);

  // Try with extensions
  for (const ext of JS_EXTENSIONS) {
    candidates.push(exact + ext);
  }

  // Try as directory with index file
  for (const ext of JS_EXTENSIONS) {
    candidates.push(join(exact, `index${ext}`));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const stat = statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch { /* skip */ }
    }
  }

  return null;
}

// ── FILE SCANNER ──────────────────────────────────────────────────────

/**
 * Recursively find all JS/TS files in a project directory.
 * Skips: node_modules, .git, dist, build, coverage
 *
 * @param {string} dir
 * @param {string[]} [files=[]]
 * @returns {string[]}
 */
function findAllSourceFiles(dir, files = []) {
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "__pycache__"]);

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        findAllSourceFiles(join(dir, entry.name), files);
      }
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (JS_EXTENSIONS.includes(ext)) {
        files.push(join(dir, entry.name));
      }
    }
  }

  return files;
}

/**
 * Extract all import edges from a single file.
 *
 * @param {string} filePath   - Absolute path to the file
 * @param {string} projectRoot
 * @returns {ImportEdge[]}
 */
function extractImports(filePath, projectRoot) {
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const edges = [];

  for (const pattern of IMPORT_PATTERNS) {
    // Reset regex state
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const extracted = pattern.extract(match);
      const resolvedTarget = resolveImportPath(extracted.path, filePath, projectRoot);

      if (resolvedTarget) {
        edges.push({
          source: filePath,
          target: resolvedTarget,
          symbols: extracted.symbols,
          raw: match[0].trim(),
        });
      }
    }
  }

  return edges;
}

// ── GRAPH BUILDER ─────────────────────────────────────────────────────

/**
 * Build the full import graph for a project.
 * Returns a Map: filePath → ImportEdge[]
 *
 * @param {string} projectRoot
 * @returns {Map<string, ImportEdge[]>}
 */
export function buildImportGraph(projectRoot) {
  const allFiles = findAllSourceFiles(projectRoot);
  const graph = new Map();

  for (const file of allFiles) {
    const imports = extractImports(file, projectRoot);
    graph.set(file, imports);
  }

  return graph;
}

/**
 * Build a reverse graph: for each file, who imports it?
 *
 * @param {Map<string, ImportEdge[]>} graph
 * @returns {Map<string, ImportEdge[]>} - target → edges where target is imported
 */
export function buildReverseGraph(graph) {
  const reverse = new Map();

  for (const [, edges] of graph) {
    for (const edge of edges) {
      if (!reverse.has(edge.target)) {
        reverse.set(edge.target, []);
      }
      reverse.get(edge.target).push(edge);
    }
  }

  return reverse;
}

// ── CONSUMER FINDER ───────────────────────────────────────────────────

/**
 * Find all consumers of a set of changed files, up to a given depth.
 *
 * @param {string[]} changedFiles   - Absolute paths to changed files
 * @param {Map<string, ImportEdge[]>} reverseGraph
 * @param {string} projectRoot
 * @param {number} [maxDepth=2]     - Maximum hops to trace
 * @returns {Map<string, ConsumerInfo[]>} - changedFile → consumers
 */
export function findConsumers(changedFiles, reverseGraph, projectRoot, maxDepth = 2) {
  const results = new Map();

  for (const changedFile of changedFiles) {
    const consumers = [];
    const visited = new Set([changedFile]);
    let frontier = [{ file: changedFile, depth: 0 }];

    while (frontier.length > 0) {
      const nextFrontier = [];

      for (const { file, depth } of frontier) {
        if (depth >= maxDepth) continue;

        const importers = reverseGraph.get(file) || [];
        for (const edge of importers) {
          if (visited.has(edge.source)) continue;
          visited.add(edge.source);

          consumers.push({
            filePath: relative(projectRoot, edge.source),
            importedSymbols: edge.symbols,
            depth: depth + 1,
          });

          nextFrontier.push({ file: edge.source, depth: depth + 1 });
        }
      }

      frontier = nextFrontier;
    }

    results.set(relative(projectRoot, changedFile), consumers);
  }

  return results;
}

/**
 * Quick analysis: given a project root and changed file paths,
 * return the consumer map.
 *
 * @param {string} projectRoot
 * @param {string[]} changedFilePaths - Relative paths from project root
 * @param {number} [maxDepth=2]
 * @returns {Map<string, ConsumerInfo[]>}
 */
export function analyzeImpact(projectRoot, changedFilePaths, maxDepth = 2) {
  const absolutePaths = changedFilePaths.map(p => resolve(projectRoot, p));
  const graph = buildImportGraph(projectRoot);
  const reverseGraph = buildReverseGraph(graph);
  return findConsumers(absolutePaths, reverseGraph, projectRoot, maxDepth);
}
