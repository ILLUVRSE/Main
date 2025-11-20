import { test, expect } from "@playwright/test";

const DEMO_TOKEN = process.env.DEMO_OIDC_TOKEN ?? "demo-token";

const SAMPLE_NOTES = "Playwright approval";

function pemPlaceholder() {
  return /Emergency rationale/;
}

test.describe("Control-panel approvals", () => {
  test("login, approve, and emergency apply an upgrade", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/OIDC token/).fill(DEMO_TOKEN);
    await page.getByRole("button", { name: /login/i }).click();
    await page.waitForURL(/\/?$/);

    await page.goto("/upgrades");
    const firstCard = page.getByTestId("upgrade-card").first();
    await expect(firstCard).toBeVisible();
    await firstCard.click();
    await expect(page.getByRole("heading", { name: /Upgrade/ })).toBeVisible();

    const notesArea = page.getByPlaceholder(/Approval notes/);
    await notesArea.fill(SAMPLE_NOTES);
    await page.getByRole("button", { name: /Approve upgrade/i }).click();
    await expect(page.getByRole("button", { name: /Approve upgrade/i })).toBeEnabled({ timeout: 10_000 });

    await page.getByPlaceholder(/Rejection reason/).fill("Not needed");
    await page.getByRole("button", { name: /Reject upgrade/i }).click();
    await expect(page.getByPlaceholder(/Rejection reason/)).toHaveValue("");

    const emergencyTextarea = page.getByPlaceholder(pemPlaceholder());
    await emergencyTextarea.fill("Playwright emergency");
    await page.getByRole("button", { name: /Emergency apply/i }).click();
    await expect(emergencyTextarea).toHaveValue("");

    await expect(page.getByRole("heading", { name: /Audit trail/i })).toBeVisible();
  });
});
