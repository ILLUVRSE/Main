// GET /api/v1/agent/status/:agent_id
// Returns agent registration / kernel status / latest signed manifest
router.get('/agent/status/:agent_id', requireAuth(), async (req:any, res) => {
  const agentId = req.params.agent_id;
  const agentsDir = path.resolve(process.cwd(), 'data', 'agents');
  const submissionsDir = path.resolve(process.cwd(), 'data', 'kernel-submissions');

  // Ensure agent exists
  try {
    await fs.access(path.join(agentsDir, `${agentId}.json`));
  } catch (e) {
    return res.status(404).json({ ok:false, error:{ code:'not_found', message:'agent not found' }});
  }

  // Find latest kernel submission/validation for this agent
  let latest: any = null;
  try {
    const files = await fs.readdir(submissionsDir);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(submissionsDir, f), 'utf8');
        const sub = JSON.parse(raw);
        // Heuristic: kernel callback manifest.agent_id OR metadata.agent_id OR submission.agent_id
        const manifestAgentId = sub?.kernel_callback?.signed_manifest?.manifest?.agent_id
          ?? sub?.signed_manifest?.manifest?.agent_id
          ?? null;
        const metaAgentId = sub?.metadata?.agent_id ?? null;
        const matches = manifestAgentId === agentId || metaAgentId === agentId || sub?.agent_id === agentId;
        if (!matches) continue;
        const ts = Date.parse(sub.updated_at || sub.created_at || '1970-01-01T00:00:00Z') || 0;
        if (!latest || ts > (Date.parse(latest.updated_at || latest.created_at || '1970-01-01T00:00:00Z') || 0)) {
          latest = sub;
        }
      } catch (inner) {
        // ignore parse errors
      }
    }
  } catch (e) {
    // no submissions directory or read error -> proceed with null latest
  }

  const kernel_status = latest ? (latest.status ?? 'unknown') : 'none';
  const latest_manifest = latest?.kernel_callback?.signed_manifest ?? latest?.signed_manifest ?? null;

  // Agent manager status: placeholder (you can integrate real Agent Manager here)
  const agent_manager_status = {
    state: 'stopped',
    last_seen: null
  };

  return res.json({
    ok: true,
    agent_id: agentId,
    kernel_status,
    agent_manager_status,
    latest_manifest
  });
});

