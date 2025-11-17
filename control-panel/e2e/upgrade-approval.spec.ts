/**
 * control-panel/e2e/upgrade-approval.spec.ts
 *
 * Playwright e2e template: "Upgrade approval -> apply" (3-of-5 multisig)
 *
 * Notes:
 *  - This file mocks the server-side Kernel API inside the test using page.route().
 *    That makes the test self-contained and safe to run locally without backend infra.
 *  - The test simulates three distinct approvers signing an upgrade, then verifying
 *    that the "Apply" action becomes available and results in an "applied" status.
 *  - Adjust selectors (getByRole/getByText/getByTestId) to match your app.
 *  - If you want to run against a real staging stack, remove the route mocks and
 *    set PLAYWRIGHT_BASE_URL to point at your instance (and ensure auth works).
 */

import { test, expect, Page } from '@playwright/test';

test.describe('Control-Panel upgrade approval + apply', () => {
  // In-test "server" state for the upgrade. Tests mutate this state via the mocked endpoints below.
  const upgradeId = 'upgrade-123';
  const requiredApprovals = 3;

  // Upgrade state (mock)
  let upgradeState = {
    id: upgradeId,
    title: 'Critical security patch',
    status: 'pending', // pending | applied | apply_failed
    approvals: [] as string[], // actor emails who approved
    requiredApprovals,
    manifest: { /* optional manifest payload */ },
    auditEvents: [] as any[],
  };

  // Current "logged-in" user (used by the mocked /api/session)
  let currentUser = { email: 'approver1@example.com', name: 'Approver One', roles: ['kernel-approver'] };

  // Helper: set current mocked user and reload page
  async function loginAs(page: Page, user: { email: string; name?: string; roles?: string[] }) {
    currentUser = { email: user.email, name: user.name ?? user.email.split('@')[0], roles: user.roles ?? ['kernel-approver'] };
    // Reload so page will call /api/session again (mocked below)
    await page.reload();
  }

  // Register mocked Kernel and session routes for each test.
  test.beforeEach(async ({ page }) => {
    // Reset mock state for each test
    upgradeState = {
      id: upgradeId,
      title: 'Critical security patch',
      status: 'pending',
      approvals: [],
      requiredApprovals,
      manifest: { notes: 'Fix CVE-XXXX' },
      auditEvents: [],
    };
    currentUser = { email: 'approver1@example.com', name: 'Approver One', roles: ['kernel-approver'] };

    // Mock: session endpoint used by the Control-Panel to identify the current operator.
    // Adjust path if your app uses a different session endpoint.
    await page.route('**/api/session', async (route) => {
      const body = { ok: true, user: currentUser };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });

    // Mock: GET upgrade detail
    await page.route(`**/api/kernel/upgrades/${upgradeId}`, async (route) => {
      if (route.request().method() === 'GET') {
        const body = {
          ok: true,
          upgrade: upgradeState,
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
        return;
      }
      // Fallback
      await route.continue();
    });

    // Mock: POST approve
    await page.route(`**/api/kernel/upgrades/${upgradeId}/approve`, async (route) => {
      try {
        const req = route.request();
        const dataText = await req.postData();
        let body = {};
        try { body = dataText ? JSON.parse(dataText) : {}; } catch { /* ignore */ }
        // actor may be provided in body, or we use currentUser
        const actor: string = (body && (body as any).actor) || currentUser.email;
        if (!upgradeState.approvals.includes(actor)) {
          upgradeState.approvals.push(actor);
          // record a mock audit event
          upgradeState.auditEvents.push({
            id: `audit-${upgradeState.approvals.length}`,
            event_type: 'upgrade.approve',
            actor,
            ts: new Date().toISOString(),
            signature: 'mock-signature',
          });
        }
        const resBody = { ok: true, upgrade: upgradeState };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(resBody),
        });
      } catch (err) {
        await route.fulfill({ status: 500, body: 'mock error' });
      }
    });

    // Mock: POST apply
    await page.route(`**/api/kernel/upgrades/${upgradeId}/apply`, async (route) => {
      // only allow apply when approvals >= requiredApprovals
      if (upgradeState.approvals.length < upgradeState.requiredApprovals) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: { message: 'Insufficient approvals' } }),
        });
        return;
      }
      // Simulate applying
      upgradeState.status = 'applied';
      upgradeState.auditEvents.push({
        id: `audit-apply`,
        event_type: 'upgrade.apply',
        actor: currentUser.email,
        ts: new Date().toISOString(),
        signature: 'mock-apply-signature',
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, upgrade: upgradeState }),
      });
    });

    // Optionally mock: audit listing endpoint used by UI
    await page.route(`**/api/kernel/upgrades/${upgradeId}/audit`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, audit: upgradeState.auditEvents }),
      });
    });

    // Navigate to upgrade detail page
    const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
    await page.goto(`${base}/upgrades/${upgradeId}`);
  });

  test('3 approvers approve -> apply becomes available -> upgrade applied', async ({ page }) => {
    // Helper to perform approval as a specific user
    async function approveAs(userEmail: string) {
      // Switch the mocked "current user" to this actor
      await loginAs(page, { email: userEmail, name: userEmail.split('@')[0], roles: ['kernel-approver'] });

      // Wait for page to show upgrade title (adjust selector as needed)
      await expect(page.getByRole('heading', { name: /Critical security patch/i })).toBeVisible();

      // Click "Approve" button
      // Replace selector below with the actual selector used by your UI.
      // Example uses role/button with name 'Approve'.
      const approveButton = page.getByRole('button', { name: /Approve/i });
      await expect(approveButton).toBeVisible({ timeout: 5000 });
      await approveButton.click();

      // Wait for the mocked approve network call to complete and for UI to refresh status.
      // The UI may re-fetch the upgrade detail; wait for the approvals count to be updated.
      // Because we control the mock, verify the in-memory state changed:
      await page.waitForTimeout(250); // give UI a moment to re-render (tweak if needed)
    }

    // Approve as three distinct approvers
    await approveAs('approver1@example.com');
    expect(upgradeState.approvals.length).toBe(1);

    await approveAs('approver2@example.com');
    expect(upgradeState.approvals.length).toBe(2);

    await approveAs('approver3@example.com');
    expect(upgradeState.approvals.length).toBe(3);

    // At this point, requiredApprovals == 3, so the UI should show the "Apply" button.
    // Wait for Apply button to appear and click it.
    const applyButton = page.getByRole('button', { name: /Apply/i });
    await expect(applyButton).toBeVisible({ timeout: 5000 });
    await applyButton.click();

    // After clicking apply, the mocked /apply sets status='applied'
    // Wait for UI to reflect applied state (adjust selector below)
    await expect(page.getByText(/Status:.*Applied/i)).toBeVisible({ timeout: 5000 })
      .catch(async () => {
        // If your UI shows status in a different location, try a general check of the mock state
        if (upgradeState.status !== 'applied') {
          throw new Error('Upgrade did not reach applied state');
        }
      });

    // Verify audit events included the apply event
    const applyAudit = upgradeState.auditEvents.find((e) => e.event_type === 'upgrade.apply');
    expect(applyAudit).toBeTruthy();
    expect(applyAudit.actor).toBeDefined();
  });

  test.afterEach(async ({ page }) => {
    // cleanup if needed
    // (Playwright will close page/context automatically)
  });

});

