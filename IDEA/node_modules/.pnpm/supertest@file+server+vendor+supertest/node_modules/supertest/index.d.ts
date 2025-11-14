import type { Server } from 'http';
import type { Express } from 'express';

export interface SupertestResponse {
  status: number;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  text: string;
}

export interface SupertestRequest extends Promise<SupertestResponse> {
  send(body?: any): SupertestRequest;
  set(name: string, value: string): SupertestRequest;
}

type AppLike = Express | Server | ((req: any, res: any) => void);

declare function request(app: AppLike): {
  get(url: string): SupertestRequest;
  post(url: string): SupertestRequest;
  put(url: string): SupertestRequest;
  delete(url: string): SupertestRequest;
};

export default request;
