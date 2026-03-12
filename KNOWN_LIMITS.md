# ChangeLens v1 — Known Limits

> These are honest limits of the current engine.
> They are part of the product, not bugs to hide.

## BFS Depth Limits

**Default max depth: 2 hops.**

- Direct consumers (depth 1) are always found.
- Transitive consumers (depth 2) are found.
- Beyond depth 2, consumers are not traced.
- **Impact:** In deeply layered architectures (e.g., service → adapter → repository), the bottom layer may not be traced.
- **Mitigation:** `maxDepth` is configurable in the API. CLI flag coming in v2.

## Barrel-Heavy Repos

- Barrel files (`index.js` that re-exports everything) correctly propagate through the graph.
- **But:** In repos with deeply nested barrels (barrel re-exporting another barrel), consumer counts may overcount if both barrels and the leaf are listed separately.
- **Impact:** Consumer *count* may be inflated, but all listed consumers are real import edges.
- **Mitigation:** Deduplication by file path prevents listing the same consumer twice.

## Style-Only Heuristics

- CSS, SCSS, SASS, LESS files are classified as STYLE (lowest risk).
- **But:** CSS Modules and CSS-in-JS styled-components files that export class name maps will be classified as STYLE even though they have import consumers.
- **Impact:** Risk may be understated for CSS Modules in large apps.
- **Mitigation:** Future version could detect `.module.css` and `*.styled.ts` patterns as UTILITY instead.

## Deleted / Binary / Generated Files

- **Deleted files** are correctly parsed and classified.
- **Binary files** (images, fonts, compiled assets) are ignored by the parser. No hunk data to extract.
- **Generated files** (e.g., `*.generated.ts`, `*.d.ts`, lockfiles) are treated as any other file. They are not filtered out.
- **Impact:** A PR that modifies `package-lock.json` will trigger CONFIG classification, which may inflate risk for routine dependency updates.
- **Mitigation:** Future version could have an ignore list for known generated files.

## Import Resolution

- **Supported:** relative imports (`./`, `../`), CommonJS `require()`, ES module `import/export`, re-exports
- **Not supported:** TypeScript path aliases (`@/components/...`), webpack aliases, dynamic `import()`, `require.resolve()`, monorepo workspace references
- **Impact:** In projects using path aliases without tsconfig.json paths resolution, some consumers may be missed.
- **Mitigation:** Future version will parse `tsconfig.json` paths.

## Symbol Extraction

- Extracts: function declarations, class declarations, const/let/var assignments, interface/type/enum (TS), named exports, default exports, module.exports
- **Not extracted:** object property changes inside an export, parameter type changes in TypeScript, JSDoc changes
- **Impact:** A change to a function's parameter types (in TS) that doesn't change the function declaration line will not be detected as a symbol change.

## Language Scope

- **v1: JavaScript and TypeScript only.**
- Other languages (Python, Go, Rust, etc.) are not supported.
- Files with non-JS/TS extensions are ignored by the graph walker.

## Comment-Only Changes

- When a diff only modifies **comments** in a file with downstream consumers, the engine still reports consumer count and may rate MEDIUM.
- The engine does not distinguish between comment-line changes and code-line changes.
- **Impact:** Comment-only cleanups across popular utility files may rate MEDIUM instead of LOW.
- **This is a known false positive.** Documented from live demo #5 (3-file comment cleanup → 16 consumers → MEDIUM).
- **Mitigation:** Future version could detect diffs that contain only comment/whitespace changes and reduce risk weight.

## Confidence Framing

Per Iris directive, all output uses **earned confidence language:**
- "detected" not "found"
- "identified" not "confirmed"  
- "impact estimate" not "impact analysis"
- Footer: "Not a guarantee"

The engine knows what it can see (import graph + surface heuristics).
It does not claim to see what it cannot.
