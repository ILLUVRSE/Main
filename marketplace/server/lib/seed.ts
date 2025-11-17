/**
 * Simple dev-time seeding helpers for the marketplace.
 *
 * Run with `node -r ts-node/register server/lib/seed.ts` during development,
 * or import and call `seed()` from a startup script. This will create:
 *  - an admin user (if not present)
 *  - a sample buyer user
 *  - a sample listing (free & paid)
 *  - a sample integration entry (stripe-like)
 *
 * The script is intentionally idempotent and safe for repeated runs.
 */

import userService from './userService';
import settingsService from './settingsService';
import marketplaceService from './marketplaceService';
import integrationService from './integrationService';
import logger from './logger';

async function ensureAdminUser() {
  const adminEmail = process.env.DEV_ADMIN_EMAIL || 'admin@illuvrse.local';
  try {
    // Try to find by listing users (naive)
    const users = await userService.list({ q: adminEmail, page: 1, limit: 5 });
    const found = users.items.find((u: any) => u.email === adminEmail);
    if (found) {
      logger.info('seed.admin.exists', { email: adminEmail, id: found.id });
      return found;
    }
  } catch (err) {
    // ignore
  }

  // Create admin user
  try {
    const admin = await userService.createUser({
      email: adminEmail,
      displayName: 'Administrator',
      roles: ['admin', 'user'],
      metadata: { seeded: true },
    });

    // Create a session for convenience (long lived)
    const session = await userService.createSession(admin.id, 60 * 60 * 24 * 7);
    logger.info('seed.admin.created', { email: adminEmail, id: admin.id, session });
    return admin;
  } catch (err) {
    logger.error('seed.admin.create_failed', { err });
    throw err;
  }
}

async function ensureSampleUsers() {
  const buyerEmail = process.env.DEV_BUYER_EMAIL || 'buyer@illuvrse.local';
  try {
    const users = await userService.list({ q: buyerEmail, page: 1, limit: 5 });
    const found = users.items.find((u: any) => u.email === buyerEmail);
    if (found) {
      logger.info('seed.buyer.exists', { email: buyerEmail, id: found.id });
      return found;
    }
  } catch (err) {
    // ignore
  }

  try {
    const buyer = await userService.createUser({
      email: buyerEmail,
      displayName: 'Sample Buyer',
      roles: ['user'],
      metadata: { seeded: true },
    });
    logger.info('seed.buyer.created', { email: buyerEmail, id: buyer.id });
    return buyer;
  } catch (err) {
    logger.error('seed.buyer.create_failed', { err });
    throw err;
  }
}

async function ensureSettings() {
  try {
    const app = await settingsService.get('app');
    if (!app) {
      await settingsService.update({
        app: { name: 'ILLUVRSE Marketplace (Dev)', env: 'development', fromEmail: 'noreply@illuvrse.local' },
      });
      logger.info('seed.settings.app.created');
    } else {
      logger.info('seed.settings.app.ok', { app });
    }

    const admin = await settingsService.get('admin');
    if (!admin || (admin && typeof admin.apiKey === 'undefined' || admin.apiKey === null)) {
      await settingsService.update({ admin: { apiKey: process.env.ADMIN_API_KEY || 'dev_admin_api_key_change_me' } });
      logger.info('seed.settings.admin.apikey.set');
    }
  } catch (err) {
    logger.error('seed.settings.failed', { err });
  }
}

async function ensureSampleListing(authorId: string) {
  try {
    // look for existing sample by title
    const found = await marketplaceService.searchListings({ q: 'Sample Free Asset', page: 1, limit: 5, visibility: 'public' });
    if (found && found.items && found.items.length > 0) {
      logger.info('seed.listing.free.exists', { title: 'Sample Free Asset' });
    } else {
      const listing = await marketplaceService.createListing({
        title: 'Sample Free Asset',
        description: 'A free sample asset for local development and testing.',
        price: 0,
        currency: 'USD',
        tags: ['sample', 'free'],
        files: [],
        visibility: 'public',
        authorId,
      });
      logger.info('seed.listing.free.created', { id: listing.id, title: listing.title });
    }

    const paidFound = await marketplaceService.searchListings({ q: 'Sample Paid Asset', page: 1, limit: 5, visibility: 'public' });
    if (paidFound && paidFound.items && paidFound.items.length > 0) {
      logger.info('seed.listing.paid.exists', { title: 'Sample Paid Asset' });
    } else {
      const listing = await marketplaceService.createListing({
        title: 'Sample Paid Asset',
        description: 'A paid sample asset. Use this to exercise purchase flows.',
        price: 9.99,
        currency: 'USD',
        tags: ['sample', 'paid'],
        files: [],
        visibility: 'public',
        authorId,
      });
      logger.info('seed.listing.paid.created', { id: listing.id, title: listing.title });
    }
  } catch (err) {
    logger.error('seed.listing.failed', { err });
  }
}

async function ensureIntegration() {
  try {
    const list = await integrationService.list({ q: 'stripe', page: 1, limit: 5 });
    if (list.total > 0) {
      logger.info('seed.integration.exists', { kind: 'stripe' });
      return;
    }

    const created = await integrationService.create({
      name: 'stripe',
      kind: 'stripe',
      config: { webhookSecret: process.env.DEV_STRIPE_SECRET || 'whsec_dev_change_me', apiKey: 'sk_test_dev' },
      active: true,
      createdBy: 'seed',
    });
    logger.info('seed.integration.created', { id: created.id, name: created.name });
  } catch (err) {
    logger.error('seed.integration.failed', { err });
  }
}

export async function seed() {
  try {
    logger.info('seed.starting');
    await ensureSettings();
    const admin = await ensureAdminUser();
    const buyer = await ensureSampleUsers();
    await ensureSampleListing(admin.id);
    await ensureIntegration();

    logger.info('seed.complete', { admin: admin?.email, buyer: buyer?.email });
    return true;
  } catch (err) {
    logger.error('seed.failed', { err });
    return false;
  }
}

// If run directly, execute seeding.
if (require.main === module) {
  (async () => {
    try {
      await seed();
      process.exit(0);
    } catch (err) {
      logger.error('seed.cli.failed', { err });
      process.exit(1);
    }
  })();
}

export default { seed };

