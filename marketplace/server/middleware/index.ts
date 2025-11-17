/**
 * Aggregator for commonly used middleware so callers can import from a single path.
 *
 * Example:
 *   import { requireAuth, requireAdmin, rateLimit, requestLogger } from '../middleware';
 */

export { requireAuth, optionalAuth, ensureRole } from './auth';
export { requireAdmin } from './adminAuth';
export { rateLimit } from './rateLimit';
export { requestLogger } from './requestLogger';

