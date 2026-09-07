import { defineConfig, devices } from '@playwright/test';

// 本地开发服务器为 HTTPS（自签名证书）；CI 中 next start 为 HTTP
const isCI = !!process.env.CI;
const baseURL = isCI ? 'http://127.0.0.1:3000' : 'https://127.0.0.1:3000';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    workers: isCI ? 1 : undefined,
    reporter: [['html', { host: '0.0.0.0' }]],
    use: {
        baseURL,
        ignoreHTTPSErrors: !isCI,
        trace: 'on-first-retry',
    },
    webServer: {
        command: isCI ? 'npm run start' : 'npm run dev',
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120 * 1000,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
