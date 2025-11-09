export const kernelUrl = process.env.NEXT_PUBLIC_KERNEL_URL || '';

export async function fetchAgents() {
  if (!kernelUrl) {
    return [
      { id: 'agent-1', state: 'running', templateId: 'tpl-1', createdAt: new Date().toISOString() },
      { id: 'agent-2', state: 'failed', templateId: 'tpl-2', createdAt: new Date().toISOString() }
    ];
  }
  const r = await fetch(`${kernelUrl}/kernel/agent`);
  if (!r.ok) throw new Error('kernel fetch failed');
  return r.json();
}

export async function fetchAudit() {
  if (!kernelUrl) {
    return [
      { id: 'aud-1', type: 'agent.instantiated', ts: new Date().toISOString(), payload: { agentId: 'agent-1' } },
      { id: 'aud-2', type: 'agent.running', ts: new Date().toISOString(), payload: { agentId: 'agent-1' } }
    ];
  }
  const r = await fetch(`${kernelUrl}/kernel/audit`);
  if (!r.ok) throw new Error('kernel fetch failed');
  return r.json();
}

