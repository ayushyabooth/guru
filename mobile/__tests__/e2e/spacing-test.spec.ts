/**
 * Spacing Test - Measure gap between filter pills and storyboards
 * Iterates until spacing is minimal
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8081';

test('Measure and verify spacing between pills and storyboards', async ({ page }) => {

  // Navigate to catchup page
  await page.goto(`${BASE_URL}/(tabs)/catchup`);
  await page.waitForTimeout(5000); // Wait longer for storyboards to load

  // Take screenshot
  await page.screenshot({ path: 'spacing-test.png', fullPage: true });

  // Measure the gap by finding all elements
  const measurements = await page.evaluate(() => {
    // Find all View elements and identify them
    const allViews = Array.from(document.querySelectorAll('[data-component-name="View"]'));
    
    // Find the filter pills container (has Consumer, Food & Beverage text)
    const pillsContainer = allViews.find(el => {
      const text = el.textContent || '';
      return text.includes('Consumer') && text.includes('Food');
    });
    
    // Find first storyboard card by looking for card-like structure
    const storyboardCard = Array.from(document.querySelectorAll('[data-component-name="View"]')).find(el => {
      const rect = el.getBoundingClientRect();
      const text = el.textContent || '';
      // Storyboard cards are wide, have significant height, and contain article text
      return rect.width > 400 && rect.height > 200 && text.length > 100;
    });
    
    if (!pillsContainer || !storyboardCard) {
      return {
        found: false,
        pillsBottom: 0,
        cardTop: 0,
        gap: 0,
        debug: {
          totalViews: allViews.length,
          hasPills: !!pillsContainer,
          hasCard: !!storyboardCard
        }
      };
    }

    const pillsRect = pillsContainer.getBoundingClientRect();
    const cardRect = storyboardCard.getBoundingClientRect();
    
    const gap = cardRect.top - pillsRect.bottom;
    
    return {
      found: true,
      pillsBottom: pillsRect.bottom,
      cardTop: cardRect.top,
      gap: gap,
      pillsHeight: pillsRect.height,
      cardTopFromViewport: cardRect.top
    };
  });

  if (!measurements.found && measurements.debug) {
  }

  if (measurements.gap > 50) {
  } else if (measurements.gap > 20) {
  } else {
  }

  // Check if there's excessive padding in the ScrollView
  const scrollViewPadding = await page.evaluate(() => {
    const scrollView = document.querySelector('[data-component-name="View"][class*="overflow"]');
    if (!scrollView) return { found: false };
    
    const computed = window.getComputedStyle(scrollView);
    return {
      found: true,
      paddingTop: computed.paddingTop,
      paddingBottom: computed.paddingBottom,
      marginTop: computed.marginTop,
      marginBottom: computed.marginBottom
    };
  });

  if (scrollViewPadding.found) {
  }
});
