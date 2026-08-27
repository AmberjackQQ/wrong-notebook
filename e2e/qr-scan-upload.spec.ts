import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('QR Code Scanner - Upload Mode', () => {
    test.use({ storageState: undefined });

    test('Upload QR image and navigate to error item', async ({ page }) => {
        test.setTimeout(60000);

        // Login
        await page.goto('/login');
        await page.locator('input[name="email"]').fill('e2e-qr-test@localhost');
        await page.locator('input[name="password"]').fill('test1234');
        await page.locator('button[type="submit"]').click();
        await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

        // Open QR scanner
        await page.getByRole('button', { name: /扫描二维码找题/ }).click();
        await expect(page.getByRole('heading', { name: '扫描二维码' })).toBeVisible();

        // Switch to upload mode
        await page.getByRole('button', { name: /上传图片/ }).click();
        await expect(page.getByText('上传包含二维码的图片')).toBeVisible();

        // Upload QR image
        const qrImagePath = path.resolve('C:/Users/Amberjack/Downloads/化学错题二维码.png');
        await page.locator('input#qr-upload').setInputFiles(qrImagePath);

        // Success: navigates to the error item page instead of showing an error
        await page.waitForURL(/\/error-items\/[a-z0-9]{24}/, { timeout: 10000 });
        await expect(page.getByText('无法识别图片中的二维码')).not.toBeVisible();
    });
});
