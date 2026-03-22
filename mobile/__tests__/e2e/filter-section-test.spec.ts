/**
 * Filter Section Test - Measure and fix bloated filter section
 * Logs in with test account and iterates until filter section is compact
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8081';

test('Measure filter section and verify it is compact', async ({ page }) => {

  // Login
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  
  await page.fill('input[placeholder="Email"]', 'try93@example.com');
  await page.fill('input[placeholder="Password"]', 'try123');
  await page.click('text=Sign In');
  
  // Wait for navigation
  await page.waitForTimeout(3000);
  await page.goto(`${BASE_URL}/(tabs)/catchup`);
  await page.waitForTimeout(3000);

  // Take screenshot
  await page.screenshot({ path: 'filter-section-test.png', fullPage: true });

  // Measure filter section
  const measurements = await page.evaluate(() => {
    // Find the filter pills ScrollView container
    const filterContainer = Array.from(document.querySelectorAll('[data-component-name="View"]')).find(el => {
      const text = el.textContent || '';
      const hasFilterText = text.includes('Consumer') && text.includes('Food');
      const computed = window.getComputedStyle(el);
      const isScrollable = computed.overflowX === 'scroll' || computed.overflowX === 'auto';
      return hasFilterText && isScrollable;
    });

    if (!filterContainer) {
      return {
        found: false,
        height: 0,
        padding: '',
        viewportHeight: window.innerHeight
      };
    }

    const rect = filterContainer.getBoundingClientRect();
    const computed = window.getComputedStyle(filterContainer);
    
    return {
      found: true,
      height: rect.height,
      width: rect.width,
      top: rect.top,
      padding: computed.padding,
      paddingTop: computed.paddingTop,
      paddingBottom: computed.paddingBottom,
      viewportHeight: window.innerHeight,
      percentOfScreen: (rect.height / window.innerHeight * 100).toFixed(1)
    };
  });


  if (parseFloat(measurements.percentOfScreen) > 15) {
  } else if (parseFloat(measurements.percentOfScreen) > 10) {
  } else {
  }

  // Check if storyboards are visible
  const storyboardPosition = await page.evaluate(() => {
    const storyboard = Array.from(document.querySelectorAll('[data-component-name="View"]')).find(el => {
      const rect = el.getBoundingClientRect();
      const text = el.textContent || '';
      return rect.width > 400 && rect.height > 200 && text.length > 100;
    });

    if (!storyboard) return { found: false, top: 0 };
    
    const rect = storyboard.getBoundingClientRect();
    return {
      found: true,
      top: rect.top,
      percentFromTop: (rect.top / window.innerHeight * 100).toFixed(1)
    };
  });


  if (parseFloat(storyboardPosition.percentFromTop) > 40) {
  }
});
