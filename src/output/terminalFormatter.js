// src/output/terminalFormatter.js
// ═══════════════════════════════════════════════════════════════════════
// TERMINAL FORMATTER — Rich ANSI-colored output for TTY display
//
// Zero dependencies. Raw ANSI escape codes.
//
// Used when ChangeLens output goes to a terminal (TTY).
// Falls back to plain markdown via prCommentFormatter when piped.
// ═══════════════════════════════════════════════════════════════════════

// ── ANSI CODES ────────────────────────────────────────────────────────

const c = {
  reset:     "\x1b[0m",
  bold:      "\x1b[1m",
  dim:       "\x1b[2m",
  italic:    "\x1b[3m",
  underline: "\x1b[4m",

  // Foreground
  red:       "\x1b[31m",
  green:     "\x1b[32m",
  yellow:    "\x1b[33m",
  blue:      "\x1b[34m",
  magenta:   "\x1b[35m",
  cyan:      "\x1b[36m",
  white:     "\x1b[37m",
  gray:      "\x1b[90m",

  // Background
  bgRed:     "\x1b[41m",
  bgGreen:   "\x1b[42m",
  bgYellow:  "\x1b[43m",
  bgBlue:    "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan:    "\x1b[46m",
  bgWhite:   "\x1b[47m",

  // Bright
  brightRed:    "\x1b[91m",
  brightGreen:  "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightCyan:   "\x1b[96m",
  brightWhite:  "\x1b[97m",
};

// ── HELPERS ───────────────────────────────────────────────────────────

function styled(text, ...styles) {
  return styles.join("") + text + c.reset;
}

function line(char = "─", len = 64) {
  return c.gray + char.repeat(len) + c.reset;
}

function riskBadge(tier) {
  switch (tier) {
    case "HIGH":
      return styled(" 🔴 HIGH RISK ", c.bold, c.bgRed, c.brightWhite);
    case "MEDIUM":
      return styled(" 🟡 MEDIUM RISK ", c.bold, c.bgYellow, c.white);
    case "LOW":
      return styled(" 🟢 LOW RISK ", c.bold, c.bgGreen, c.white);
    default:
      return styled(` ⚪ ${tier} `, c.bold);
  }
}

function riskHeader(tier) {
  switch (tier) {
    case "HIGH":   return styled("Potential breaking change detected", c.brightRed, c.bold);
    case "MEDIUM": return styled("Review recommended — potential impact detected", c.brightYellow, c.bold);
    case "LOW":    return styled("Low structural risk detected", c.brightGreen, c.bold);
    default:       return "Unknown risk";
  }
}

// ── MAIN FORMATTER ────────────────────────────────────────────────────

/**
 * Format an Impact Card for rich terminal display with ANSI colors.
 *
 * @param {import('./impactCardBuilder.js').ImpactCard} card
 * @param {Object} [meta]
 * @param {number} [meta.timeMs]       - Analysis time in ms
 * @param {number} [meta.filesScanned] - Number of files scanned in graph
 * @returns {string}
 */
export function formatTerminal(card, meta = {}) {
  const out = [];

  // ── Header ──────────────────────────────────────────────────────
  out.push("");
  out.push(line("═"));
  out.push(styled("  🔍 ChangeLens — Impact Estimate", c.bold, c.brightCyan));
  out.push(line("═"));
  out.push("");

  // ── Risk Badge ──────────────────────────────────────────────────
  out.push(`  ${riskBadge(card.riskTier)}  ${riskHeader(card.riskTier)}`);
  out.push("");

  // ── Summary ─────────────────────────────────────────────────────
  out.push(styled("  Summary", c.bold, c.white));
  out.push(`  ${c.gray}${card.summary}${c.reset}`);
  out.push("");

  // ── Why ─────────────────────────────────────────────────────────
  out.push(styled("  Why this risk tier?", c.bold, c.white));
  out.push(`  ${card.why}`);
  out.push("");

  // ── Changed Surfaces ────────────────────────────────────────────
  if (card.changedSurfaces.length > 0) {
    out.push(styled("  Affected Surfaces", c.bold, c.white));
    for (const surface of card.changedSurfaces) {
      // Color-code by category
      const catMatch = surface.match(/^(\w+):/);
      const cat = catMatch ? catMatch[1] : "";
      let catColor = c.cyan;
      if (cat === "AUTH" || cat === "SCHEMA") catColor = c.brightRed;
      else if (cat === "API" || cat === "CONFIG") catColor = c.brightYellow;
      else if (cat === "TEST" || cat === "STYLE" || cat === "DOCS") catColor = c.green;

      out.push(`  ${catColor}▸${c.reset} ${surface}`);
    }
    out.push("");
  }

  // ── Downstream Consumers ────────────────────────────────────────
  if (card.affectedConsumers.length > 0) {
    const consumerCount = card.affectedConsumers.length;
    const consumerColor = consumerCount > 10 ? c.brightRed : consumerCount > 3 ? c.brightYellow : c.cyan;
    out.push(styled("  Downstream Consumers", c.bold, c.white));
    out.push(`  ${consumerColor}${consumerCount}${c.reset} file(s) import from changed surfaces:`);
    out.push("");

    const shown = card.affectedConsumers.slice(0, 10);
    for (const consumer of shown) {
      out.push(`  ${c.gray}  └─${c.reset} ${consumer}`);
    }
    if (consumerCount > 10) {
      out.push(`  ${c.dim}  └─ ...and ${consumerCount - 10} more${c.reset}`);
    }
    out.push("");
  }

  // ── Evidence ────────────────────────────────────────────────────
  if (card.evidence.length > 0) {
    out.push(styled("  Evidence", c.bold, c.white));
    for (const item of card.evidence) {
      // Color specific evidence types
      if (item.includes("export signature change") || item.includes("modified function") || item.includes("modified class")) {
        out.push(`  ${c.brightRed}⚡${c.reset} ${item}`);
      } else if (item.includes("comment-only")) {
        out.push(`  ${c.green}✦${c.reset} ${c.dim}${item}${c.reset}`);
      } else if (item.includes("downstream")) {
        out.push(`  ${c.brightYellow}⚡${c.reset} ${item}`);
      } else if (item.includes("auth surface") || item.includes("schema")) {
        out.push(`  ${c.brightRed}▲${c.reset} ${item}`);
      } else if (item.includes("new ")) {
        out.push(`  ${c.cyan}+${c.reset} ${item}`);
      } else {
        out.push(`  ${c.gray}•${c.reset} ${item}`);
      }
    }
    out.push("");
  }

  // ── Merge Guidance ──────────────────────────────────────────────
  out.push(line("─"));
  out.push("");

  if (card.safeToMerge) {
    out.push(`  ${styled("✅ Safe to merge", c.bold, c.brightGreen)} — ${c.dim}${card.mergeCaution}${c.reset}`);
  } else {
    out.push(`  ${styled("⚠️  Review required", c.bold, c.brightYellow)} — ${card.mergeCaution}`);
  }

  // ── Meta ─────────────────────────────────────────────────────────
  out.push("");
  const metaParts = [];
  if (meta.timeMs !== undefined) metaParts.push(`${meta.timeMs}ms`);
  if (meta.filesScanned !== undefined) metaParts.push(`${meta.filesScanned} files scanned`);
  metaParts.push("static analysis");
  metaParts.push("not a guarantee");

  out.push(`  ${c.dim}ChangeLens · ${metaParts.join(" · ")}${c.reset}`);
  out.push("");

  return out.join("\n");
}
