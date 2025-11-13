import { Router } from "express";

type CommitHistory = {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
};

const recentHistory: CommitHistory[] = [];

const router = Router();

router.get("/", (_req, res) => {
  res.json({ history: recentHistory });
});

router.post("/rollback", (req, res) => {
  const { sha } = req.body || {};
  if (!sha || typeof sha !== "string") {
    return res.status(400).json({ ok: false, error: "sha is required" });
  }
  res.json({ ok: true, rollbackStarted: sha });
});

export default router;
