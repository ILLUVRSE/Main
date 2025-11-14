import { Router } from 'express';
import { SandboxRunner, SandboxInstruction } from '../services/sandbox/sandboxRunner.js';

const normalize = (body: any): SandboxInstruction[] =>
  Array.isArray(body?.instructions)
    ? body.instructions.map((instruction: any) => ({
        op: String(instruction.op),
        payload: instruction.payload ?? {},
      }))
    : [];

export const createSandboxRouter = (sandboxRunner: SandboxRunner) => {
  const router = Router();
  router.post('/run', (req, res) => {
    const instructions = normalize(req.body);
    const result = sandboxRunner.run(instructions);
    res.json(result);
  });
  return router;
};
