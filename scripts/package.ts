/**
 * Build the submission archive.
 *
 * The rules call for a repository AND an archive, and for judges to be able to run the
 * project from a clean environment. So this ships everything needed to reproduce the main
 * result — code, corpus, every run, trajectories, docs — and nothing that would make it
 * unreproducible or unsafe: no node_modules, no git history, no local environment files.
 *
 *   npm run package        # -> dist/nightstop-submission.zip and a MANIFEST beside it
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const OUT_DIR = "dist";
const ZIP = `${OUT_DIR}/nightstop-submission.zip`;

/** Anything that is regenerated, secret, or enormous. */
const EXCLUDE = [
  "node_modules/*", "*/node_modules/*",
  ".git/*", "*/.git/*",
  "dist/*", "out/*",
  ".env*", "*/.env*",
  "*.tsbuildinfo",
  ".DS_Store", "*/.DS_Store",
];

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });
}

mkdirSync(OUT_DIR, { recursive: true });
if (existsSync(ZIP)) rmSync(ZIP);

// A refusal is better than an archive of a dirty tree: the whole point is that what a
// judge unzips is what produced the numbers inside it.
const dirty = sh("git", ["status", "--porcelain"]).trim();
if (dirty && !process.argv.includes("--allow-dirty")) {
  console.error("refusing: the working tree has uncommitted changes.\n");
  console.error(dirty.split("\n").slice(0, 10).join("\n"));
  console.error("\nCommit first, or pass --allow-dirty if you know what you are doing.");
  process.exit(1);
}

const sha = sh("git", ["rev-parse", "HEAD"]).trim();
sh("zip", ["-r", "-q", ZIP, ".", "-x", ...EXCLUDE]);

const bytes = statSync(ZIP).size;
const digest = createHash("sha256").update(readFileSync(ZIP)).digest("hex");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const manifest = `# Submission archive

| | |
|---|---|
| Archive | \`${ZIP}\` |
| Size | ${(bytes / 1e6).toFixed(1)} MB |
| sha256 | \`${digest}\` |
| Commit | \`${sha}\` |
| Repository | https://github.com/Bernaljp/nightstop |
| Built | ${new Date().toISOString()} |
| Node | ${process.version} |
| Package | ${pkg.name} ${pkg.version} |

## What is inside

Everything required to reproduce the main result: source, the frozen corpus and its
manifests, every evaluation run in \`results/\`, the rendered agent trajectories, and all
documentation.

## What is not, and why

\`node_modules/\` (restore with \`npm install\`) · \`.git/\` (the repository is public, and
history belongs there) · \`out/\` and \`dist/\` (both regenerated) · any \`.env\` file, so no
credential can travel with the archive.

## From a clean environment

\`\`\`bash
unzip nightstop-submission.zip && cd nightstop
npm install
npm run verify        # typecheck, tests, freeze check — no credentials needed
\`\`\`

Full instructions in \`REPRODUCE.md\`.
`;
writeFileSync(`${OUT_DIR}/MANIFEST.md`, manifest);

console.log(`${ZIP}  ${(bytes / 1e6).toFixed(1)} MB`);
console.log(`sha256 ${digest}`);
console.log(`commit ${sha}`);
console.log(`${OUT_DIR}/MANIFEST.md written`);
