import { chromium } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const target = new URL('/register', baseURL).toString();
const browser = await chromium.launch();
const page = await browser.newPage();
let lastError;
let warmed = false;

try {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.locator('#root > *').first().waitFor({ state: 'attached', timeout: 15_000 });
      console.log(`Playwright warm-up attached React root at ${target}`);
      warmed = true;
      break;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1000);
    }
  }
} finally {
  await browser.close();
}

if (!warmed) {
  console.error(`Playwright warm-up failed at ${target}`);
  if (lastError instanceof Error) {
    console.error(lastError.message);
  }
  process.exit(1);
}
