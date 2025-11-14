import { Router } from 'express';
const normalize = (body) => Array.isArray(body?.instructions)
    ? body.instructions.map((instruction) => ({
        op: String(instruction.op),
        payload: instruction.payload ?? {},
    }))
    : [];
export const createSandboxRouter = (sandboxRunner) => {
    const router = Router();
    router.post('/run', (req, res) => {
        const instructions = normalize(req.body);
        const result = sandboxRunner.run(instructions);
        res.json(result);
    });
    return router;
};
