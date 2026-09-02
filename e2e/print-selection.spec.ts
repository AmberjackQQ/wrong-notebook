import { test, expect } from '@playwright/test';

test.describe('Print preview selection', () => {
    test('Selection persists after toggling sort order', async ({ page }) => {
        test.setTimeout(60000);

        // Login
        await page.goto('/login');
        await page.locator('input[name="email"]').fill('e2e-qr-test@localhost');
        await page.locator('input[name="password"]').fill('test1234');
        await page.locator('button[type="submit"]').click();
        await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

        // Open print preview for the seeded notebook (2 items, all selected by default)
        await page.goto('/print-preview?subjectId=cmtb2ceg70003kbz0h4126gzp&pageSize=50');
        await expect(page.getByRole('button', { name: /打印 \/ 保存 PDF/ })).toBeVisible({ timeout: 15000 });
        await expect(page.locator('h1')).toContainText('2 道题目');

        // Uncheck the first item in the selection panel
        await page.locator('.grid label input[type="checkbox"]').first().uncheck();
        await expect(page.locator('h1')).toContainText('1/2');

        // Toggle sort order — selection must NOT reset to all
        await page.getByRole('button', { name: /最新→最早|最早→最新/ }).click();
        await expect(page.locator('h1')).toContainText('1/2', { timeout: 10000 });
        await expect(page.locator('div.max-w-4xl > div.border-b')).toHaveCount(1);
    });
});
