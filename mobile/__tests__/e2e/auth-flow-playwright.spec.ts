/**
 * E2E Test: Complete Auth Flow with Playwright
 * This test simulates the actual user journey through the frontend
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8081';
const API_URL = 'http://localhost:8000/api/v1';

test.describe('Complete Auth Flow E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Clear all storage before each test
    await page.goto(BASE_URL);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    
    // Verify storage is actually cleared
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
  });

  test('Full flow: Login -> Navigate to Catchup -> See Storyboards', async ({ page }) => {

    // Capture console logs and errors
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
    });

    page.on('pageerror', error => {
    });

    // Step 1: Go to login page
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');

    // Step 2: Fill in credentials
    await page.fill('input[placeholder="Email"]', 'try93@example.com');
    await page.fill('input[placeholder="Password"]', 'try123');

    // Step 3: Check localStorage BEFORE login
    const tokenBeforeLogin = await page.evaluate(() => localStorage.getItem('access_token'));

    // Step 4: Click login button and wait for response
    
    // Wait for the login API call
    const loginResponsePromise = page.waitForResponse(
      response => response.url().includes('/auth/login') && response.request().method() === 'POST',
      { timeout: 5000 }
    ).catch(() => null);

    await page.click('text=Sign In');
    
    const loginResponse = await loginResponsePromise;
    if (loginResponse) {
      const responseBody = await loginResponse.json().catch(() => null);
    } else {
    }

    // Wait a bit for any async operations
    await page.waitForTimeout(2000);

    // Check current URL

    // Try to wait for navigation with longer timeout
    try {
      await page.waitForURL(/\/(tabs|catchup|home)/, { timeout: 5000 });
    } catch (e) {
      throw new Error('Login did not navigate to main app');
    }

    // Step 5: Check localStorage AFTER login
    const tokenAfterLogin = await page.evaluate(() => localStorage.getItem('access_token'));

    // CRITICAL: Verify token was stored
    expect(tokenAfterLogin).not.toBeNull();
    expect(tokenAfterLogin).not.toBe(tokenBeforeLogin);

    // Step 6: Navigate to Catchup page
    await page.goto(`${BASE_URL}/(tabs)/catchup`);
    await page.waitForLoadState('networkidle');

    // Step 7: Check token is still there
    const tokenOnCatchup = await page.evaluate(() => localStorage.getItem('access_token'));

    expect(tokenOnCatchup).toBe(tokenAfterLogin);

    // Step 8: Intercept API calls to see what token is being sent
    page.on('request', request => {
      if (request.url().includes('/api/v1/')) {
        const authHeader = request.headers()['authorization'];
      }
    });

    // Step 9: Wait for storyboards to load or error
    
    const result = await Promise.race([
      // Wait for success
      page.waitForSelector('[data-testid="storyboard-card"]', { timeout: 30000 })
        .then(() => ({ success: true }))
        .catch(() => ({ success: false })),
      
      // Wait for error
      page.waitForSelector('text=Failed to load stories', { timeout: 30000 })
        .then(() => ({ success: false, error: 'Failed to load stories' }))
        .catch(() => ({ success: false })),
      
      // Wait for unauthorized
      page.waitForSelector('text=Unauthorized', { timeout: 30000 })
        .then(() => ({ success: false, error: 'Unauthorized' }))
        .catch(() => ({ success: false }))
    ]);

    if (!result.success) {
      // Capture debug info
      const pageContent = await page.content();
      const consoleMessages = [];
      page.on('console', msg => consoleMessages.push(msg.text()));
      
      
      // Take screenshot
      await page.screenshot({ path: 'test-failure.png', fullPage: true });
      
      throw new Error(`Auth flow failed: ${result.error}`);
    }

  });

  test('Debug: Check what happens to token during navigation', async ({ page }) => {

    // Manually set a token
    await page.goto(BASE_URL);
    await page.evaluate(() => {
      localStorage.setItem('access_token', 'test-token-12345');
    });

    let token = await page.evaluate(() => localStorage.getItem('access_token'));

    // Navigate to login
    await page.goto(`${BASE_URL}/login`);
    token = await page.evaluate(() => localStorage.getItem('access_token'));

    // Navigate to tabs
    await page.goto(`${BASE_URL}/(tabs)`);
    token = await page.evaluate(() => localStorage.getItem('access_token'));

    // Navigate to catchup
    await page.goto(`${BASE_URL}/(tabs)/catchup`);
    token = await page.evaluate(() => localStorage.getItem('access_token'));

    expect(token).toBe('test-token-12345');
  });
});
