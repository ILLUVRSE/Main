import { NextFunction, Request, RequestHandler, Response } from 'express';
import { loadConfig } from '../config/env';
import logger from '../logger';

function extractRoles(req: Request, headerName: string): string[] {
  const raw = req.header(headerName) || req.header(headerName.toLowerCase());
  if (!raw) return [];
  return raw
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter((role) => role.length > 0);
}

function deny(res: Response) {
  return res.status(403).json({ error: 'forbidden' });
}

function requireRole(kind: 'check' | 'policy'): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const config = loadConfig();
    if (!config.rbacEnabled) {
      return next();
    }

    const allowedRoles = kind === 'policy' ? config.rbacPolicyRoles : config.rbacCheckRoles;
    if (!allowedRoles || allowedRoles.length === 0) {
      logger.warn('RBAC enabled but no allowed roles configured; defaulting to deny-all', { path: req.path });
      return deny(res);
    }

    const roles = extractRoles(req, config.rbacHeader);
    if (!roles.length) {
      logger.warn('RBAC denied request: missing roles header', { path: req.path, header: config.rbacHeader });
      return deny(res);
    }

    const isAllowed = roles.some((role) => allowedRoles.includes(role));
    if (!isAllowed) {
      logger.warn('RBAC denied request: role mismatch', { path: req.path, roles });
      return deny(res);
    }

    return next();
  };
}

export default {
  requireRole,
};
