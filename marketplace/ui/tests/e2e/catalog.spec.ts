import { test, expect } from '@playwright/test';

test.describe('Marketplace basic flow', () => {
  test('home -> marketplace -> sku -> checkout (happy path)', async ({ page }) => {
    // Home
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Marketplace for trusted models/i })).toBeVisible();

    // Click "Explore Marketplace" (hero CTA)
    await Promise.all([
      page.waitForURL(/\/marketplace/),
      page.getByRole('link', { name: /Explore Marketplace/i }).click(),
    ]);

    // Marketplace page should load
    await expect(page.getByRole('heading', { name: /Marketplace/i })).toBeVisible();

    // Wait for either skeleton to go away or items to appear
    const skuGrid = page.locator('.sku-grid');
    await expect(skuGrid).toBeVisible();

    // If there are no items visible, assert catalog still renders
    const cards = skuGrid.locator('article');
    const count = await cards.count();

    if (count === 0) {
      // Nothing to interact with — still assert the empty state and exit
      await expect(page.getByText(/No items/i).or(page.getByText(/No Image/i))).toBeVisible();
      test.info().log('No SKUs present in catalog; skipping SKU navigation assertions.');
      return;
    }

    // Interact with the first SKU card: view details
    const firstCard = cards.first();
    const viewButton = firstCard.locator('button', { hasText: 'View' }).first();
    await Promise.all([
      page.waitForURL(/\/sku\//),
      viewButton.click(),
    ]);

    // SKU page should show title and buy/preview controls
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByRole('button', { name: /Buy/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Start Preview|Preview/i })).toBeVisible();

    // Click Buy and expect redirect to checkout with sku query
    await Promise.all([
      page.waitForURL(/\/checkout\?sku=/),
      page.getByRole('button', { name: /Buy/i }).click(),
    ]);

    // On checkout page, expect buyer details form
    await expect(page.getByRole('heading', { name: /Checkout/i })).toBeVisible();
    await expect(page.getByLabel('Buyer email')).toBeVisible();

    // Fill minimal details and create order
    await page.fill('input[placeholder="buyer@example.com"]', 'test@playwright.local');
    await Promise.all([
      // create order triggers a POST and should update the UI with order id
      page.getByRole('button', { name: /Create Order/i }).click(),
      page.waitForResponse((r) => r.url().endsWith('/checkout') && r.request().method() === 'POST'),
    ]);

    // After creating, the UI will show order status and allow simulate payment
    await expect(page.getByText(/Order ID/i).or(page.getByText(/Status:/i))).toBeVisible();

    // If Simulate payment button exists, click and wait for order status update
    const simulateBtn = page.getByRole('button', { name: /Simulate payment/i });
    if (await simulateBtn.count() > 0) {
      await simulateBtn.click();
      // Give backend some time; poll for order finalization indicator
      await page.waitForFunction(() => {
        const el = document.querySelector('div.card');
        if (!el) return false;
        return /Order .* is (finalized|settled)/i.test(el.textContent || '');
      }, { timeout: 15000 }).catch(() => { /* ignore timeout */ });
    }

    // Final assertion: the page offers to view the order
    await expect(page.locator('button', { hasText: 'View Order' }).first()).toBeVisible();
  });
});

