export const kernelUrl = process.env.NEXT_PUBLIC_KERNEL_URL || '';

const CONTROL_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'x-oidc-sub': 'control-panel-ui',
  'x-oidc-roles': 'SuperAdmin',
};

const MOCK_SETTINGS = {
  maintenanceMode: false,
  kernelTarget: 'http://localhost:3000',
  agentManagerTarget: 'http://localhost:4000',
  advancedNotes: '',
};

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

async function callControlPanel(path: string, init?: any) {
  if (!kernelUrl) {
    return null;
  }
  const payloadInit: any = {
    ...init,
    headers: {
      ...CONTROL_HEADERS,
      ...(init?.headers as Record<string, string> | undefined),
    },
  };
  const response = await fetch(`${kernelUrl}${path}`, payloadInit);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || 'control panel request failed');
  }
  return response.json();
}

export async function fetchControlPanelSettings() {
  if (!kernelUrl) {
    return { settings: { ...MOCK_SETTINGS, updatedAt: new Date().toISOString() } };
  }
  return callControlPanel('/control-panel/settings');
}

export async function updateControlPanelSettings(payload: Record<string, any>) {
  if (!kernelUrl) {
    return { settings: { ...MOCK_SETTINGS, ...payload, updatedAt: new Date().toISOString() } };
  }
  return callControlPanel('/control-panel/settings', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });
}

export async function triggerKernelAction(payload: Record<string, any>) {
  if (!kernelUrl) {
    return {
      target: 'kernel',
      mode: 'mock',
      message: 'Kernel action accepted (mock mode).',
      timestamp: new Date().toISOString(),
      echoedPayload: payload ?? {},
    };
  }
  return callControlPanel('/control-panel/actions/kernel', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });
}

export async function triggerAgentManagerAction(payload: Record<string, any>) {
  if (!kernelUrl) {
    return {
      target: 'agent-manager',
      mode: 'mock',
      message: 'Agent Manager action accepted (mock mode).',
      timestamp: new Date().toISOString(),
      echoedPayload: payload ?? {},
    };
  }
  return callControlPanel('/control-panel/actions/agent-manager', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });
}
