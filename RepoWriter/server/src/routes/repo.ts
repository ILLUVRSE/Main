import { Router } from "express";
import { readFileSafe, writeFileSafe, listTree } from "../services/repo.js";

const r = Router();

r.get("/tree", async (req, res, next) => {
  try {
    const path = String(req.query.path || ".");
    const items = await listTree(path);
    res.json({ items });
  } catch (e) { next(e); }
});

r.get("/read", async (req, res, next) => {
  try {
    const path = String(req.query.path);
    const { content } = await readFileSafe(path);
    res.json({ content });
  } catch (e) { next(e); }
});

r.post("/write", async (req, res, next) => {
  try {
    const { path, content } = req.body as { path: string; content: string };
    await writeFileSafe(path, content);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default r;

