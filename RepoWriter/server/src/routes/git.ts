import { Router } from "express";
import { gitStatus, gitBranch, gitCommit, gitPush } from "../services/git.js";

const r = Router();

r.get("/status", async (_req, res, next) => {
  try { res.json(await gitStatus()); } catch (e) { next(e); }
});
r.post("/branch", async (req, res, next) => {
  try { res.json(await gitBranch(req.body.name)); } catch (e) { next(e); }
});
r.post("/commit", async (req, res, next) => {
  try { res.json(await gitCommit(req.body.message || "RepoWriter commit")); } catch (e) { next(e); }
});
r.post("/push", async (req, res, next) => {
  try { res.json(await gitPush()); } catch (e) { next(e); }
});

export default r;

