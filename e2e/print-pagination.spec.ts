import { test, expect } from '@playwright/test';

test.describe('Print preview pagination', () => {
    test('Question on page 1, answer/analysis start on a new page', async ({ page }) => {
        test.setTimeout(60000);

        // Login
        await page.goto('/login');
        await page.locator('input[name="email"]').fill('e2e-qr-test@localhost');
        await page.locator('input[name="password"]').fill('test1234');
        await page.locator('button[type="submit"]').click();
        await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

        // Open print preview for the seeded notebook (items listed newest first: B, A)
        await page.goto('/print-preview?subjectId=cmtb2ceg70003kbz0h4126gzp&pageSize=50');
        await expect(page.getByRole('button', { name: /打印 \/ 保存 PDF/ })).toBeVisible({ timeout: 15000 });

        // Enable question text, answers, analysis and QR codes (checkbox order: 题目栏, 原题文字, 答案, 解析, 知识点, 二维码)
        const checkboxes = page.getByRole('checkbox');
        await checkboxes.nth(1).check();
        await checkboxes.nth(2).check();
        await checkboxes.nth(3).check();
        await checkboxes.nth(5).check();
        await expect(page.getByText('E2E解析：移项得')).toBeVisible({ timeout: 10000 });

        // Emulate print media and inspect pagination CSS
        await page.emulateMedia({ media: 'print' });

        const result = await page.evaluate(() => {
            const itemRoots = Array.from(document.querySelectorAll('div.border-b'))
                .filter(d => d.textContent?.includes('E2E测试题'))
                .filter(d => !String(d.className).includes('print:hidden'));

            // Answer/analysis section wrapper: breaks to a new page, contains analysis
            // but not the question itself
            const sectionWrappers = Array.from(document.querySelectorAll('div')).filter(d => {
                if (getComputedStyle(d).breakBefore !== 'page') return false;
                const text = d.textContent || '';
                return text.includes('E2E解析：移项得') && !text.includes('E2E测试题');
            });

            return itemRoots.map(d => ({
                isA: d.textContent?.includes('E2E测试题A'),
                isB: d.textContent?.includes('E2E测试题B'),
                breakBefore: getComputedStyle(d).breakBefore,
                svgCount: d.querySelectorAll('svg').length,
            })).concat([
                { isA: false, isB: false, breakBefore: `wrappers:${sectionWrappers.length}` } as any,
                { isA: false, isB: false, breakBefore: `wrappersWithHeader:${sectionWrappers.filter(w => w.querySelector('span.text-lg.font-bold')).length}` } as any,
                { isA: false, isB: false, breakBefore: `wrappersWithSvg:${sectionWrappers.filter(w => w.querySelector('svg')).length}` } as any,
            ]);
        });

        // First item in list (B): no forced break; second (A): starts on a new page
        const first = result.find(r => r.isB);
        const second = result.find(r => r.isA);
        expect(first?.breakBefore).toBe('auto');
        expect(second?.breakBefore).toBe('page');

        // QR codes stay with the question on page 1 (one svg per item root)
        expect(first?.svgCount).toBe(1);
        expect(second?.svgCount).toBe(1);

        // Answer/analysis wrapper exists and forces its own page
        expect(result[result.length - 3].breakBefore).toBe('wrappers:1');
        // Question header (bold number span) moved into the page-2 wrapper
        expect(result[result.length - 2].breakBefore).toBe('wrappersWithHeader:1');
        // No QR code leaked into the page-2 wrapper
        expect(result[result.length - 1].breakBefore).toBe('wrappersWithSvg:0');

        // Page-number footers: each question is its own page group (stem = page 1, answer = page 2)
        await expect(page.getByText('第1页（共2页）', { exact: true })).toHaveCount(2, { timeout: 10000 });
        await expect(page.getByText('第2页（共2页）', { exact: true })).toHaveCount(2);
    });
});
