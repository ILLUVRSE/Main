import fs from 'fs';
import path from 'path';
import express from 'express';
import request from '../utils/mockSupertest';
import { Roles } from '../../src/rbac';
import createControlPanelRouter from '../../src/routes/controlPanelRoutes';

describe('controlPanelRoutes', () => {
  const testSettingsPath = path.join(__dirname, 'tmp-control-panel-settings.json');

  beforeEach(() => {
    process.env.CONTROL_PANEL_SETTINGS_PATH = testSettingsPath;
    if (fs.existsSync(testSettingsPath)) {
      fs.unlinkSync(testSettingsPath);
    }
  });

  afterEach(() => {
    delete process.env.KERNEL_CONTROL_URL;
    delete process.env.AGENT_MANAGER_CONTROL_URL;
    delete process.env.CONTROL_PANEL_SETTINGS_PATH;
    if (fs.existsSync(testSettingsPath)) {
      fs.unlinkSync(testSettingsPath);
    }
  });

  function buildApp(withPrincipal: boolean) {
    const app = express();
    app.use(express.json());
    if (withPrincipal) {
      app.use((req, _res, next) => {
        (req as any).principal = { id: 'test-user', type: 'human', roles: [Roles.SUPERADMIN] };
        next();
      });
    }
    app.use('/control-panel', createControlPanelRouter());
    return app;
  }

  it('rejects unauthenticated access', async () => {
    const app = buildApp(false);
    const res = await request(app).get('/control-panel/settings');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'unauthenticated');
  });

  it('returns default settings for authorized principal', async () => {
    const app = buildApp(true);
    const res = await request(app).get('/control-panel/settings');
    expect(res.status).toBe(200);
    expect(res.body.settings).toHaveProperty('maintenanceMode', false);
    expect(res.body.settings).toHaveProperty('updatedAt');
  });

  it('updates settings via POST', async () => {
    const app = buildApp(true);
    const res = await request(app)
      .post('/control-panel/settings')
      .send({ maintenanceMode: true, advancedNotes: 'Test note' });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ maintenanceMode: true, advancedNotes: 'Test note' });
    const persisted = JSON.parse(fs.readFileSync(testSettingsPath, 'utf8'));
    expect(persisted.maintenanceMode).toBe(true);
  });

  it('handles kernel action in stub mode when no upstream configured', async () => {
    const app = buildApp(true);
    const res = await request(app)
      .post('/control-panel/actions/kernel')
      .send({ action: 'ping' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      target: 'kernel',
      mode: 'stub',
    });
  });
});
