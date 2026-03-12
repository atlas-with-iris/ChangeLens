#!/usr/bin/env node
// build.js
// ═══════════════════════════════════════════════════════════════════════
// BUILD PIPELINE — Bundles src/ → dist/index.js (minified + obfuscated)
//
// Run: node build.js
//
// The published npm package ships dist/ only.
// Raw source stays in the repo but never reaches end users via npm.
// ═══════════════════════════════════════════════════════════════════════

import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const BANNER = `#!/usr/bin/env node
// ChangeLens v${JSON.parse(readFileSync("package.json", "utf-8")).version}
// (c) Atlas with Iris LLC — Business Source License 1.1
// https://github.com/atlas-with-iris/ChangeLens
`;

async function build() {
  console.log("🔧 Building ChangeLens...\n");

  mkdirSync("dist", { recursive: true });

  // Bundle everything into a single file
  const result = await esbuild.build({
    entryPoints: ["src/index.js"],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile: "dist/index.js",
    minify: true,
    treeShaking: true,
    mangleProps: /^_/,       // Mangle private properties (starting with _)
    keepNames: false,
    legalComments: "none",
    banner: { js: BANNER },
    define: {
      "process.env.CHANGELENS_BUILD": '"production"',
    },
    metafile: true,
  });

  // Report
  const text = await esbuild.analyzeMetafile(result.metafile);
  console.log(text);

  const distSize = readFileSync("dist/index.js", "utf-8").length;
  const srcFiles = result.metafile.inputs;
  const srcSize = Object.values(srcFiles).reduce((s, f) => s + f.bytes, 0);
  
  console.log(`\n✅ Build complete`);
  console.log(`   Source: ${Object.keys(srcFiles).length} files, ${(srcSize / 1024).toFixed(1)}KB`);
  console.log(`   Output: dist/index.js, ${(distSize / 1024).toFixed(1)}KB (${((distSize/srcSize)*100).toFixed(0)}% of source)`);
  console.log(`   Minified: ✓  Tree-shaken: ✓  Mangled: ✓`);
}

build().catch(err => {
  console.error("❌ Build failed:", err.message);
  process.exit(1);
});
