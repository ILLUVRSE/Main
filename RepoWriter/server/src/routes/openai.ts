import { Router } from "express";
import { planEdits } from "../services/planner.js";
import { applyPatches } from "../services/patcher.js";

const r = Router();

/** Plan: narrative prompt -> structured plan with patches (unified diffs) */
r.post("/plan", async (req, res, next) => {
  try {
    const { prompt, memory } = req.body as { prompt: string; memory?: string[] };
    const plan = await planEdits(prompt, memory || []);
    res.json({ plan });
  } catch (e) { next(e); }
});

/** Apply: takes array of {path, content} OR unified diffs and writes to FS */
r.post("/apply", async (req, res, next) => {
  try {
    const { patches, mode } = req.body as { patches: Array<any>; mode?: "dry" | "apply" };
    const result = await applyPatches(patches, mode || "apply");
    res.json(result);
  } catch (e) { next(e); }
});

export default r;

