import { test, expect } from '@playwright/test';

test.describe('Knowledge tag filter', () => {
    test('Filter items by knowledge tag without grade selected', async ({ page }) => {
        test.setTimeout(60000);

        // Login
        await page.goto('/login');
        await page.locator('input[name="email"]').fill('e2e-qr-test@localhost');
        await page.locator('input[name="password"]').fill('test1234');
        await page.locator('button[type="submit"]').click();
        await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

        // Open math notebook with 2 seeded items (A tagged, B untagged)
        await page.goto('/notebooks/cmtb2ceg70003kbz0h4126gzp');
        await expect(page.getByText('E2E测试题A')).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('E2E测试题B')).toBeVisible();

        // Select a knowledge tag WITHOUT selecting a grade first (bug scenario)
        await page.getByRole('button', { name: '知识点' }).click();
        await page.getByRole('dialog').getByText('一元一次方程', { exact: true }).click();

        // Selection must persist (bug used to wipe it instantly)
        await expect(page.getByRole('button', { name: /已选 1 个/ })).toBeVisible({ timeout: 5000 });

        // Only the tagged item remains
        await expect(page.getByText('E2E测试题A')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('E2E测试题B')).not.toBeVisible();
    });
});
