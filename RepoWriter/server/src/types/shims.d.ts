// server/src/types/shims.d.ts
// Lightweight shims for local dev to satisfy TypeScript for missing modules
// and internal module shapes. These are for local/dev only.

declare module "oidc-provider" {
  const OidcProvider: any;
  export { OidcProvider };
  export default OidcProvider;
}

declare module "supertest" {
  const supertest: any;
  export default supertest;
}

declare module "your-event-bus-library" {
  const EventBus: any;
  export { EventBus };
  export default EventBus;
}

declare module "stripe" {
  const Stripe: any;
  export default Stripe;
}

declare module "../services/patcher" {
  export function applyPatches(...args: any[]): any;
  export default { applyPatches: (...args:any[]) => any };
}

declare module "../services/sandboxRunner" {
  export function runTestsInSandbox(...args: any[]): any;
  export type SandboxOptions = any;
  export type SandboxResult = any;
  export type PatchInput = any;
  export default { runTestsInSandbox: (...args:any[]) => any };
}

declare module "../services/kernel" {
  const Kernel: any;
  export { Kernel };
  export default Kernel;
}

declare module "./kernel" {
  const Kernel: any;
  export { Kernel };
  export default Kernel;
}

declare module "ws" {
  export class WebSocketServer {
    constructor(...args:any[]);
    on(event: string, cb: any): void;
    clients: Set<any>;
  }
  export class WebSocket {
    constructor(...args:any[]);
    on(event: string, cb: any): void;
    readyState: number;
    send(...args: any[]): void;
    static OPEN: number;
  }
  const ws: any;
  export default ws;
}
