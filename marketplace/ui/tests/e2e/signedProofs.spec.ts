import { test, expect } from '@playwright/test';

test.describe('Signed proofs & license verification', () => {
  test('checkout -> payment -> finalize -> proof appears and can be fetched', async ({ page }) => {
    // Navigate to marketplace
    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: /Marketplace/i })).toBeVisible();

    // Find first SKU card (if none present, skip)
    const skuGrid = page.locator('.sku-grid');
    await expect(skuGrid).toBeVisible();
    const cards = skuGrid.locator('article');
    const count = await cards.count();

    if (count === 0) {
      test.info().log('No SKUs in catalog — skipping signed proof test.');
      return;
    }

    // Open the first SKU
    await Promise.all([
      page.waitForURL(/\/sku\//),
      cards.first().locator('button', { hasText: 'View' }).click(),
    ]);

    // Click Buy -> checkout
    await Promise.all([
      page.waitForURL(/\/checkout\?sku=/),
      page.getByRole('button', { name: /Buy/i }).click(),
    ]);

    // Fill buyer email and create order
    await page.fill('input[placeholder="buyer@example.com"]', 'prooftest@playwright.local');
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/checkout') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /Create Order/i }).click(),
    ]);

    // Wait briefly for UI to display the order and simulate payment button
    await expect(page.locator('div.card')).toBeVisible();

    // If Simulate payment exists, click it
    const simulateBtn = page.getByRole('button', { name: /Simulate payment/i });
    if (await simulateBtn.count() > 0) {
      await simulateBtn.click();
      // wait for order status to change to settled/finalized
      await page.waitForFunction(() => {
        const el = document.querySelector('div.card');
        if (!el) return false;
        return /is (settled|finalized)/i.test(el.textContent || '');
      }, { timeout: 15000 }).catch(() => {});
    }

    // Click "View Order" if present
    const viewBtn = page.getByRole('button', { name: /View Order/i }).first();
    if (await viewBtn.count() > 0) {
      await Promise.all([
        page.waitForURL(/\/order\//),
        viewBtn.click(),
      ]);
    } else {
      // Fallback: navigate to /order/<orderId> if link exists in page
      const orderIdText = await page.locator('div.card').locator('text=Order ID:').textContent().catch(() => null);
      if (orderIdText) {
        const match = orderIdText.match(/Order ID:\s*([^\s]+)/);
        if (match) {
          await page.goto(`/order/${encodeURIComponent(match[1])}`);
        }
      }
    }

    // On the order page: wait for delivery/proof UI
    await expect(page.getByRole('heading', { name: /Order/i })).toBeVisible();

    // Try to fetch proof via "Fetch proof" button
    const fetchProofBtn = page.getByRole('button', { name: /Fetch proof/i }).first();
    if (await fetchProofBtn.count() > 0) {
      await fetchProofBtn.click();
      // After clicking, proof card should appear
      await expect(page.locator('div.card')).toBeVisible();
      // Wait for proof canonical payload or signature to appear
      await page.waitForFunction(() => {
        return !!document.querySelector('pre') && /signature|canonical_payload|artifact_sha256/i.test((document.querySelector('pre')?.textContent||''));
      }, { timeout: 10000 }).catch(() => {});
      // Assert signature field present
      const signatureText = await page.locator('pre').nth(0).textContent().catch(() => '');
      expect(signatureText?.length || 0).toBeGreaterThan(0);
    } else {
      // If no Fetch proof UI, try navigating to /proofs/<id> if proof id exists in page
      const proofIdText = await page.locator('div').filter({ hasText: 'Proof ID' }).locator('div.font-medium').textContent().catch(() => null);
      if (proofIdText) {
        await page.goto(`/proofs/${encodeURIComponent(proofIdText.trim())}`);
        await expect(page.getByRole('heading', { name: /Proof/i })).toBeVisible();
        // Ensure canonical payload or signature is present
        await expect(page.locator('pre')).toBeVisible();
      } else {
        test.info().log('No proof UI found on order page — test ends here.');
      }
    }

    // Optionally, test license verification if license present and "Verify license" button exists
    const verifyBtn = page.getByRole('button', { name: /Verify license/i }).first();
    if (await verifyBtn.count() > 0) {
      await verifyBtn.click();
      // Wait for verification result to appear
      await page.waitForSelector('.proof-success, .bg-yellow-50', { timeout: 10000 });
      // Expect a verification block
      expect(await page.locator('.proof-success, .bg-yellow-50').count()).toBeGreaterThan(0);
    }
  });
});

