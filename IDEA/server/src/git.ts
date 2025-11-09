import { SimpleGit, simpleGit } from "simple-git";
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileP = promisify(execFile);

let git: SimpleGit | null = null;
let repoPath: string | null = null;

async function isGitDir(p: string) {
  try {
    const stat = await fs.stat(path.join(p, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

export async function openRepo(p: string) {
  const abs = path.resolve(p);
  if (!(await isGitDir(abs))) throw new Error(`Not a git repo: ${abs}`);
  git = simpleGit({ baseDir: abs });
  repoPath = abs;
  return { repoPath: abs };
}

function requireRepo() {
  if (!git || !repoPath) throw new Error("No repo open");
  return { git, repoPath };
}

export async function current() {
  return { repoPath };
}

export async function status() {
  const { git, repoPath } = requireRepo();
  const s = await git.status();
  return { repoPath, status: s };
}

export async function branches() {
  const { git, repoPath } = requireRepo();
  const b = await git.branchLocal();
  return { repoPath, branches: b.all, current: b.current };
}

export async function remotes() {
  const { git, repoPath } = requireRepo();
  const r = await git.getRemotes(true);
  return { repoPath, remotes: r };
}

export async function createBranch(name: string) {
  const { git, repoPath } = requireRepo();
  if (!/^[\w./-]+$/.test(name)) throw new Error("invalid branch name");
  await git.checkoutLocalBranch(name);
  const b = await git.branchLocal();
  return { repoPath, current: b.current };
}

export async function commitAll(message: string) {
  const { git, repoPath } = requireRepo();
  if (!message || !message.trim()) throw new Error("commit message required");
  await git.add(".");
  const r = await git.commit(message);
  return { repoPath, commit: r.commit };
}

export async function push(remote = "origin", branch?: string) {
  const { git, repoPath } = requireRepo();
  const b = await git.branchLocal();
  const name = branch || b.current;
  if (!name) throw new Error("no current branch");
  await git.push(remote, name, { "--set-upstream": null });
  return { repoPath, remote, branch: name };
}

export async function prCreate(
  title: string,
  body = "",
  base = "main",
  draft = true
) {
  const { repoPath } = requireRepo();
  if (!title?.trim()) throw new Error("title required");
  const args = [
    "pr",
    "create",
    "--title",
    title,
    "--body",
    body || "",
    "--base",
    base,
  ];
  if (draft) args.push("--draft");
  // Run in repo directory so gh picks it up
  const { stdout } = await execFileP("gh", args, { cwd: repoPath });
  // gh usually prints the PR URL on success
  return { repoPath, url: stdout.trim() };
}

