// kernel/test/integration/auth.integration.test.ts
import fs from 'fs';
import https from 'https';
import net from 'net';
import { URLSearchParams } from 'url';

const fetchAny: any = (globalThis as any).fetch ?? undefined;
if (!fetchAny) {
  throw new Error('global fetch is required (Node 18+).');
}
const fetch = fetchAny as typeof globalThis.fetch;

jest.setTimeout(180_000); // integration can take time

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://localhost:8080';
const KERNEL_URL = process.env.KERNEL_URL || 'https://localhost:3000';
const ADMIN_USER = process.env.KEYCLOAK_ADMIN || 'admin';
const ADMIN_PASS = process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin';
const REALM = process.env.TEST_REALM || 'testrealm';
const CLIENT_ID = process.env.TEST_CLIENT_ID || 'kernel-client';
const CLIENT_SECRET = process.env.TEST_CLIENT_SECRET || 'kernel-secret';
const TEST_USER = process.env.TEST_USER || 'itest-user';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'itest-password';

// For mTLS client call (host environment paths)
const CLIENT_CERT_PATH = process.env.KERNEL_MTLS_CLIENT_CERT_PATH || '/tmp/illuvrse-certs/kernel-client.crt';
const CLIENT_KEY_PATH = process.env.KERNEL_MTLS_CLIENT_KEY_PATH || '/tmp/illuvrse-certs/kernel-client.key';
const CLIENT_CA_PATH = process.env.KERNEL_MTLS_CA_PATH || '/tmp/illuvrse-certs/kernel-ca.crt';

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Wait for a URL to return HTTP OK using fetch. If URL is https and a CA file
 * exists, pass an https.Agent that trusts that CA so self-signed server certs work.
 */
async function waitForUrl(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetchWithAgent(url, { method: 'GET' } as any);
      if (res.ok) return;
    } catch (e) {
      // ignore and retry
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

/**
 * Wait for a TCP port to accept a connection.
 */
async function waitForPort(host: string, port: number, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.createConnection({ host, port }, () => {
        s.end();
        resolve(true);
      });
      s.on('error', () => resolve(false));
      // safety: close after short window
      setTimeout(() => {
        try { s.destroy(); } catch {}
        resolve(false);
      }, 1000).unref();
    });
    if (ok) return;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${host}:${port}`);
}

/**
 * Helper to call fetch and, for https URLs, attach an https.Agent that trusts the
 * test CA (if available). Minimal: if CA file missing, use default TLS root store.
 */
async function fetchWithAgent(url: string, opts: any = {}) {
  const finalOpts = Object.assign({}, opts);
  if (url.startsWith('https:')) {
    try {
      if (fs.existsSync(CLIENT_CA_PATH)) {
        const ca = fs.readFileSync(CLIENT_CA_PATH);
        finalOpts.agent = new https.Agent({ ca, rejectUnauthorized: true });
      }
    } catch (e) {
      // ignore and try without custom CA
    }
  }
  return fetch(url, finalOpts as any);
}

async function getAdminToken() {
  const tokenUrl = `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: ADMIN_USER,
    password: ADMIN_PASS,
  });
  const res = await fetchWithAgent(tokenUrl, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  } as any);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to fetch admin token: ${res.status} ${txt}`);
  }
  const j: any = await res.json();
  if (!j.access_token) throw new Error('admin token response missing access_token');
  return j.access_token as string;
}

async function ensureRealmAndClient(adminToken: string) {
  const realmUrl = `${KEYCLOAK_URL}/admin/realms/${REALM}`;
  const rc = await fetchWithAgent(realmUrl, { method: 'GET', headers: { Authorization: `Bearer ${adminToken}` } } as any);
  if (!rc.ok) {
    await fetchWithAgent(`${KEYCLOAK_URL}/admin/realms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ realm: REALM, enabled: true }),
    } as any);
  }

  const clientsRes = await fetchWithAgent(
    `${KEYCLOAK_URL}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}`,
    { method: 'GET', headers: { Authorization: `Bearer ${adminToken}` } } as any
  );
  const clients: any = await clientsRes.json();
  if (Array.isArray(clients) && clients.length > 0) {
    const uuid = clients[0].id;
    await fetchWithAgent(`${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${uuid}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    } as any);
  }

  const clientPayload = {
    clientId: CLIENT_ID,
    enabled: true,
    publicClient: false,
    protocol: 'openid-connect',
    redirectUris: ['*'],
    clientAuthenticatorType: 'client-secret',
    secret: CLIENT_SECRET,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: false,
  };
  const createRes = await fetchWithAgent(`${KEYCLOAK_URL}/admin/realms/${REALM}/clients`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(clientPayload),
  } as any);
  if (![200, 201, 204].includes(createRes.status)) {
    const t = await createRes.text();
    throw new Error(`Failed to create client: ${createRes.status} ${t}`);
  }
}

async function ensureRole(adminToken: string, roleName: string) {
  const roleRes = await fetchWithAgent(`${KEYCLOAK_URL}/admin/realms/${REALM}/roles/${encodeURIComponent(roleName)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` },
  } as any);
  if (roleRes.ok) return;
  const create = await fetchWithAgent(`${KEYCLOAK_URL}/admin/realms/${REALM}/roles`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: roleName }),
  } as any);
  if (![200, 201, 204].includes(create.status)) {
    const t = await create.text();
    throw new Error(`Failed to create role ${roleName}: ${create.status} ${t}`);
  }
}

async function ensureUserWithRole(adminToken: string, username: string, password: string, roleName: string) {
  const usersRes = await fetchWithAgent(`${KEYCLOAK_URL}/admin/realms/${REALM}/users?username=${encodeURIComponent(username)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` },
  } as any);
  const users: any = await usersRes.json();
  let userId: string | undefined = undefined;
  if (Array.isArray(users) && users.length > 0) {
    userId = users[0].id;
  } else {
    const createRes = await fetchWithAgent(`${KEYCLOAK_URL}/admin/realms/${REALM}/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, enabled: true }),
    } as any);
    if (![200, 201, 204].includes(createRes.status)) {
      const t = await createRes.text();
      throw new Error(`Failed to create user: ${createRes.status} ${t}`);
    }
    const usersRes2 = await fetchWithAgent(`${KEYCLOAK_URL}/admin/realms/${REALM}/users?username=${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    } as any);
    const users2: any = await usersRes2.json();
    if (!Array.isArray(users2) || users2.length === 0) throw new Error('Could not find created user');
    userId = users2[0].id;
  }

  const pwdRes = await fetchWithAgent(`${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}/reset-password`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'password', value: password, temporary: false }),
  } as any);
  if (![200, 204].includes(pwdRes.status)) {
    const t = await pwdRes.text();
    throw new Error(`Failed to set password: ${pwdRes.status} ${t}`);
  }

  await ensureRole(adminToken, roleName);
  const roleResp = await fetchWithAgent(`${KEYCLOAK_URL}/admin/realms/${REALM}/roles/${encodeURIComponent(roleName)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` },
  } as any);
  const roleRep: any = await roleResp.json();

  const assignRes = await fetchWithAgent(`${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}/role-mappings/realm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([roleRep]),
  } as any);
  if (![200, 201, 204].includes(assignRes.status)) {
    const t = await assignRes.text();
    throw new Error(`Failed to assign role: ${assignRes.status} ${t}`);
  }
}

async function getUserToken(username: string, password: string) {
  const tokenUrl = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    username,
    password,
  });
  const res = await fetchWithAgent(tokenUrl, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  } as any);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Failed to get user token: ${res.status} ${t}`);
  }
  const j: any = await res.json();
  if (!j.access_token) throw new Error('token response missing access_token');
  return j.access_token as string;
}

function httpsGetWithClientCert(url: string, certPath: string, keyPath: string, caPath: string) {
  return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const urlObj = new URL(url);
    const opt: any = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      ca: fs.readFileSync(caPath),
      rejectUnauthorized: true,
    };
    const req = https.request(opt, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => {
        resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', (e) => reject(e));
    req.end();
  });
}

describe('OIDC + mTLS integration against compose stack', () => {
  beforeAll(async () => {
    // Wait Keycloak reachable + discovery
    await waitForUrl(`${KEYCLOAK_URL}/`);
    await waitForUrl(`${KEYCLOAK_URL}/realms/${REALM}/.well-known/openid-configuration`, 60_000);

    // Wait for the kernel TCP port to be open (avoids TLS handshakes)
    await waitForPort('localhost', 3000, 60_000);
  });

  test('valid OIDC JWT from Keycloak allows access to require-roles (Operator)', async () => {
    const adminToken = await getAdminToken();
    await ensureRealmAndClient(adminToken);
    await ensureUserWithRole(adminToken, TEST_USER, TEST_PASSWORD, 'Operator');

    await sleep(1000);

    const token = await getUserToken(TEST_USER, TEST_PASSWORD);

    const res = await fetchWithAgent(`${KERNEL_URL}/require-roles`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    } as any);
    const body: any = await res.json().catch(() => null);
    expect(res.status).toBe(200);
    expect(body).toBeDefined();
    expect(body.ok).toBe(true);
    expect(body.principal).toBeDefined();
    expect(body.principal.type).toBe('human');
    expect(Array.isArray(body.principal.roles)).toBe(true);
    expect(body.principal.roles).toEqual(expect.arrayContaining(['Operator']));
  });

  test('mTLS client cert call results in service principal (require-any)', async () => {
    for (const p of [CLIENT_CERT_PATH, CLIENT_KEY_PATH, CLIENT_CA_PATH]) {
      if (!fs.existsSync(p)) {
        throw new Error(`mTLS test requires cert at ${p} (set KERNEL_MTLS_CLIENT_CERT_PATH / KEY / CA env vars)`);
      }
    }

    let url = `${KERNEL_URL.replace(/^http:/i, 'https:')}/require-any`;

    const { statusCode, body } = await httpsGetWithClientCert(url, CLIENT_CERT_PATH, CLIENT_KEY_PATH, CLIENT_CA_PATH);
    expect(statusCode).toBe(200);
    const json: any = JSON.parse(body);
    expect(json.ok).toBe(true);
    expect(json.principal).toBeDefined();
    expect(json.principal.type).toBe('service');
  });
});

