import { writeFileSafe } from "./repo.js";

/** MVP: apply array of {path, content}. If mode = "dry", no write. */
export async function applyPatches(patches: Array<{path: string; content: string}>, mode: "dry" | "apply") {
  const results: Array<{ path: string; applied: boolean }> = [];
  for (const p of patches) {
    if (mode === "apply") await writeFileSafe(p.path, p.content);
    results.push({ path: p.path, applied: mode === "apply" });
  }
  return { ok: true, results, mode };
}

