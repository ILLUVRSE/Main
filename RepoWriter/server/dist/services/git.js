import simpleGit from "simple-git";
const git = simpleGit(process.env.REPO_PATH);
export async function gitStatus() {
    return git.status();
}
export async function gitBranch(name) {
    await git.checkoutLocalBranch(name);
    return git.status();
}
export async function gitCommit(message) {
    await git.add(".");
    const res = await git.commit(message);
    return res;
}
export async function gitPush() {
    const current = await git.status();
    const branch = current.current || "main";
    const remote = process.env.GITHUB_REMOTE || "origin";
    const res = await git.push(remote, branch);
    return { ok: true, res };
}
