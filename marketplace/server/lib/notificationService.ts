import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import logger from './logger';
import settingsService from './settingsService';
import auditWriter from './auditWriter';

type EmailOptions = {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  headers?: Record<string, string>;
};

type StoredNotification = {
  id: string;
  kind: 'email' | string;
  payload: any;
  createdAt: string;
  status: 'queued' | 'sent' | 'failed';
  lastError?: string | null;
};

const DATA_DIR = path.join(__dirname, '..', 'data');
const NOTIFS_FILE = path.join(DATA_DIR, 'notifications.json');

/**
 * Ensure data dir exists for fallback store
 */
async function ensureDataDir() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    logger.warn('notification.ensureDataDir.failed', { err });
  }
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.promises.readFile(file, { encoding: 'utf-8' });
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
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
    logger.error('notification.writeJsonFile.failed', { err, file });
    throw err;
  }
}

/**
 * Load stored notifications (fallback store)
 */
async function loadNotifications(): Promise<StoredNotification[]> {
  return await readJsonFile<StoredNotification[]>(NOTIFS_FILE, []);
}

async function saveNotifications(items: StoredNotification[]) {
  await ensureDataDir();
  await writeJsonFile(NOTIFS_FILE, items);
}

/**
 * Create a nodemailer transport from settings if configured.
 * Supports:
 *  - smtp: { host, port, secure, auth: { user, pass } }
 *  - or a sendgrid-like api via nodemailer-sendgrid-transport if present (not implemented)
 *
 * If no SMTP config present we return null and callers should fallback to logging/store.
 */
async function createTransport(): Promise<nodemailer.Transporter | null> {
  try {
    // Look for common settings locations
    const smtpCfg = (await settingsService.get('integrations.smtp')) || (await settingsService.get('smtp')) || null;
    if (!smtpCfg || typeof smtpCfg !== 'object') {
      return null;
    }

    const host = smtpCfg.host || smtpCfg.hostname;
    const port = smtpCfg.port ? Number(smtpCfg.port) : undefined;
    const secure = typeof smtpCfg.secure !== 'undefined' ? Boolean(smtpCfg.secure) : port === 465;
    const auth = smtpCfg.auth || smtpCfg.credentials || smtpCfg;

    if (!host || !auth || !auth.user || !auth.pass) {
      logger.warn('notification.smtp.config.incomplete', { smtpCfg });
      return null;
    }

    const transporter = nodemailer.createTransport({
      host,
      port: port || 587,
      secure,
      auth: {
        user: auth.user,
        pass: auth.pass,
      },
      // allow custom tls options if provided
      tls: smtpCfg.tls || undefined,
    } as any);

    // Verify transport readiness (best-effort; do not throw for verification failure)
    try {
      await transporter.verify();
      logger.info('notification.smtp.transport_verified', { host, port });
    } catch (err) {
      logger.warn('notification.smtp.verify.failed', { err, host, port });
    }

    return transporter;
  } catch (err) {
    logger.error('notification.createTransport.failed', { err });
    return null;
  }
}

/**
 * Send an email. Attempts to use SMTP transport if configured; otherwise logs and stores as fallback.
 */
async function sendEmail(opts: EmailOptions) {
  const now = new Date().toISOString();
  const transporter = await createTransport();

  const from = opts.from || (await settingsService.get('app'))?.fromEmail || `noreply@${(await settingsService.get('app'))?.name?.replace(/\s+/g, '').toLowerCase() || 'illuvrse'}.local`;

  const mail = {
    from,
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    headers: opts.headers,
  };

  // Try to send via SMTP if available
  if (transporter) {
    try {
      const result = await transporter.sendMail(mail as any);
      await auditWriter.write({
        actor: 'system',
        action: 'notification.email.sent',
        details: { to: opts.to, subject: opts.subject, providerResult: result },
      });
      logger.info('notification.email.sent', { to: opts.to, subject: opts.subject });
      return { ok: true, providerResult: result };
    } catch (err: any) {
      logger.error('notification.email.send.failed', { err, to: opts.to, subject: opts.subject });
      // Fallthrough to store failure
      const stored: StoredNotification = {
        id: `failed-${Date.now()}`,
        kind: 'email',
        payload: { mail, error: String(err) },
        createdAt: now,
        status: 'failed',
        lastError: String(err),
      };
      try {
        const items = await loadNotifications();
        items.push(stored);
        await saveNotifications(items);
      } catch (e) {
        logger.warn('notification.email.store_failed', { e });
      }

      await auditWriter.write({
        actor: 'system',
        action: 'notification.email.failed',
        details: { to: opts.to, subject: opts.subject, error: String(err) },
      });

      return { ok: false, error: String(err) };
    }
  }

  // No SMTP configured - fallback: log and store in notifications.json
  try {
    const id = `store-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const stored: StoredNotification = {
      id,
      kind: 'email',
      payload: { mail },
      createdAt: now,
      status: 'queued',
      lastError: null,
    };
    const items = await loadNotifications();
    items.push(stored);
    await saveNotifications(items);

    logger.info('notification.email.stored', { id, to: opts.to, subject: opts.subject });

    await auditWriter.write({
      actor: 'system',
      action: 'notification.email.queued',
      details: { id, to: opts.to, subject: opts.subject },
    });

    return { ok: true, storedId: id };
  } catch (err) {
    logger.error('notification.email.store.failed', { err });
    return { ok: false, error: 'store_failed' };
  }
}

/**
 * Simple templating helper (very small) — replaces {{key}} with values from params.
 */
function renderTemplate(template: string, params: Record<string, any> = {}) {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {
    const parts = key.split('.');
    let cur: any = params;
    for (const p of parts) {
      if (!cur) return '';
      cur = cur[p];
    }
    return cur == null ? '' : String(cur);
  });
}

/**
 * Send a templated email. Templates may be provided inline via settings under
 * 'email.templates' or callers can provide a plain text/html template strings.
 *
 * templateName may be one of the keys in settings.integrations.email.templates
 * or it may be a raw template object: { subject, text, html }.
 */
async function sendTemplatedEmail(
  to: string | string[],
  templateNameOrObject: string | { subject?: string; text?: string; html?: string },
  params: Record<string, any> = {},
  opts: { from?: string; cc?: string | string[]; bcc?: string | string[] } = {}
) {
  let template: any = null;
  if (typeof templateNameOrObject === 'string') {
    const templates = (await settingsService.get('email'))?.templates || (await settingsService.get('integrations.email'))?.templates || {};
    template = templates[templateNameOrObject] || null;
    if (!template) {
      // Not found - treat name as subject fallback
      template = { subject: templateNameOrObject, text: '', html: '' };
    }
  } else {
    template = templateNameOrObject;
  }

  const subject = renderTemplate(template.subject || '', params);
  const text = template.text ? renderTemplate(template.text, params) : undefined;
  const html = template.html ? renderTemplate(template.html, params) : undefined;

  return await sendEmail({
    to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject,
    text,
    html,
    from: opts.from,
  });
}

/**
 * Administrative helpers for queued notifications (e.g., resend stored items)
 */
const notificationService = {
  sendEmail,
  sendTemplatedEmail,

  async listStored(limit = 100) {
    const items = await loadNotifications();
    return items.slice(-limit).reverse();
  },

  async resendStored(id: string) {
    const items = await loadNotifications();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    const rec = items[idx];
    if (rec.kind === 'email' && rec.payload && rec.payload.mail) {
      try {
        const mail = rec.payload.mail;
        const transporter = await createTransport();
        if (!transporter) {
          throw new Error('no transport available');
        }
        const result = await transporter.sendMail(mail);
        rec.status = 'sent';
        rec.lastError = null;
        await saveNotifications(items);

        await auditWriter.write({
          actor: 'system',
          action: 'notification.email.resend',
          details: { id, result },
        });

        return { ok: true, result };
      } catch (err: any) {
        rec.status = 'failed';
        rec.lastError = String(err);
        await saveNotifications(items);
        await auditWriter.write({
          actor: 'system',
          action: 'notification.email.resend_failed',
          details: { id, error: String(err) },
        });
        return { ok: false, error: String(err) };
      }
    }
    return null;
  },
};

export default notificationService;

