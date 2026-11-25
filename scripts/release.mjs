// Usage: npm run release -- 0.2.0
// Bumps the version in package.json and Cargo.toml, commits, tags v0.2.0 and pushes.
// GitHub Actions then builds and publishes the signed installer; installed apps offer the update.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? "")) {
  console.error("Usage: npm run release -- <major.minor.patch>");
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
if (execSync("git status --porcelain").toString().trim()) {
  console.error("Commit or stash your changes first.");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = v;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").replace(/^version = ".*"$/m, `version = "${v}"`);
writeFileSync("src-tauri/Cargo.toml", cargo);
run("npm install --package-lock-only --ignore-scripts");
run(`git add package.json package-lock.json src-tauri/Cargo.toml`);
run(`git commit -m "Release v${v}"`);
run(`git tag v${v}`);
run("git push --follow-tags");
console.log(`\nTagged v${v}. The installer and update appear under Releases in ~10–15 minutes.`);
