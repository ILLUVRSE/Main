"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureAdminSession } from "../../lib/auth";
import {
  fetchControlPanelSettings,
  triggerAgentManagerAction,
  triggerKernelAction,
  updateControlPanelSettings,
} from "../../lib/fetcher";

type Settings = {
  maintenanceMode: boolean;
  kernelTarget: string;
  agentManagerTarget: string;
  advancedNotes: string;
  updatedAt: string;
};

type MessageMap = Record<string, string>;

export default function ControlPanelPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notes, setNotes] = useState("");
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [messages, setMessages] = useState<MessageMap>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    ensureAdminSession(router);
    refreshSettings();
  }, [router]);

  async function refreshSettings() {
    try {
      const response = await fetchControlPanelSettings();
      setSettings(response.settings);
      setNotes(response.settings.advancedNotes || "");
      setMaintenanceMode(Boolean(response.settings.maintenanceMode));
      setError(null);
      setMessages((prev) => ({ ...prev, settings: "Settings loaded" }));
    } catch (err: any) {
      setError(err?.message || "Failed to load settings");
    }
  }

  async function handleKernelAction() {
    setMessages((prev) => ({ ...prev, kernel: "Sending kernel action..." }));
    try {
      const result = await triggerKernelAction({ action: "ping" });
      const msg = result?.message || "Kernel action completed";
      setMessages((prev) => ({ ...prev, kernel: msg }));
    } catch (err: any) {
      setMessages((prev) => ({ ...prev, kernel: err?.message || "Kernel action failed" }));
    }
  }

  async function handleAgentAction() {
    setMessages((prev) => ({ ...prev, agent: "Sending agent-manager action..." }));
    try {
      const result = await triggerAgentManagerAction({ action: "refresh" });
      const msg = result?.message || "Agent Manager action completed";
      setMessages((prev) => ({ ...prev, agent: msg }));
    } catch (err: any) {
      setMessages((prev) => ({ ...prev, agent: err?.message || "Agent Manager action failed" }));
    }
  }

  async function handleAdvancedSave() {
    setSaving(true);
    setMessages((prev) => ({ ...prev, settings: "Saving advanced settings..." }));
    try {
      const payload = {
        maintenanceMode,
        advancedNotes: notes,
      };
      const response = await updateControlPanelSettings(payload);
      setSettings(response.settings);
      setMessages((prev) => ({ ...prev, settings: "Advanced settings saved" }));
    } catch (err: any) {
      setMessages((prev) => ({ ...prev, settings: err?.message || "Failed to save settings" }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900">Control Panel</h1>
        <p className="text-sm text-gray-500 mt-1">
          Restricted tools for SuperAdmin operators. Actions are proxied through the Kernel RBAC middleware.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="bg-white border rounded shadow-sm p-4">
          <h2 className="font-semibold text-gray-800 mb-2">Kernel controls</h2>
          <p className="text-sm text-gray-500 mb-4">
            Use for quick diagnostics (safe no-op payloads in this placeholder UI).
          </p>
          <button
            onClick={handleKernelAction}
            className="w-full bg-indigo-600 text-white font-semibold px-4 py-2 rounded hover:bg-indigo-500 transition"
          >
            Kernel
          </button>
          {messages.kernel && <p className="text-xs text-gray-500 mt-2">{messages.kernel}</p>}
        </div>

        <div className="bg-white border rounded shadow-sm p-4">
          <h2 className="font-semibold text-gray-800 mb-2">Agent Manager controls</h2>
          <p className="text-sm text-gray-500 mb-4">
            Forward lightweight commands to the Agent Manager service.
          </p>
          <button
            onClick={handleAgentAction}
            className="w-full bg-indigo-600 text-white font-semibold px-4 py-2 rounded hover:bg-indigo-500 transition"
          >
            Agent Manager
          </button>
          {messages.agent && <p className="text-xs text-gray-500 mt-2">{messages.agent}</p>}
        </div>

        <div className="bg-white border rounded shadow-sm p-4">
          <h2 className="font-semibold text-gray-800 mb-2">Advanced settings</h2>
          <p className="text-sm text-gray-500 mb-4">
            Quickly toggle maintenance or share operator notes.
          </p>
          <button
            onClick={handleAdvancedSave}
            className="w-full bg-indigo-600 text-white font-semibold px-4 py-2 rounded hover:bg-indigo-500 transition disabled:opacity-60"
            disabled={saving}
          >
            Advanced Settings
          </button>
          {messages.settings && <p className="text-xs text-gray-500 mt-2">{messages.settings}</p>}
        </div>
      </section>

      <section className="bg-white border rounded shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Advanced configuration</h3>
          <button
            onClick={refreshSettings}
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            Refresh
          </button>
        </div>

        <label className="flex items-center space-x-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={maintenanceMode}
            onChange={(e) => setMaintenanceMode(e.target.checked)}
            className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
          />
          <span>Maintenance mode</span>
        </label>

        <div>
          <label className="text-sm text-gray-700 block mb-1">Operator notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full min-h-[120px] border border-gray-300 rounded px-3 py-2 text-sm"
            placeholder="Document overrides or manual interventions..."
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleAdvancedSave}
            className="bg-indigo-600 text-white font-semibold px-4 py-2 rounded hover:bg-indigo-500 transition disabled:opacity-60"
            disabled={saving}
          >
            Advanced Settings
          </button>
          <button
            onClick={refreshSettings}
            className="bg-gray-100 text-gray-700 font-semibold px-4 py-2 rounded hover:bg-gray-200 transition"
          >
            Discard changes
          </button>
        </div>
      </section>

      {settings && (
        <section className="bg-white border rounded shadow-sm p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Current settings</h3>
          <dl className="divide-y divide-gray-200 text-sm">
            <div className="py-2 flex justify-between">
              <dt className="text-gray-500">Maintenance mode</dt>
              <dd className="text-gray-900">{settings.maintenanceMode ? "Enabled" : "Disabled"}</dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-gray-500">Kernel target</dt>
              <dd className="text-gray-900">{settings.kernelTarget}</dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-gray-500">Agent Manager target</dt>
              <dd className="text-gray-900">{settings.agentManagerTarget}</dd>
            </div>
            <div className="py-2">
              <dt className="text-gray-500 mb-1">Advanced notes</dt>
              <dd className="text-gray-900 whitespace-pre-wrap">{settings.advancedNotes || "—"}</dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-gray-500">Last updated</dt>
              <dd className="text-gray-900">{settings.updatedAt}</dd>
            </div>
          </dl>
        </section>
      )}
    </main>
  );
}
