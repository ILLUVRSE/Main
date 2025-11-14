import fs from "fs/promises";
import path from "path";
import fg from "fast-glob";
const REPO = process.env.REPO_PATH!;

function safe(p: string) {
  const full = path.resolve(REPO, p);
  if (!full.startsWith(path.resolve(REPO))) throw new Error("Path escape detected");
  return full;
}

export async function listTree(rel = ".") {
  const base = safe(rel);
  const entries = await fg(["**/*"], { cwd: base, dot: false, onlyFiles: false, followSymbolicLinks: false, deep: 5 });
  return entries;
}

export async function readFileSafe(rel: string) {
  const full = safe(rel);
  const content = await fs.readFile(full, "utf8");
  return { content };
}

export async function writeFileSafe(rel: string, content: string) {
  const full = safe(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

