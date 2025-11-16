import { Router } from "express";
import { planEdits } from "../services/planner.ts";
import { applyPatches } from "../services/patcher.ts";

const r = Router();

/** Plan: narrative prompt -> structured plan with patches (unified diffs) */
r.post("/plan", async (req, res, next) => {
  try {
    const { prompt, memory } = req.body as { prompt: string; memory?: string[] };
    console.log("OPENAI /plan body:", JSON.stringify(req.body));
    const plan = await planEdits(prompt, memory || []);
    console.log("PLANNER result:", JSON.stringify(plan));
    res.json({ plan });
  } catch (e) { next(e); }
});

/** Apply: takes array of {path, content} OR unified diffs and writes to FS */
r.post("/apply", async (req, res, next) => {
  try {
    const { patches, mode } = req.body as { patches: Array<any>; mode?: "dry" | "apply" };
    console.log("OPENAI /apply body:", JSON.stringify(req.body));
    const result = await applyPatches(patches, mode || "apply");
    console.log("APPLY result:", JSON.stringify(result));
    res.json(result);
  } catch (e) { next(e); }
});

export default r;
