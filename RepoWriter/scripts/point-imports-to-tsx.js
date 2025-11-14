#!/usr/bin/env node
// scripts/point-imports-to-tsx.js
// Robust version: find the RepoWriter/web/src path whether the script
// is executed from RepoWriter/ (script is RepoWriter/scripts/...) or
// from repo root (script is ./scripts/...).

const fs = require("fs");
const path = require("path");

const scriptDir = __dirname;
// repoRoot candidates: parent of scriptDir, or parent of parent
const repoRootCandidates = [
  path.resolve(scriptDir, ".."),           // e.g. /.../RepoWriter
  path.resolve(scriptDir, "..", ".."),     // e.g. /.../Main
];

// Try a set of possible src roots
let srcRoot = null;
for (const r of repoRootCandidates) {
  const candidate1 = path.join(r, "RepoWriter", "web", "src");
  const candidate2 = path.join(r, "web", "src");
  const candidate3 = path.join(r, "RepoWriter", "RepoWriter", "web", "src"); // paranoid
  if (fs.existsSync(candidate1)) { srcRoot = candidate1; break; }
  if (fs.existsSync(candidate2)) { srcRoot = candidate2; break; }
  if (fs.existsSync(candidate3)) { srcRoot = candidate3; break; }
}

// If not found, also try where scriptDir itself looks like RepoWriter/scripts
if (!srcRoot) {
  const maybe = path.join(scriptDir, "..", "web", "src");
  if (fs.existsSync(maybe)) srcRoot = maybe;
}

if (!srcRoot) {
  console.error("Could not find RepoWriter web/src. Tried these locations:");
  console.error(repoRootCandidates.map(r => [
    path.join(r, "RepoWriter", "web", "src"),
    path.join(r, "web", "src"),
    path.join(r, "RepoWriter", "RepoWriter", "web", "src"),
  ]) .flat().join("\n"));
  process.exit(1);
}

console.log("Using srcRoot:", srcRoot);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files = files.concat(walk(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) files.push(full);
  }
  return files;
}

function existsAny(pList) {
  return pList.find(p => fs.existsSync(p));
}

function candidateFor(spec, fileDir) {
  if (!spec.startsWith(".") && !spec.startsWith("..")) return null;
  if (/\.(css|json|svg|png|jpg|jpeg|gif|woff|woff2|ttf|ico|map)$/.test(spec)) return null;

  const parsed = path.parse(spec);
  if (parsed.ext) {
    if (parsed.ext === ".js" || parsed.ext === ".jsx") {
      const base = path.resolve(fileDir, spec.slice(0, -parsed.ext.length));
      const tsx = base + ".tsx";
      const ts = base + ".ts";
      if (fs.existsSync(tsx)) return spec.replace(/\.(js|jsx)$/, ".tsx");
      if (fs.existsSync(ts)) return spec.replace(/\.(js|jsx)$/, ".ts");
    }
    return null;
  } else {
    const base = path.resolve(fileDir, spec);
    const tries = [
      base + ".tsx",
      base + ".ts",
      path.join(base, "index.tsx"),
      path.join(base, "index.ts")
    ];
    const found = existsAny(tries);
    if (found) {
      if (found.endsWith(".tsx")) {
        if (found.endsWith("/index.tsx")) return spec.replace(/\/$/, "") + "/index.tsx";
        return spec + ".tsx";
      }
      if (found.endsWith(".ts")) {
        if (found.endsWith("/index.ts")) return spec.replace(/\/$/, "") + "/index.ts";
        return spec + ".ts";
      }
    }
    return null;
  }
}

const fileList = walk(srcRoot);
console.log("Scanning files:", fileList.length);

const importPatterns = [
  { name: "from", regex: /from\s+['"](\.{1,2}\/[^'"]+)['"]/g },
  { name: "importDecl", regex: /(^|\n)\s*import\s+['"](\.{1,2}\/[^'"]+)['"];?/gm },
  { name: "require", regex: /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g },
  { name: "dynamicImport", regex: /import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g }
];

let totalChanges = 0;
for (const file of fileList) {
  let content = fs.readFileSync(file, "utf8");
  let original = content;
  const fileDir = path.dirname(file);
  const changes = [];

  for (const pat of importPatterns) {
    let match;
    while ((match = pat.regex.exec(content)) !== null) {
      const groups = match.slice(1).filter(Boolean);
      const spec = groups[groups.length - 1];
      if (!spec) continue;
      const replacement = candidateFor(spec, fileDir);
      if (replacement && replacement !== spec) {
        changes.push({ from: spec, to: replacement });
      }
    }
    pat.regex.lastIndex = 0;
  }

  if (changes.length > 0) {
    const uniqueMap = new Map();
    for (const c of changes) if (!uniqueMap.has(c.from)) uniqueMap.set(c.from, c.to);
    const unique = Array.from(uniqueMap.entries()).map(([from, to]) => ({ from, to }));

    let newContent = content;
    for (const { from, to } of unique) {
      const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(
        `(from\\s+['"])${esc}(['"])|(import\\(\\s*['"])${esc}(['"]\\s*\\))|(require\\(\\s*['"])${esc}(['"]\\s*\\))|(^import\\s+['"])${esc}(['"];?)`,
        "gm"
      );
      newContent = newContent.replace(re, (m, a1, a2, a3, a4, a5, a6, a7, a8) => {
        if (a1 !== undefined) return `${a1}${to}${a2}`;
        if (a3 !== undefined) return `${a3}${to}${a4}`;
        if (a5 !== undefined) return `${a5}${to}${a6}`;
        if (a7 !== undefined) return `${a7}${to}${a8}`;
        return m;
      });
    }

    if (newContent !== original) {
      const bak = file + ".bak";
      if (!fs.existsSync(bak)) fs.writeFileSync(bak, original, "utf8");
      fs.writeFileSync(file, newContent, "utf8");
      console.log("Updated:", path.relative(scriptDir, file), "changes:", unique.length);
      totalChanges++;
    }
  }
}

console.log("Done. Files updated:", totalChanges);
console.log("Backups created with .bak suffix for each modified file.");

