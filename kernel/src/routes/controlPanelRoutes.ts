import express, { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { requireRoles, Roles } from '../rbac';

type ControlPanelSettings = {
  maintenanceMode: boolean;
  kernelTarget: string;
  agentManagerTarget: string;
  advancedNotes: string;
  updatedAt: string;
};

type ControlTarget = 'kernel' | 'agent-manager';

const DEFAULT_SETTINGS: Omit<ControlPanelSettings, 'updatedAt'> = {
  maintenanceMode: false,
  kernelTarget: process.env.KERNEL_CONTROL_URL || process.env.KERNEL_URL || 'http://localhost:3000',
  agentManagerTarget: process.env.AGENT_MANAGER_CONTROL_URL || process.env.AGENT_MANAGER_URL || 'http://localhost:3100',
  advancedNotes: '',
};

function resolveSettingsPath(): string {
  const configuredPath = process.env.CONTROL_PANEL_SETTINGS_PATH;
  return configuredPath
    ? path.resolve(process.cwd(), configuredPath)
    : path.resolve(process.cwd(), 'data/control-panel-settings.json');
}

function normalizeSettings(payload: any): ControlPanelSettings {
  return {
    maintenanceMode: typeof payload?.maintenanceMode === 'boolean' ? payload.maintenanceMode : Boolean(payload?.maintenanceMode),
    kernelTarget:
      typeof payload?.kernelTarget === 'string' && payload.kernelTarget.trim().length
        ? payload.kernelTarget.trim()
        : DEFAULT_SETTINGS.kernelTarget,
    agentManagerTarget:
      typeof payload?.agentManagerTarget === 'string' && payload.agentManagerTarget.trim().length
        ? payload.agentManagerTarget.trim()
        : DEFAULT_SETTINGS.agentManagerTarget,
    advancedNotes: typeof payload?.advancedNotes === 'string' ? payload.advancedNotes : '',
    updatedAt: typeof payload?.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString(),
  };
}

function persistSettings(settings: ControlPanelSettings) {
  const filePath = resolveSettingsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
}

function loadSettings(): ControlPanelSettings {
  const filePath = resolveSettingsPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return normalizeSettings(parsed);
    }
  } catch (err) {
    console.warn('control-panel.settings.read_failed', (err as Error).message);
  }
  const defaults: ControlPanelSettings = {
    ...DEFAULT_SETTINGS,
    updatedAt: new Date().toISOString(),
  };
  persistSettings(defaults);
  return defaults;
}

function updateSettings(partial: Partial<ControlPanelSettings>): ControlPanelSettings {
  const current = loadSettings();
  const next: ControlPanelSettings = {
    maintenanceMode:
      typeof partial.maintenanceMode === 'boolean' ? partial.maintenanceMode : current.maintenanceMode,
    kernelTarget:
      typeof partial.kernelTarget === 'string' && partial.kernelTarget.trim().length
        ? partial.kernelTarget.trim()
        : current.kernelTarget,
    agentManagerTarget:
      typeof partial.agentManagerTarget === 'string' && partial.agentManagerTarget.trim().length
        ? partial.agentManagerTarget.trim()
        : current.agentManagerTarget,
    advancedNotes: typeof partial.advancedNotes === 'string' ? partial.advancedNotes : current.advancedNotes,
    updatedAt: new Date().toISOString(),
  };
  persistSettings(next);
  return next;
}

function resolveTargetUrl(target: ControlTarget): string | undefined {
  if (target === 'kernel') return process.env.KERNEL_CONTROL_URL || process.env.KERNEL_URL;
  return process.env.AGENT_MANAGER_CONTROL_URL || process.env.AGENT_MANAGER_URL;
}

async function proxyControlAction(target: ControlTarget, payload: any) {
  const timestamp = new Date().toISOString();
  const echoedPayload = payload ?? {};
  const baseUrl = resolveTargetUrl(target);
  if (!baseUrl) {
    return {
      target,
      mode: 'stub' as const,
      message: `No ${target} control endpoint configured; accepted locally.`,
      timestamp,
      echoedPayload,
    };
  }

  const endpoint = baseUrl.replace(/\/$/, '') + '/control';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(echoedPayload),
    });
    const text = await response.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return {
      target,
      mode: 'proxied' as const,
      message: `Forwarded to ${target} control endpoint`,
      timestamp,
      echoedPayload,
      upstream: {
        status: response.status,
        body: parsed,
      },
    };
  } catch (err) {
    return {
      target,
      mode: 'error' as const,
      message: `Failed to reach ${target} control endpoint`,
      timestamp,
      echoedPayload,
      error: (err as Error).message,
    };
  }
}

export default function createControlPanelRouter(): Router {
  const router = express.Router();

  router.get(
    '/settings',
    requireRoles(Roles.SUPERADMIN),
    (_req: Request, res: Response) => {
      const settings = loadSettings();
      res.json({ settings });
    },
  );

  router.post(
    '/settings',
    requireRoles(Roles.SUPERADMIN),
    (req: Request, res: Response) => {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const updates: Partial<ControlPanelSettings> = {};
      if (typeof (body as any).maintenanceMode === 'boolean') updates.maintenanceMode = (body as any).maintenanceMode;
      if (typeof (body as any).kernelTarget === 'string') updates.kernelTarget = (body as any).kernelTarget;
      if (typeof (body as any).agentManagerTarget === 'string') updates.agentManagerTarget = (body as any).agentManagerTarget;
      if (typeof (body as any).advancedNotes === 'string') updates.advancedNotes = (body as any).advancedNotes;
      const settings = updateSettings(updates);
      res.json({ settings });
    },
  );

  router.post(
    '/actions/:target',
    requireRoles(Roles.SUPERADMIN),
    async (req: Request, res: Response) => {
      const targetParam = req.params.target as ControlTarget;
      if (targetParam !== 'kernel' && targetParam !== 'agent-manager') {
        return res.status(404).json({ error: 'unknown_target' });
      }
      const payload = (req.body && typeof req.body === 'object') ? req.body : {};
      const result = await proxyControlAction(targetParam, payload);
      return res.json(result);
    },
  );

  return router;
}
