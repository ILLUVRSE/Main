import { Server } from 'http';

export interface KernelMockOptions {
  port?: number;
}

export function createKernelMockServer(options?: KernelMockOptions): Server;
