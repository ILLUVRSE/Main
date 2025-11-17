import express, { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';
import auditWriter from '../lib/auditWriter';
import integrationService from '../lib/integrationService';
import paymentService from '../lib/paymentService';
import marketplaceService from '../lib/marketplaceService';

const router = express.Router();

/**
 * Note: Webhook endpoints often require the raw request body for signature verification.
 * Ensure the app registers a raw-body middleware for these routes in server.ts / index.ts:
 *
 *
 * If raw body isn't present, integrationService.verifyWebhookSignature should still try to use
 * the parsed body, but providers like Stripe require raw bytes.
 */

/**
 * POST /webhooks/:provider
 * Generic entrypoint for third-party webhook providers (stripe, github, etc).
 *
 * Provider-specific verification and dispatch is delegated to integrationService.
 */
router.post('/:provider', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { provider } = req.params;

    // Headers and raw body are passed to verifier. Some frameworks populate req.body as Buffer when using express.raw
    const headers = req.headers as Record<string, any>;
    const rawBody: Buffer | string | undefined = (req as any).rawBody ?? (typeof req.body === 'string' ? req.body : undefined);

    // Verify signature (integrationService should look up provider config and validate)
    const verified = await integrationService.verifyWebhookSignature(provider, { headers, rawBody });
    if (!verified || !verified.ok) {
      logger.warn('webhook.signature.invalid', { provider, reason: verified?.error });
      return res.status(400).json({ ok: false, error: 'invalid webhook signature' });
    }

    // Parse event payload. integrationService.normalizeWebhook should return { kind, payload, id, receivedAt }
    const normalized = await integrationService.normalizeWebhook(provider, { headers, rawBody, parsedBody: req.body });
    if (!normalized || !normalized.kind) {
      logger.warn('webhook.normalize.failed', { provider, info: normalized });
      return res.status(400).json({ ok: false, error: 'unsupported or malformed webhook' });
    }

    // Audit receipt of webhook
    await auditWriter.write({
      actor: `integration:${provider}`,
      action: 'integration.webhook.received',
      details: { provider, kind: normalized.kind, webhookId: normalized.id },
    });

    // Dispatch handling based on normalized.kind
    // Examples:
    // - payment.succeeded -> paymentService.handleProviderEvent(...)
    // - listing.file.virus_scan -> marketplaceService.handleFileScan(...)
    // integrationService may also provide a dispatch helper
    try {
      switch (normalized.kind) {
        case 'payment.succeeded':
        case 'payment.failed':
        case 'payment.refund':
        case 'payment.chargeback':
          await paymentService.handleProviderEvent(provider, normalized);
          break;

        case 'listing.file.virus_scan':
        case 'listing.file.processed':
        case 'listing.file.ready':
          await marketplaceService.handleFileEvent(provider, normalized);
          break;

        case 'integration.connected':
        case 'integration.disconnected':
          // let integrationService reconcile state
          await integrationService.handleEvent(provider, normalized);
          break;

        default:
          // Allow integrationService to handle unknown events, or log and ignore
          if (typeof integrationService.handleEvent === 'function') {
            await integrationService.handleEvent(provider, normalized);
          } else {
            logger.info('webhook.unknown.kind', { provider, kind: normalized.kind });
          }
      }
    } catch (dispatchErr) {
      logger.error('webhook.dispatch.failed', { err: dispatchErr, provider, kind: normalized.kind });
      // Let provider know we had an error so it may retry depending on its semantics
      return res.status(500).json({ ok: false, error: 'handler failed' });
    }

    // Success
    await auditWriter.write({
      actor: `integration:${provider}`,
      action: 'integration.webhook.processed',
      details: { provider, kind: normalized.kind, webhookId: normalized.id },
    });

    // Many providers expect a 200 with a simple body
    res.json({ ok: true });
  } catch (err) {
    logger.error('webhook.handler.failed', { err });
    // Don't leak internal errors; return generic 500
    next(err);
  }
});

export default router;

