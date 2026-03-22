/**
 * Debug Catchup Flow - Simulate login and catchup feed access
 * Tests with try91@example.com / try123
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8081';
const API_URL = 'http://localhost:8000';

test('Debug catchup feed flow with try93@example.com', async ({ page }) => {

  // Intercept API calls to see what's happening
  const apiCalls: any[] = [];
  page.on('request', request => {
    if (request.url().includes('api/v1')) {
      apiCalls.push({
        method: request.method(),
        url: request.url(),
        headers: request.headers()
      });
    }
  });

  page.on('response', async response => {
    if (response.url().includes('api/v1')) {
      const status = response.status();
      try {
        const body = await response.text();
      } catch (e) {
      }
    }
  });

  // Capture console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Error') || text.includes('Failed') || text.includes('401') || text.includes('404')) {
    }
  });

  // Step 1: Clear storage and go to login
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  await page.waitForTimeout(1000);

  // Step 2: Login
  await page.fill('input[placeholder="Email"]', 'try93@example.com');
  await page.fill('input[placeholder="Password"]', 'try123');
  
  await page.click('text=Sign In');
  
  // Wait for navigation or error
  await page.waitForTimeout(3000);
  
  // Check if we're still on login page (error) or navigated
  const currentUrl = page.url();
  
  // Check for error message
  const errorVisible = await page.locator('text=/Invalid|Error|failed/i').isVisible().catch(() => false);
  if (errorVisible) {
    const errorText = await page.locator('text=/Invalid|Error|failed/i').first().textContent();
  }
  
  // Check localStorage for token
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (token) {
  } else {
  }

  // Step 3: Navigate to catchup
  await page.goto(`${BASE_URL}/(tabs)/catchup`);
  await page.waitForTimeout(5000);

  // Take screenshot
  await page.screenshot({ path: 'debug-catchup-flow.png', fullPage: true });

  // Check what's on the page
  const pageContent = await page.evaluate(() => {
    const body = document.body.textContent || '';
    return {
      hasNoStoriesMessage: body.includes('No stories available'),
      hasLoadingMessage: body.includes('Loading') || body.includes('loading'),
      hasStoryboards: body.includes('Also in this story') || body.includes('min'),
      bodyPreview: body.substring(0, 500)
    };
  });


  // Check API calls made
  apiCalls.forEach((call, i) => {
    if (call.headers.authorization) {
    } else {
    }
  });

  // Final diagnosis
  if (!token) {
  } else if (pageContent.hasNoStoriesMessage) {
  } else if (pageContent.hasStoryboards) {
  } else {
  }
});
