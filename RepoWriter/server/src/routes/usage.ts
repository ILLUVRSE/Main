import { Router } from "express";
import { snapshotUsage } from "../services/usage.js";
const r = Router();

r.get("/snapshot", (_req, res) => {
  res.json(snapshotUsage());
});
export default r;

