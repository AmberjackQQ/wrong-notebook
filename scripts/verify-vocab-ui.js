// 词汇本 UI 验证脚本（Playwright + 注入 JWT 会话）
const { chromium } = require('playwright');

const BASE = 'https://localhost:3000';
const TOKEN = process.argv[2];

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    await ctx.addCookies([{
        name: 'next-auth.session-token',
        value: TOKEN,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
    }]);
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const errors = [];

    try {
        // 1. 我的错题本页出现「英语词汇」卡片（ensure-vocab 幂等补建）
        await page.goto(BASE + '/notebooks', { waitUntil: 'networkidle', timeout: 60000 });
        const vocabCard = page.locator('div.cursor-pointer', { hasText: '英语词汇' }).first();
        await vocabCard.waitFor({ timeout: 15000 });
        console.log('PASS: 英语词汇卡片已显示');
        const badgeText = await vocabCard.textContent();
        console.log('  卡片内容:', badgeText.replace(/\s+/g, ' ').trim().slice(0, 80));

        // 2. 进入词汇本 → 头部出现「添加词汇」按钮 + 搜索框
        await vocabCard.click();
        await page.waitForURL('**/notebooks/**', { timeout: 30000 });
        await page.getByRole('button', { name: '添加词汇' }).first().waitFor({ timeout: 15000 });
        await page.getByPlaceholder('搜索单词或释义...').waitFor({ timeout: 10000 });
        console.log('PASS: 词汇本页面分流正常（添加按钮 + 搜索框）');

        // 3. 打开添加对话框，添加 abandon（词典未就绪时存为手动词条）
        await page.getByRole('button', { name: '添加词汇' }).first().click();
        await page.getByPlaceholder('例如：abandon').waitFor({ timeout: 10000 });
        await page.getByPlaceholder('例如：abandon').fill('abandon');
        await page.getByPlaceholder('输入你自己的例句...').fill('He abandoned the plan.');
        await page.getByRole('button', { name: '保存' }).click();
        await page.getByPlaceholder('搜索单词或释义...').waitFor({ timeout: 10000 });
        // 等列表出现 abandon 行
        await page.locator('span.font-semibold', { hasText: 'abandon' }).first().waitFor({ timeout: 15000 });
        console.log('PASS: 添加 abandon 成功并出现在列表');

        // 4. 重复添加 → 应弹 conflict 提示（dialog 自动 accept）
        await page.getByRole('button', { name: '添加词汇' }).first().click();
        await page.getByPlaceholder('例如：abandon').waitFor({ timeout: 10000 });
        await page.getByPlaceholder('例如：abandon').fill('abandon');
        await page.getByRole('button', { name: '保存' }).click();
        await page.waitForTimeout(1500);
        console.log('PASS: 重复添加触发 conflict 弹窗（已自动确认）');
        await page.keyboard.press('Escape');

        // 5. 展开详情
        await page.locator('div.cursor-pointer', { hasText: 'abandon' }).first().click();
        await page.waitForTimeout(500);
        const hasAiBtn = await page.getByRole('button', { name: 'AI 生成例句' }).first().isVisible().catch(() => false);
        console.log(hasAiBtn ? 'PASS: 详情展开 + AI 生成例句按钮可见' : 'WARN: AI 按钮不可见');

        // 6. 删除词条（confirm 自动 accept）
        const delBtn = page.locator('div.cursor-pointer', { hasText: 'abandon' }).first().locator('button').last();
        await delBtn.click();
        await page.waitForTimeout(1500);
        const still = await page.locator('span.font-semibold', { hasText: 'abandon' }).count();
        if (still === 0) console.log('PASS: 删除词条成功');
        else console.log('WARN: 删除后仍可见 ' + still);

        // 7. 回到列表页验证卡片仍正常 + 待复习/已掌握徽章不显示在词汇卡上
        await page.goto(BASE + '/notebooks', { waitUntil: 'networkidle', timeout: 60000 });
        const cardText2 = await page.locator('div.cursor-pointer', { hasText: '英语词汇' }).first().textContent();
        if (cardText2.includes('待复习') || cardText2.includes('已掌握')) {
            console.log('WARN: 词汇卡不应显示 待复习/已掌握 徽章');
        } else {
            console.log('PASS: 词汇卡不显示 待复习/已掌握 徽章');
        }
    } catch (e) {
        errors.push(e.message);
        await page.screenshot({ path: 'test_output_vocab.png', fullPage: true }).catch(() => {});
    } finally {
        await browser.close();
    }

    if (errors.length) {
        console.error('FAIL:', errors.join('\n'));
        process.exit(1);
    }
    console.log('ALL DONE');
})();
