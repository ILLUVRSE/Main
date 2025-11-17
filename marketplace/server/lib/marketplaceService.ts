import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';
import auditWriter from './auditWriter';
import userService from './userService';
import paymentService from './paymentService';
import settingsService from './settingsService';
import { Response } from 'express';

/**
 * Marketplace service
 *
 * Simple disk-backed implementation intended for development and tests.
 * Listings are stored in data/listings.json. Files referenced by listings may
 * point to local filesystem paths or external URLs. This service implements
 * the helpers used by the routes (search, create/update, admin workflow, downloads).
 */

type Visibility = 'public' | 'private' | 'unlisted';
type ListingStatus = 'pending' | 'published' | 'rejected' | 'archived';

interface ListingFile {
  id: string;
  name: string;
  path?: string; // local path
  url?: string; // external URL
  size?: number;
  metadata?: Record<string, any>;
}

interface ListingRecord {
  id: string;
  title: string;
  description?: string;
  price: number;
  currency: string;
  tags: string[];
  files: ListingFile[];
  visibility: Visibility;
  metadata?: Record<string, any>;
  authorId: string;
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
  authorDisplayName?: string | null;
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const LISTINGS_FILE = path.join(DATA_DIR, 'listings.json');

async function ensureDataDir() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    logger.warn('marketplace.ensureDataDir.failed', { err });
  }
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.promises.readFile(file, { encoding: 'utf-8' });
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    return fallback;
  }
}

async function writeJsonFile(file: string, data: any) {
  try {
    await ensureDataDir();
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
    await fs.promises.rename(tmp, file);
  } catch (err) {
    logger.error('marketplace.writeJsonFile.failed', { err, file });
    throw err;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function matchesText(listing: ListingRecord, q?: string) {
  if (!q) return true;
  const s = q.toLowerCase();
  if (listing.title.toLowerCase().includes(s)) return true;
  if ((listing.description || '').toLowerCase().includes(s)) return true;
  if ((listing.tags || []).some((t) => t.toLowerCase().includes(s))) return true;
  return false;
}

/**
 * Load / save helpers
 */
async function loadListings(): Promise<ListingRecord[]> {
  return await readJsonFile<ListingRecord[]>(LISTINGS_FILE, []);
}

async function saveListings(listings: ListingRecord[]) {
  await writeJsonFile(LISTINGS_FILE, listings);
}

/**
 * Normalize tags (strings -> lower-cased deduped array)
 */
function normalizeTags(tags?: string[]) {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map((t) => String(t || '').trim()).filter(Boolean))).map((t) => t.toLowerCase());
}

const marketplaceService = {
  /**
   * Admin: listListings with filters
   */
  async listListings(opts: { q?: string; page?: number; limit?: number; status?: string; author?: string } = {}) {
    const page = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.max(1, Math.min(500, Number(opts.limit ?? 25)));
    const q = opts.q ? String(opts.q) : undefined;
    const status = opts.status ? String(opts.status) : undefined;
    const author = opts.author ? String(opts.author) : undefined;

    const listings = await loadListings();

    let filtered = listings.slice();

    if (status) filtered = filtered.filter((l) => l.status === status);
    if (author) filtered = filtered.filter((l) => l.authorId === author);
    if (q) filtered = filtered.filter((l) => matchesText(l, q));

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    return { total, items };
  },

  /**
   * Public search with common filters
   */
  async searchListings(opts: {
    q?: string;
    page?: number;
    limit?: number;
    tags?: string[];
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
    visibility?: string;
  } = {}) {
    const page = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.max(1, Math.min(100, Number(opts.limit ?? 20)));
    const q = opts.q ? String(opts.q) : undefined;
    const tags = Array.isArray(opts.tags) ? opts.tags.map((t) => String(t).toLowerCase()) : undefined;
    const minPrice = typeof opts.minPrice === 'number' ? opts.minPrice : undefined;
    const maxPrice = typeof opts.maxPrice === 'number' ? opts.maxPrice : undefined;
    const sort = String(opts.sort || 'relevance');
    const visibility = String(opts.visibility || 'public');

    const listings = await loadListings();
    let filtered = listings.filter((l) => l.status === 'published');

    if (visibility === 'public') {
      filtered = filtered.filter((l) => l.visibility === 'public');
    } else if (visibility === 'unlisted') {
      filtered = filtered.filter((l) => l.visibility === 'public' || l.visibility === 'unlisted');
    }

    if (q) filtered = filtered.filter((l) => matchesText(l, q));
    if (tags && tags.length) {
      filtered = filtered.filter((l) => tags.every((t) => (l.tags || []).includes(t)));
    }
    if (typeof minPrice === 'number') filtered = filtered.filter((l) => l.price >= minPrice);
    if (typeof maxPrice === 'number') filtered = filtered.filter((l) => l.price <= maxPrice);

    // simple sorts
    if (sort === 'newest') {
      filtered.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    } else if (sort === 'price_asc') {
      filtered.sort((a, b) => a.price - b.price);
    } else if (sort === 'price_desc') {
      filtered.sort((a, b) => b.price - a.price);
    } // else keep relevance (insertion order)

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    return { total, items };
  },

  async getListing(id: string, opts: { includeFiles?: boolean; includeAudit?: boolean } = {}) {
    const listings = await loadListings();
    const found = listings.find((l) => l.id === id);
    if (!found) return null;

    // attach author displayName if possible
    let authorDisplayName = null;
    try {
      const author = await userService.getById(found.authorId);
      authorDisplayName = author?.displayName || null;
    } catch {
      authorDisplayName = null;
    }

    const copy = { ...found, authorDisplayName };
    if (!opts.includeFiles) {
      copy.files = (copy.files || []).map((f) => ({ id: f.id, name: f.name }));
    }
    // includeAudit can be implemented by reading auditWriter if needed.
    return copy;
  },

  async createListing(payload: {
    title: string;
    description?: string;
    price?: number;
    currency?: string;
    tags?: string[];
    files?: any[];
    visibility?: Visibility;
    metadata?: Record<string, any>;
    authorId: string;
  }) {
    const listings = await loadListings();
    const id = uuidv4();
    const now = nowIso();

    const tags = normalizeTags(payload.tags);

    // default visibility/price
    const price = typeof payload.price === 'number' && !Number.isNaN(payload.price) ? payload.price : 0;
    const currency = payload.currency || 'USD';
    const visibility = (payload.visibility as Visibility) || 'private';

    const files: ListingFile[] =
      Array.isArray(payload.files) && payload.files.length
        ? payload.files.map((f: any) => ({
            id: f.id || uuidv4(),
            name: f.name || f.filename || 'file',
            path: f.path,
            url: f.url,
            size: f.size,
            metadata: f.metadata || {},
          }))
        : [];

    // Default status: published for free items, else pending
    const status: ListingStatus = price === 0 ? 'published' : 'pending';
    const publishedAt = status === 'published' ? now : null;

    const listing: ListingRecord = {
      id,
      title: payload.title,
      description: payload.description || '',
      price,
      currency,
      tags,
      files,
      visibility,
      metadata: payload.metadata || {},
      authorId: payload.authorId,
      status,
      createdAt: now,
      updatedAt: now,
      publishedAt,
    };

    listings.push(listing);
    await saveListings(listings);

    await auditWriter.write({
      actor: payload.authorId,
      action: 'marketplace.listing.create',
      details: { listingId: id, title: payload.title },
    });

    return listing;
  },

  async updateListing(id: string, changes: Partial<ListingRecord>) {
    const listings = await loadListings();
    const idx = listings.findIndex((l) => l.id === id);
    if (idx === -1) return null;

    const before = listings[idx];
    const merged: ListingRecord = {
      ...before,
      ...changes,
      tags: changes.tags ? normalizeTags(changes.tags as string[]) : before.tags,
      files: Array.isArray(changes.files) ? (changes.files as ListingFile[]) : before.files,
      updatedAt: nowIso(),
    };

    listings[idx] = merged;
    await saveListings(listings);

    await auditWriter.write({
      actor: (changes as any).updatedBy || 'system',
      action: 'marketplace.listing.update',
      details: { listingId: id, changes: Object.keys(changes) },
    });

    return merged;
  },

  async listByAuthor(authorId: string, opts: { page?: number; limit?: number } = {}) {
    const page = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.max(1, Math.min(200, Number(opts.limit ?? 25)));

    const listings = await loadListings();
    const filtered = listings.filter((l) => l.authorId === authorId);
    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);
    return { total, items };
  },

  async userHasPurchasedListing(userId: string, listingId: string) {
    // Prefer paymentService helper if available
    try {
      if (paymentService && typeof (paymentService as any).userHasPurchasedListing === 'function') {
        return await (paymentService as any).userHasPurchasedListing(userId, listingId);
      }
    } catch (err) {
      logger.warn('marketplace.userHasPurchasedListing.paymentService.failed', { err });
    }

    // Fallback: inspect payments for succeeded/completed payments for user/listing
    try {
      if (paymentService && typeof (paymentService as any).listPaymentsForUser === 'function') {
        const res = await (paymentService as any).listPaymentsForUser(userId, { q: undefined, page: 1, limit: 1000 });
        const found = (res.items || []).some((p: any) => {
          const lid = p.metadata?.listingId || p.listingId;
          return lid === listingId && (p.status === 'succeeded' || p.status === 'completed');
        });
        return Boolean(found);
      }
    } catch (err) {
      logger.warn('marketplace.userHasPurchasedListing.fallback.failed', { err });
    }

    return false;
  },

  /**
   * Stream listing files to response. The handler is expected to send the response.
   * Options: { userId, res }
   *
   * Behavior:
   * - If a single file with local `path` exists -> use res.download
   * - If single file with external `url` -> redirect (302)
   * - If multiple local files -> attempt to stream the first file (zipping is not implemented)
   * - If multiple external urls -> return JSON with file urls
   */
  async streamListingFiles(listingId: string, opts: { userId?: string; res: Response }) {
    const listings = await loadListings();
    const listing = listings.find((l) => l.id === listingId);
    if (!listing) return null;
    const files = listing.files || [];
    if (files.length === 0) {
      return null;
    }

    const res = opts.res;

    // Prefer local path for direct download
    const local = files.find((f) => f.path && fs.existsSync(f.path));
    if (local && local.path) {
      try {
        await auditWriter.write({
          actor: opts.userId || 'system',
          action: 'marketplace.listing.download.prepare',
          details: { listingId: listingId, fileId: local.id, fileName: local.name },
        });
        // Use res.download to set headers and stream file
        return new Promise((resolve, reject) => {
          res.download(local.path as string, local.name, (err) => {
            if (err) {
              logger.error('marketplace.streamListingFiles.download.failed', { err, path: local.path });
              reject(err);
            } else {
              resolve(true);
            }
          });
        });
      } catch (err) {
        logger.error('marketplace.streamListingFiles.failed', { err });
        return null;
      }
    }

    // If first file has an external URL, redirect
    const first = files[0];
    if (first.url) {
      // Log and redirect
      await auditWriter.write({
        actor: opts.userId || 'system',
        action: 'marketplace.listing.download.redirect',
        details: { listingId: listingId, fileId: first.id, url: first.url },
      });
      res.redirect(first.url);
      return true;
    }

    // If multiple files and no local path or URL available for each file, return list
    const urls = files.map((f) => ({ id: f.id, name: f.name, url: f.url || null, path: f.path || null }));
    res.json({ ok: true, files: urls });
    return true;
  },

  async listTags(opts: { q?: string; limit?: number } = {}) {
    const q = opts.q ? String(opts.q).toLowerCase() : undefined;
    const limit = Math.max(1, Math.min(500, Number(opts.limit ?? 100)));
    const listings = await loadListings();
    const set = new Set<string>();
    for (const l of listings) {
      for (const t of l.tags || []) {
        if (!t) continue;
        if (q && !t.includes(q)) continue;
        set.add(t);
      }
    }
    const tags = Array.from(set).slice(0, limit);
    return tags;
  },

  async approveListing(id: string, opts: { approvedBy?: string; message?: string } = {}) {
    const listings = await loadListings();
    const idx = listings.findIndex((l) => l.id === id && l.status === 'pending');
    if (idx === -1) return null;
    listings[idx].status = 'published';
    listings[idx].publishedAt = nowIso();
    listings[idx].updatedAt = nowIso();
    await saveListings(listings);

    await auditWriter.write({
      actor: opts.approvedBy || 'admin',
      action: 'admin.marketplace.listing.approve',
      details: { listingId: id, message: opts.message || '' },
    });

    return listings[idx];
  },

  async rejectListing(id: string, opts: { rejectedBy?: string; reason?: string } = {}) {
    const listings = await loadListings();
    const idx = listings.findIndex((l) => l.id === id && l.status === 'pending');
    if (idx === -1) return null;
    listings[idx].status = 'rejected';
    listings[idx].updatedAt = nowIso();
    await saveListings(listings);

    await auditWriter.write({
      actor: opts.rejectedBy || 'admin',
      action: 'admin.marketplace.listing.reject',
      details: { listingId: id, reason: opts.reason || '' },
    });

    return listings[idx];
  },

  async publishListing(id: string, opts: { actor?: string; message?: string } = {}) {
    const listings = await loadListings();
    const idx = listings.findIndex((l) => l.id === id);
    if (idx === -1) return null;
    listings[idx].status = 'published';
    listings[idx].publishedAt = nowIso();
    listings[idx].updatedAt = nowIso();
    await saveListings(listings);

    await auditWriter.write({
      actor: opts.actor || 'admin',
      action: 'admin.marketplace.listing.publish',
      details: { listingId: id, message: opts.message || '' },
    });

    return listings[idx];
  },

  async unpublishListing(id: string, opts: { actor?: string; reason?: string; removeFromSearch?: boolean } = {}) {
    const listings = await loadListings();
    const idx = listings.findIndex((l) => l.id === id);
    if (idx === -1) return null;
    listings[idx].status = 'archived';
    listings[idx].updatedAt = nowIso();
    await saveListings(listings);

    await auditWriter.write({
      actor: opts.actor || 'admin',
      action: 'admin.marketplace.listing.unpublish',
      details: { listingId: id, reason: opts.reason || '', removeFromSearch: Boolean(opts.removeFromSearch) },
    });

    return true;
  },

  async deleteListing(id: string) {
    const listings = await loadListings();
    const idx = listings.findIndex((l) => l.id === id);
    if (idx === -1) return null;
    listings.splice(idx, 1);
    await saveListings(listings);

    await auditWriter.write({
      actor: 'admin',
      action: 'admin.marketplace.listing.delete',
      details: { listingId: id },
    });

    return true;
  },

  async handleFileEvent(provider: string, event: any) {
    // Simple handler: log and annotate listing metadata if possible.
    try {
      const listingId = event.payload?.listingId || event.payload?.meta?.listingId;
      if (!listingId) {
        logger.info('marketplace.handleFileEvent.noListing', { provider, event });
        return;
      }
      const listings = await loadListings();
      const idx = listings.findIndex((l) => l.id === listingId);
      if (idx === -1) return;
      // Merge metadata for file events
      listings[idx].metadata = { ...(listings[idx].metadata || {}), lastFileEvent: { provider, eventKind: event.kind, receivedAt: new Date().toISOString() } };
      listings[idx].updatedAt = nowIso();
      await saveListings(listings);

      await auditWriter.write({
        actor: `integration:${provider}`,
        action: 'marketplace.listing.file.event',
        details: { listingId, kind: event.kind },
      });
    } catch (err) {
      logger.error('marketplace.handleFileEvent.failed', { err, provider, event });
    }
  },

  async getAdminStats() {
    const listings = await loadListings();
    const total = listings.length;
    const byStatus: Record<string, number> = {};
    for (const l of listings) {
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    }

    // simple sales data via paymentService if available
    let sales = { totalSales: 0, totalRevenue: 0 };
    try {
      if (paymentService && typeof (paymentService as any).getStats === 'function') {
        sales = await (paymentService as any).getStats();
      }
    } catch (err) {
      logger.warn('marketplace.getAdminStats.paymentService.failed', { err });
    }

    const tags = await this.listTags({ limit: 50 });

    return {
      totalListings: total,
      byStatus,
      topTags: tags.slice(0, 20),
      sales,
    };
  },
};

export default marketplaceService;

