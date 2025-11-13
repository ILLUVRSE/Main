import express, { Request, Response } from 'express';

const router = express.Router();

export function signRequest(_req: Request, res: Response) {
  res.status(200).send('Signed');
}

export function createAgent(_req: Request, res: Response) {
  res.status(200).send('Agent created');
}

export function allocateResources(_req: Request, res: Response) {
  res.status(200).send('Resources allocated');
}

export function performDivision(_req: Request, res: Response) {
  res.status(200).send('Division performed');
}

export function getAuditDetails(req: Request, res: Response) {
  const { id } = req.params;
  res.status(200).send(`Audit details for ${id}`);
}

export function getReasonForNode(req: Request, res: Response) {
  const { node } = req.params;
  res.status(200).send(`Reason for node ${node}`);
}

router.post('/kernel/sign', signRequest);
router.post('/kernel/agent', createAgent);
router.post('/kernel/allocate', allocateResources);
router.post('/kernel/division', performDivision);
router.get('/kernel/audit/:id', getAuditDetails);
router.get('/kernel/reason/:node', getReasonForNode);

export default router;
