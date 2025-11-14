import express, { Request, Response } from 'express';
import { NodeModel } from '../models/nodes';
import { EdgeModel } from '../models/edges';
import { TraceModel } from '../models/traces';

const nodeModel = new NodeModel();
const edgeModel = new EdgeModel();
const traceModel = new TraceModel();

export const createNode = (node) => {
  // Implement mTLS and RBAC checks here
  nodeModel.createNode(node);
};

export const createEdge = (edge) => {
  // Implement mTLS and RBAC checks here
  edgeModel.createEdge(edge);
};

export const createTrace = (trace) => {
  // Implement mTLS and RBAC checks here
  traceModel.createTrace(trace);
};

export const getNodes = () => nodeModel.getNodes();
export const getEdges = () => edgeModel.getEdges();
export const getTraces = () => traceModel.getTraces();

const apiRouter = express.Router();

export function helloHandler(_req: Request, res: Response) {
  res.json({ msg: 'hello' });
}

apiRouter.get('/api/hello', helloHandler);

export default apiRouter;
