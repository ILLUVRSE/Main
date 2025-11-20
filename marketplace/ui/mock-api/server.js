#!/usr/bin/env node
/* eslint-disable no-console */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const PORT = process.env.MOCK_API_PORT || 4001;
const app = express();
app.use(cors());
app.use(express.json());

const seedPath = path.join(__dirname, 'seed.json');
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
const projects = seed.projects;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const findProject = (id) => projects.find((p) => p.id === id || p.slug === id);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/projects', async (req, res) => {
  await wait(350);
  res.json(projects);
});

app.get('/api/projects/:id', async (req, res) => {
  const project = findProject(req.params.id);
  await wait(250);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
});

app.post('/api/projects/:id/preview', async (req, res) => {
  const project = findProject(req.params.id);
  await wait(500);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({
    sessionId: `sess_${Date.now().toString(36)}`,
    manifest: project.manifest,
    assets: project.assets,
  });
});

app.post('/api/kernel/sign', async (req, res) => {
  const { projectId } = req.body || {};
  const project = findProject(projectId);
  await wait(700);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  project.status = 'signed';
  const manifestSignatureId = `msig-${Date.now().toString(36)}`;
  res.json({ ok: true, manifestSignatureId });
});

app.listen(PORT, () => {
  console.log(`Mock API running at http://localhost:${PORT}`);
});
