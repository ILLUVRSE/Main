import { test, expect } from "@playwright/test";

const SAMPLE_PEM = `-----BEGIN PUBLIC KEY-----\nAAAAB3NzaC1yc2EAAAADAQABAAABAQCyplaywrightkey==\n-----END PUBLIC KEY-----`;

function selectBuyerManaged(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: /buyer managed/i });
}

test("home catalog add-to-cart remains marketplace managed", async ({ page }) => {
  await page.goto("/");
  const addButtons = page.getByRole("button", { name: /add to cart/i });
  await expect(addButtons.first()).toBeVisible();
});

test("direct checkout uses buyer-managed PEM", async ({ page }) => {
  await page.goto("/sku/synthetic-guardian");
  await selectBuyerManaged(page).click();
  await page.getByPlaceholderText(/BEGIN PUBLIC KEY/).fill(SAMPLE_PEM);
  await page.getByRole("button", { name: /add to cart/i }).click();
  await page.goto("/checkout");
  await page.getByRole("button", { name: /continue to payment/i }).click();
  await expect(page.getByTestId("checkout-success")).toBeVisible();
});
