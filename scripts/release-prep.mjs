#!/usr/bin/env bun

import fs from "node:fs";
import { execFileSync } from "node:child_process";

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function tryGit(args) {
  try {
    return runGit(args);
  } catch {
    return "";
  }
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [versionOrBump, ...flags] = argv;
  if (!versionOrBump) {
    fail("Usage: node scripts/release-prep.mjs <patch|minor|major|x.y.z> [--yes]");
  }

  const yes = flags.includes("--yes");
  return { versionOrBump, yes };
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    fail(`Invalid version: ${version}`);
  }

  return match.slice(1).map(Number);
}

function bumpVersion(currentVersion, mode) {
  const [major, minor, patch] = parseVersion(currentVersion);
  if (mode === "patch") return `${major}.${minor}.${patch + 1}`;
  if (mode === "minor") return `${major}.${minor + 1}.0`;
  if (mode === "major") return `${major + 1}.0.0`;
  parseVersion(mode);
  return mode;
}

function ensureMainBranch() {
  const branch = tryGit(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!branch) fail("HEAD is detached. Switch to main before running release prep.");
  if (branch !== "main") fail(`Current branch is '${branch}'. Switch to 'main' first.`);
}

function ensureCleanTree() {
  const status = tryGit(["status", "--porcelain"]);
  if (status) fail("Working tree is not clean. Commit or stash changes first.");
}

function readPackageJson() {
  const raw = fs.readFileSync("package.json", "utf8");
  return { raw, data: JSON.parse(raw) };
}

function writePackageJson(pkg) {
  fs.writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
}

function latestTag() {
  return tryGit(["describe", "--tags", "--abbrev=0"]);
}

function commitSubjectsSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const out = tryGit(["log", range, "--no-merges", "--pretty=format:%s"]);
  const lines = out.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines;
}

function formatChangelogSection(version, subjects) {
  const bullets = subjects.map((subject) => `- ${subject}`).join("\n");
  return `## ${version}\n${bullets}\n\n`;
}

function prependChangelog(version, subjects) {
  if (subjects.length === 0) {
    fail("No commits found since the latest tag. Nothing to release.");
  }

  const changelogPath = "CHANGELOG.md";
  const current = fs.readFileSync(changelogPath, "utf8");
  const marker = "---\n";
  const idx = current.indexOf(marker);
  if (idx === -1) {
    fail("CHANGELOG.md is missing the expected '---' separator.");
  }

  const insertAt = idx + marker.length;
  const section = formatChangelogSection(version, subjects);
  const next = `${current.slice(0, insertAt)}${section}${current.slice(insertAt)}`;
  fs.writeFileSync(changelogPath, next);
}

function ensureTagDoesNotExist(tag) {
  const exists = tryGit(["rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
  if (exists) fail(`Tag '${tag}' already exists.`);
}

function commitAndTag(version) {
  runGit(["add", "package.json", "CHANGELOG.md"]);
  runGit(["commit", "-m", `chore: update version to ${version}`]);
  runGit(["tag", "-a", version, "-m", `v${version}`]);
}

function main() {
  const { versionOrBump, yes } = parseArgs(process.argv.slice(2));
  ensureMainBranch();
  ensureCleanTree();

  const { data: pkg } = readPackageJson();
  if (!pkg.version) fail("package.json is missing a version field.");

  const nextVersion = bumpVersion(pkg.version, versionOrBump);
  if (nextVersion === pkg.version) {
    fail(`Version is already ${pkg.version}. Provide a new version.`);
  }

  const tag = latestTag();
  const subjects = commitSubjectsSince(tag);
  ensureTagDoesNotExist(nextVersion);

  if (!yes) {
    console.log(`Preparing release ${nextVersion}`);
    console.log(`Current version: ${pkg.version}`);
    console.log(`Latest tag: ${tag || "(none)"}`);
    console.log("Changelog entries:");
    subjects.forEach((subject) => console.log(`  - ${subject}`));
    console.log("");
    console.log("Re-run with --yes to apply changes.");
    process.exit(0);
  }

  pkg.version = nextVersion;
  writePackageJson(pkg);
  prependChangelog(nextVersion, subjects);
  commitAndTag(nextVersion);

  console.log(`Release prepared locally for ${nextVersion}`);
  console.log(`Next steps:`);
  console.log(`  git push origin main`);
  console.log(`  git push origin ${nextVersion}`);
}

main();
