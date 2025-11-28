import { test, expect } from '@playwright/test';

test('project preview and signing flow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Luminous markets/i })).toBeVisible();
  if (process.env.MOCK_OIDC === 'true' || process.env.NEXT_PUBLIC_MOCK_OIDC === 'true') {
    await expect(page.getByText(/Welcome back/i)).toBeVisible();
  }

  await page.goto('/marketplace');
  await expect(page.getByRole('heading', { name: 'Illuvrse Shelves' })).toBeVisible();

  await page.getByRole('button', { name: 'Preview' }).first().click();
  const previewModal = page.getByRole('dialog', { name: /Preview/ });
  await expect(previewModal).toBeVisible();
  await expect(previewModal.getByText('Session ID')).toBeVisible();

  await previewModal.getByRole('button', { name: 'Request Signing' }).click();
  const signModal = page.getByRole('dialog', { name: 'Request Signing' });
  await expect(signModal).toBeVisible();
  await signModal.getByRole('button', { name: 'Request signature' }).click();
  await expect(signModal.getByText(/Signature ID/)).toBeVisible();
  await signModal.getByRole('button', { name: 'Cancel' }).click();

  const statusBadge = page.getByText(/signed/i).first();
  await expect(statusBadge).toBeVisible();
});
