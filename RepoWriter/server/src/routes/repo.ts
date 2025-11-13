import { Router } from "express";

type AuditEvent = { action: string; timestamp: Date };

const appendOnlyCorrections: AuditEvent[] = [];

function recordCorrection(action: string) {
  const event: AuditEvent = { action, timestamp: new Date() };
  appendOnlyCorrections.push(event);
  return event;
}

const router = Router();

router.get("/corrections", (_req, res) => {
  res.json({ corrections: appendOnlyCorrections });
});

router.post("/corrections", (req, res) => {
  const action = typeof req.body?.action === "string" ? req.body.action : "correction";
  const event = recordCorrection(action);
  res.status(201).json({ correction: event });
});

export default router;
