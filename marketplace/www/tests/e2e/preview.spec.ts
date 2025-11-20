import { test, expect } from "@playwright/test";

const skuSlug = "synthetic-guardian";

const SAMPLE_PEM = `-----BEGIN PUBLIC KEY-----\nAAAAB3NzaC1yc2EAAAADAQABAAABAQC7l0testkey==\n-----END PUBLIC KEY-----`;

test.describe("Preview + checkout flows", () => {
  test("streams tokens in PreviewPanel", async ({ page }) => {
    await page.goto(`/sku/${skuSlug}`);
    await page.getByRole("button", { name: /preview sandbox/i }).click();
    await expect(page.getByTestId("preview-status")).toContainText(/streaming/i, { timeout: 5000 });
    await expect(page.getByTestId("preview-output")).toContainText(/guardian/i, { timeout: 10_000 });
    await expect(page.getByTestId("preview-status")).toContainText(/done/i, { timeout: 12_000 });
    await page.getByRole("button", { name: /close preview/i }).click();
  });

  test("buyer-managed checkout completes demo flow", async ({ page }) => {
    await page.goto(`/sku/${skuSlug}`);
    await page.getByRole("button", { name: /buyer managed/i }).click();
    await page.getByPlaceholderText(/BEGIN PUBLIC KEY/).fill(SAMPLE_PEM);
    await page.getByRole("button", { name: /buy now/i }).click();

    await expect(page).toHaveURL(/checkout/);
    await page.getByLabel("Full name").fill("Playwright Buyer");
    await page.getByLabel("Work email").fill("buyer@example.com");
    await page.getByLabel("Company (optional)").fill("Playwright Co");
    await page.getByLabel("Notes for delivery team").fill("Runbook verified via E2E");
    await page.getByRole("button", { name: /continue to payment/i }).click();

    await expect(page.getByTestId("checkout-success"), "should render success panel").toBeVisible({ timeout: 10_000 });
    const orderLink = page.getByRole("link", { name: /view order/i });
    await expect(orderLink).toBeVisible();
    await orderLink.click();
    await expect(page).toHaveURL(/order/);
    await expect(page.getByRole("heading", { name: /Order/ })).toBeVisible();
  });
});
