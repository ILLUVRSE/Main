// agentService.ts
import { Router } from 'express';
const router = Router();

// In-memory storage for agents
let agents = {};
let nextId = 1;

// POST /api/v1/agent/spawn
router.post('/api/v1/agent/spawn', (req, res) => {
    const agentId = nextId++;
    agents[agentId] = { id: agentId, status: 'stopped' };
    res.status(201).json({ agent_id: agentId });
});

// Lifecycle actions
router.post('/api/v1/agent/:id/start', (req, res) => {
    const agentId = req.params.id;
    if (!agents[agentId]) return res.status(404).send('Agent not found');
    agents[agentId].status = 'running';
    res.status(200).send('Started');
});

router.post('/api/v1/agent/:id/stop', (req, res) => {
    const agentId = req.params.id;
    if (!agents[agentId]) return res.status(404).send('Agent not found');
    agents[agentId].status = 'stopped';
    res.status(200).send('Stopped');
});

router.post('/api/v1/agent/:id/restart', (req, res) => {
    const agentId = req.params.id;
    if (!agents[agentId]) return res.status(404).send('Agent not found');
    agents[agentId].status = 'running';
    res.status(200).send('Restarted');
});

router.post('/api/v1/agent/:id/scale', (req, res) => {
    const agentId = req.params.id;
    if (!agents[agentId]) return res.status(404).send('Agent not found');
    // Scaling logic here (not implemented)
    res.status(200).send('Scaled');
});

export default router;