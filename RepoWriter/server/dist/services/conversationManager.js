/**
 * conversationManager.ts
 *
 * Simple conversation store for RepoWriter to support multi-turn planning and clarifying Q&A.
 *
 * Persistence:
 *  - Conversations are kept in-memory and periodically flushed to disk at .repowriter/conversations.json
 *  - On startup we attempt to load persisted conversations.
 *
 * CHANGE: persist outside the repo when REPOWRITER_DATA_DIR is set.
 */
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { broadcast } from "../ws/server.js";
import { REPO_PATH } from "../config.js";
const STORE_REL = ".repowriter/conversations.json";
const FLUSH_INTERVAL_MS = 5000;
let storePathCache = null;
function getStorePath() {
    if (storePathCache)
        return storePathCache;
    // If a dedicated data directory is configured, prefer it to keep runtime artifacts
    // out of the repository tree. Otherwise fall back to REPO_PATH (original behavior).
    let dataRoot = process.env.REPOWRITER_DATA_DIR || REPO_PATH;
    // If a relative path is supplied, resolve it relative to the repo root for determinism.
    if (!path.isAbsolute(dataRoot)) {
        dataRoot = path.resolve(REPO_PATH, dataRoot);
    }
    // Ensure we return an absolute path joining the desired data root and the store rel path.
    storePathCache = path.join(dataRoot, STORE_REL);
    return storePathCache;
}
let conversations = {};
let isDirty = false;
let flushTimer = null;
/** Load persisted conversations from disk (best-effort). */
export async function loadConversations() {
    const p = getStorePath();
    try {
        const raw = await fs.readFile(p, "utf8");
        const parsed = JSON.parse(raw);
        // Basic validation
        if (parsed && typeof parsed === "object") {
            conversations = parsed;
        }
    }
    catch {
        // ignore missing or parse errors
        conversations = {};
    }
}
/** Persist conversations to disk (atomic write). */
export async function flushConversations() {
    if (!isDirty)
        return;
    const p = getStorePath();
    try {
        await fs.mkdir(path.dirname(p), { recursive: true });
        const tmp = `${p}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(conversations, null, 2), "utf8");
        await fs.rename(tmp, p);
        isDirty = false;
    }
    catch (err) {
        // swallow for now; keep in-memory state
        try {
            await fs.writeFile(p, JSON.stringify(conversations, null, 2), "utf8");
            isDirty = false;
        }
        catch { }
    }
}
/** Schedule periodic flush */
function scheduleFlush() {
    if (flushTimer)
        return;
    flushTimer = setInterval(() => {
        flushConversations().catch(() => { });
    }, FLUSH_INTERVAL_MS);
    // Do not keep node alive just for flush timer
    if (typeof flushTimer.unref === "function")
        flushTimer.unref();
}
/** Create a new conversation with optional initial system message / title */
export function createConversation(opts = {}) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const conv = {
        id,
        title: opts.title,
        createdAt: now,
        updatedAt: now,
        messages: [],
        meta: opts.meta || {}
    };
    if (opts.initialSystem) {
        conv.messages.push({
            id: randomUUID(),
            author: "system",
            text: opts.initialSystem,
            createdAt: now,
            meta: {}
        });
    }
    conversations[id] = conv;
    isDirty = true;
    scheduleFlush();
    broadcastSafe("conversation:create", { conversation: conv });
    return conv;
}
/** Get a conversation by id */
export function getConversation(id) {
    return conversations[id] ?? null;
}
/** List all conversations (lightweight) */
export function listConversations() {
    return Object.values(conversations).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
/** Append a message to a conversation and broadcast update */
export function appendMessage(convId, msg) {
    const conv = conversations[convId];
    if (!conv)
        throw new Error("Conversation not found");
    const now = new Date().toISOString();
    const full = {
        id: randomUUID(),
        author: msg.author,
        role: msg.role,
        text: msg.text,
        createdAt: now,
        clarifying: !!msg.clarifying,
        meta: msg.meta || {}
    };
    conv.messages.push(full);
    conv.updatedAt = now;
    isDirty = true;
    scheduleFlush();
    broadcastSafe("conversation:update", { conversation: conv, message: full });
    return full;
}
/** Add a user message and return appended ConvMessage */
export function addUserMessage(convId, text, meta) {
    return appendMessage(convId, { author: "user", text, meta });
}
/** Add a model message (planner/assistant) */
export function addModelMessage(convId, text, opts = {}) {
    return appendMessage(convId, { author: "model", text, clarifying: !!opts.clarifying, meta: opts.meta, role: opts.role });
}
/** Update conversation meta */
export function updateConversationMeta(convId, meta) {
    const conv = conversations[convId];
    if (!conv)
        throw new Error("Conversation not found");
    conv.meta = Object.assign({}, conv.meta || {}, meta || {});
    conv.updatedAt = new Date().toISOString();
    isDirty = true;
    scheduleFlush();
    broadcastSafe("conversation:meta", { conversation: conv });
    return conv;
}
/** Remove conversation */
export function deleteConversation(convId) {
    delete conversations[convId];
    isDirty = true;
    scheduleFlush();
    broadcastSafe("conversation:delete", { id: convId });
}
/** Prune old conversations older than days */
export function pruneConversations(olderThanDays = 90) {
    const cutoff = Date.now() - olderThanDays * 24 * 3600 * 1000;
    for (const id of Object.keys(conversations)) {
        const conv = conversations[id];
        if (new Date(conv.updatedAt).getTime() < cutoff) {
            delete conversations[id];
            isDirty = true;
        }
    }
    if (isDirty) {
        scheduleFlush();
    }
}
/** Safe broadcast wrapper: non-fatal if broadcast fails */
function broadcastSafe(type, data) {
    try {
        broadcast(type, data);
    }
    catch {
        // ignore
    }
}
/** Initialize manager: load persisted state and start flush timer */
export async function initConversationManager() {
    try {
        await loadConversations();
    }
    catch {
        // ignore
    }
    scheduleFlush();
}
export default {
    initConversationManager,
    createConversation,
    getConversation,
    listConversations,
    appendMessage,
    addUserMessage,
    addModelMessage,
    updateConversationMeta,
    deleteConversation,
    pruneConversations,
    flushConversations
};
