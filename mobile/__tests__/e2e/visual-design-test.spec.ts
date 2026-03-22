/**
 * Visual Design Test - Automated screenshot analysis
 * Tests filter pills and icon visibility, iterates until design is correct
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:8081';

test('Visual design verification with screenshot analysis', async ({ page }) => {

  // Login first
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  
  await page.fill('input[placeholder="Email"]', 'try93@example.com');
  await page.fill('input[placeholder="Password"]', 'try123');
  await page.click('text=Sign In');
  
  // Wait for login and navigate to catchup
  await page.waitForTimeout(3000);
  await page.goto(`${BASE_URL}/(tabs)/catchup`, { waitUntil: 'networkidle' });
  
  // Force hard reload to get latest code
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Take screenshot
  const screenshot = await page.screenshot({ 
    path: 'visual-design-test.png',
    fullPage: false 
  });
  

  // Analyze filter pills - find all TouchableOpacity elements with filter text
  const allPills = await page.locator('div[role="button"]').all();
  
  let foundFilterPill = false;
  for (const pill of allPills) {
    const text = await pill.textContent();
    if (text && (text.includes('Consumer') || text.includes('Food') || text.includes('Software') || text.includes('Technology'))) {
      const pillBox = await pill.boundingBox();
      if (pillBox) {
        
        if (pillBox.height > 40) {
        } else {
        }
        foundFilterPill = true;
        break;
      }
    }
  }
  
  if (!foundFilterPill) {
  }

  // Analyze gradient header (visual section)
  const visualSections = page.locator('[data-testid="visual-section"]');
  const visualCount = await visualSections.count();
  
  if (visualCount > 0) {
    const firstVisual = visualSections.first();
    const visualBox = await firstVisual.boundingBox();
    
    if (visualBox) {
      
      if (visualBox.height > 120) {
      } else {
      }
    }
  } else {
  }

  // Check if icon is visible
  const emojiIcon = page.locator('text=/📰|🛍️|💻|💰|🏥|🍽️|🏪|💄/').first();
  if (await emojiIcon.count() > 0) {
    const isVisible = await emojiIcon.isVisible();
    const opacity = await emojiIcon.evaluate((el) => {
      return window.getComputedStyle(el).opacity;
    });
    
    
    if (parseFloat(opacity) < 0.3) {
    } else {
    }
  }

});
