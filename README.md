# 🔍 ChangeLens

**Know what your PR will break — before you merge it.**

> Not just files changed — behaviors, APIs, config surfaces, dependencies, and downstream consumers.

```
git diff main | npx changelens
```

---

## What You Get

An **Impact Card** — a clear, evidence-backed risk assessment:

```
  ═══════════════════════════════════════════════════════════════
  🔍 ChangeLens — Impact Estimate
  ═══════════════════════════════════════════════════════════════

  🔴 HIGH RISK   Potential breaking change detected

  Summary
  1 file(s) changed across UTILITY surfaces — 3 line(s) modified, 77 downstream consumer(s)

  Why this risk tier?
  Export signature changed with 77 downstream consumer(s)

  Affected Surfaces
  ▸ UTILITY: utils/riskClassifier.js (1 symbol(s): classifyRisk)

  Downstream Consumers
  77 file(s) import from changed surfaces:

    └─ server.js
    └─ tests/claim_determinism.js
    └─ tests/frozen_eval.js
    └─ ...and 67 more

  Evidence
  ⚡ modified function "classifyRisk" in utils/riskClassifier.js
  ⚡ 77 downstream file(s) import from changed surfaces
  ⚡ export signature change detected with active consumers — verify compatibility

  ──────────────────────────────────────────────────────────────
  ⚠️  Review required — Review downstream consumers before merging.

  ChangeLens · 73ms · 177 files scanned · static analysis · not a guarantee
```

## How It Works

Six deterministic steps. No AI. No cloud service. Pure static analysis.

| Step | Module | What It Does |
|------|--------|-------------|
| 1 | **diffParser** | Parses unified diff → structured file changes with symbol extraction |
| 2 | **surfaceClassifier** | Categorizes: API · AUTH · CONFIG · SCHEMA · UTILITY · TEST · STYLE · BUILD · DOCS |
| 3 | **graphWalker** | BFS walks the import/require graph to find all downstream consumers |
| 4 | **blastRadius** | Weighs surface risk × consumer count × export changes → LOW / MEDIUM / HIGH |
| 5 | **impactCardBuilder** | Assembles the 9-field JSON output contract |
| 6 | **prCommentFormatter** | Renders a GitHub PR comment with evidence |

### Accuracy

Validated against a 20-PR corpus across auth, config, test, docs, style, build, utility, and multi-file scenarios:

| Metric | Value |
|--------|-------|
| **Accuracy** | 95% (19/20) |
| **False positives** | 0 |
| **False negatives** | 0 |
| **Overstated certainty** | 0 |

The one "miss"? Rated MEDIUM as HIGH — conservative by design.

## Quick Start

### CLI

```bash
# Pipe any git diff
git diff main | npx changelens --project ./your-repo

# From a diff file
npx changelens --diff changes.patch --project ./repo

# JSON output for CI
git diff main | npx changelens --json --pr PR-42
```

### GitHub Action

```yaml
# .github/workflows/changelens.yml
name: ChangeLens
on: [pull_request]

jobs:
  impact:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: atlas-with-iris/ChangeLens@v1
        with:
          project-path: "."
          fail-on-high: "false"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The action automatically posts an Impact Card as a PR comment and updates it on each push.

## CLI Options

```
changelens v0.1.0 — Pre-merge change impact visualizer

Usage:
  git diff main | changelens --project ./repo
  changelens --diff changes.patch --project ./repo

Options:
  --diff <path>      Path to diff file (reads stdin if omitted)
  --project <path>   Project root directory (default: cwd)
  --pr <id>          Pull request identifier
  --format <type>    Output format: terminal | markdown | json | both
  --json             Shorthand for --format json
  --markdown         Shorthand for --format markdown
  --version, -v      Show version
  --help, -h         Show this help
```

## Philosophy

- **Deterministic.** No LLM inference. Static analysis only. Same input → same output.
- **Evidence-based.** Every risk tier backed by structural facts from the import graph.
- **Conservative.** When in doubt, flag it. Better to over-warn than to miss.
- **Honest.** Footer says "Not a guarantee" — because it isn't.
- **Zero dependencies.** Node.js standard library only. Nothing to audit.

## We Run It On Ourselves

ChangeLens is validated against its own codebase — self-referential dogfooding. Every demo runs the full pipeline against real import graphs. We eat what we cook.

## Scope (v1)

- TypeScript / JavaScript repos
- PR comment output + terminal + JSON
- Zero external dependencies
- Node.js ≥ 18
- BFS depth: 2 hops (configurable)

## Known Limits

See [KNOWN_LIMITS.md](./KNOWN_LIMITS.md) for full documentation.

Key limits: BFS depth 2 hops, no TS path aliases, JS/TS only, comment-only changes in utility files handled correctly (no false alarm).

## Run Tests

```bash
node --test tests/*.test.js    # All 77 tests
node src/demo.js               # Synthetic PR demo
npm run demo:live              # 5 live scenarios (self-referential dogfood)
npm run validate               # 20-PR accuracy corpus
```

## License

[Business Source License 1.1](./LICENSE) — You can read, use, and contribute. You can't take it and build a competing product. Converts to Apache 2.0 in March 2029.

---

<sub>Built by Atlas with Iris · Static analysis impact estimate · Not a guarantee</sub>
