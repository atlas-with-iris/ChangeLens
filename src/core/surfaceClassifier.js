// src/core/surfaceClassifier.js
// ═══════════════════════════════════════════════════════════════════════
// SURFACE CLASSIFIER — Categorize changed surfaces by type
//
// Deterministic. No LLM. No external deps.
//
// Input:  FileChange objects from diffParser
// Output: surface classifications with confidence
//
// Categories:
//   API      — route handlers, endpoint definitions, controllers
//   AUTH     — authentication/authorization middleware, guards
//   CONFIG   — environment vars, config files, feature flags
//   SCHEMA   — database models, type definitions, interfaces, migrations
//   UTILITY  — shared helpers, libraries, common modules
//   TEST     — test files, fixtures, mocks
//   STYLE    — CSS, styling, themes
//   BUILD    — CI/CD, Docker, deployment configs
//   DOCS     — documentation, READMEs
// ═══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} SurfaceClassification
 * @property {string} filePath
 * @property {string} category   - API | AUTH | CONFIG | SCHEMA | UTILITY | TEST | STYLE | BUILD | DOCS
 * @property {number} confidence - 0.0–1.0
 * @property {string} reason     - Why this classification was chosen
 */

// ── CLASSIFICATION RULES ──────────────────────────────────────────────
// Ordered by specificity (most specific first). First match wins.

const CLASSIFICATION_RULES = [
  // ── TEST ────────────────────────────────────────────────────────────
  {
    category: "TEST",
    pathPatterns: [
      /\btest[s]?\b/i,
      /\bspec[s]?\b/i,
      /\b__tests__\b/,
      /\b__mocks__\b/,
      /\.test\.[jt]sx?$/,
      /\.spec\.[jt]sx?$/,
      /\.e2e\.[jt]sx?$/,
      /\bfixtures?\b/i,
    ],
    contentPatterns: [],
    confidence: 0.95,
  },

  // ── STYLE ───────────────────────────────────────────────────────────
  {
    category: "STYLE",
    pathPatterns: [
      /\.css$/,
      /\.scss$/,
      /\.sass$/,
      /\.less$/,
      /\.styled\.[jt]sx?$/,
      /\bstyles?\b.*\.[jt]sx?$/,
      /\bthemes?\b.*\.[jt]sx?$/,
    ],
    contentPatterns: [],
    confidence: 0.95,
  },

  // ── BUILD / CI/CD ───────────────────────────────────────────────────
  {
    category: "BUILD",
    pathPatterns: [
      /Dockerfile/i,
      /docker-compose/i,
      /\.github\//,
      /\.gitlab-ci/,
      /Jenkinsfile/,
      /\.circleci\//,
      /webpack\./,
      /vite\.config/,
      /rollup\.config/,
      /tsconfig/,
      /jest\.config/,
      /vitest\.config/,
      /\.eslint/,
      /\.prettier/,
      /babel\.config/,
      /next\.config/,
    ],
    contentPatterns: [],
    confidence: 0.90,
  },

  // ── DOCS ────────────────────────────────────────────────────────────
  {
    category: "DOCS",
    pathPatterns: [
      /README/i,
      /CHANGELOG/i,
      /LICENSE/i,
      /CONTRIBUTING/i,
      /\.md$/,
      /\.mdx$/,
      /\bdocs?\b\//i,
    ],
    contentPatterns: [],
    confidence: 0.90,
  },

  // ── CONFIG ──────────────────────────────────────────────────────────
  {
    category: "CONFIG",
    pathPatterns: [
      /\.env/,
      /config\.[jt]sx?$/,
      /config\//,
      /\.config\.[jt]sx?$/,
      /constants?\.[jt]sx?$/,
      /settings?\.[jt]sx?$/,
      /\.json$/,  // package.json, tsconfig.json, etc (if not already matched)
      /\.ya?ml$/,
      /\.toml$/,
    ],
    contentPatterns: [
      /process\.env\./,
      /(?:DB_|API_|SECRET_|PORT|HOST|URL)/,
      /feature[_-]?flag/i,
    ],
    confidence: 0.85,
  },

  // ── AUTH ─────────────────────────────────────────────────────────────
  {
    category: "AUTH",
    pathPatterns: [
      /\bauth\b/i,
      /\blogin\b/i,
      /\bsession\b/i,
      /\bpermission/i,
      /\bguard/i,
      /\bmiddleware.*auth/i,
      /\baccess[_-]?control/i,
      /\brbac\b/i,
      /\bjwt\b/i,
      /\boauth\b/i,
      /\bpassport\b/i,
    ],
    contentPatterns: [
      /jwt\./,
      /bearer/i,
      /authenticate/i,
      /authorize/i,
      /authorization/i,
      /req\.headers/,
      /req\.user/,
      /session\./,
      /passport\./,
      /bcrypt/,
      /verify[Tt]oken/,
    ],
    confidence: 0.90,
  },

  // ── SCHEMA / MODELS ─────────────────────────────────────────────────
  {
    category: "SCHEMA",
    pathPatterns: [
      /\bmodels?\b/i,
      /\bschemas?\b/i,
      /\bentit(?:y|ies)\b/i,
      /\bmigrations?\b/i,
      /\btypes?\.[td]/i,
      /\.d\.ts$/,
      /\binterfaces?\b/i,
      /\bprisma\b/i,
      /\bsequelize\b/i,
      /\btypeorm\b/i,
    ],
    contentPatterns: [
      /mongoose\.Schema/,
      /sequelize\.define/,
      /@Entity/,
      /@Column/,
      /interface\s+\w+/,
      /type\s+\w+\s*=/,
      /CREATE\s+TABLE/i,
    ],
    confidence: 0.85,
  },

  // ── API ─────────────────────────────────────────────────────────────
  {
    category: "API",
    pathPatterns: [
      /\broutes?\b/i,
      /\bcontrollers?\b/i,
      /\bendpoints?\b/i,
      /\bhandlers?\b/i,
      /\bapi\b/i,
      /\bresolvers?\b/i,
      /\bserver\b.*\.[jt]sx?$/i,
    ],
    contentPatterns: [
      /app\.(get|post|put|patch|delete|use)\s*\(/,
      /router\.(get|post|put|patch|delete|use)\s*\(/,
      /express\(\)/,
      /\.route\s*\(/,
      /fastify\./,
      /koa\./,
      /hono\./,
      /@(Get|Post|Put|Patch|Delete)\(/,
      /createRouter/,
    ],
    confidence: 0.85,
  },

  // ── UTILITY (default) ───────────────────────────────────────────────
  {
    category: "UTILITY",
    pathPatterns: [
      /\butils?\b/i,
      /\bhelpers?\b/i,
      /\blib\b/i,
      /\bcommon\b/i,
      /\bshared\b/i,
      /\bcore\b/i,
    ],
    contentPatterns: [],
    confidence: 0.70,
  },
];

// ── CLASSIFIER ────────────────────────────────────────────────────────

/**
 * Classify a single file change into a surface category.
 *
 * @param {import('./diffParser.js').FileChange} fileChange
 * @returns {SurfaceClassification}
 */
export function classifySurface(fileChange) {
  const path = fileChange.filePath.toLowerCase();

  // Collect all content from hunks for content-based matching
  const allContent = fileChange.hunks
    .flatMap(h => [...h.addedLines, ...h.removedLines])
    .join("\n");

  // Pass 1: Path-based classification (highest confidence)
  for (const rule of CLASSIFICATION_RULES) {
    const pathMatch = rule.pathPatterns.some(pattern => pattern.test(path));
    if (pathMatch) {
      return {
        filePath: fileChange.filePath,
        category: rule.category,
        confidence: rule.confidence,
        reason: `Path matches ${rule.category} pattern`,
      };
    }
  }

  // Pass 2: Content-based classification (fallback for files with no path match)
  if (allContent) {
    for (const rule of CLASSIFICATION_RULES) {
      if (rule.contentPatterns.length > 0) {
        const contentMatch = rule.contentPatterns.some(pattern => pattern.test(allContent));
        if (contentMatch) {
          return {
            filePath: fileChange.filePath,
            category: rule.category,
            confidence: rule.confidence * 0.9, // Slightly lower confidence for content-only match
            reason: `Content matches ${rule.category} pattern`,
          };
        }
      }
    }
  }

  // Default: UTILITY with low confidence
  return {
    filePath: fileChange.filePath,
    category: "UTILITY",
    confidence: 0.5,
    reason: "No specific pattern matched — defaulting to UTILITY",
  };
}

/**
 * Classify all file changes in a diff.
 *
 * @param {import('./diffParser.js').FileChange[]} files
 * @returns {SurfaceClassification[]}
 */
export function classifyAllSurfaces(files) {
  return files.map(classifySurface);
}

/**
 * Get the highest-risk category from a set of classifications.
 * Risk ordering: AUTH > SCHEMA > API > CONFIG > UTILITY > BUILD > DOCS > TEST > STYLE
 *
 * @param {SurfaceClassification[]} classifications
 * @returns {string}
 */
const RISK_ORDER = ["AUTH", "SCHEMA", "API", "CONFIG", "UTILITY", "BUILD", "DOCS", "TEST", "STYLE"];

export function highestRiskCategory(classifications) {
  let highest = "STYLE";
  let highestIdx = RISK_ORDER.length - 1;

  for (const c of classifications) {
    const idx = RISK_ORDER.indexOf(c.category);
    if (idx !== -1 && idx < highestIdx) {
      highest = c.category;
      highestIdx = idx;
    }
  }

  return highest;
}
