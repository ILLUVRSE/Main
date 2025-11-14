// Type definitions for sandbox/validator results used across the server

export interface SandboxResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  exitCode?: number | null;
  sandboxPath?: string | undefined;
  error?: string | undefined;
}

export interface ValidateResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  exitCode?: number | null;
  sandboxPath?: string | undefined;
  error?: string | undefined;
}

export interface ValidateOptions {
  testCommand?: string[]; // e.g. ['npm', 'test']
  timeoutMs?: number;
  keepSandbox?: boolean;
}

export type PatchInput = {
  path: string;
  content?: string;
  diff?: string;
};

