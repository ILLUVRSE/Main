import { Router } from "express";
import { getMemory, setMemory, appendMemory } from "../services/memory";
const r = Router();

r.get("/", async (_req, res, next) => { try { res.json(await getMemory()); } catch (e) { next(e); }});
r.post("/set", async (req, res, next) => { try { res.json(await setMemory(req.body)); } catch (e) { next(e); }});
r.post("/append", async (req, res, next) => { try { res.json(await appendMemory(req.body)); } catch (e) { next(e); }});

export default r;
