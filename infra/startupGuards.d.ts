export type StartupGuardOptions = {
  serviceName?: string;
  logger?: {
    error: (msg: string) => void;
  };
  exit?: (code: number) => never;
};

export declare function enforceStartupGuards(options?: StartupGuardOptions): void;
